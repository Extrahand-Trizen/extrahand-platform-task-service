import fs from 'fs';
import path from 'path';

import { BEAUTY_OFFER_SERVICES } from '../constants/beautyOfferCatalogSeed';
import { buildBookNowCsvSeed } from './bookNowCsvCatalogSeed';

export type BookNowSupplementalContent = {
  includes: string[];
  excludes: string[];
  faqItems: Array<{ question: string; answer: string }>;
};

type ParsedCsvRow = {
  service: string;
  includes: string[];
  excludes: string[];
  faqItems: Array<{ question: string; answer: string }>;
};

type SeedSkuRef = {
  categorySlug: string;
  skuSlug: string;
  name: string;
};

const SUPPLEMENTAL_FILES = [
  'Booknow services and prices(Beauty).csv',
  'Booknow services and prices(Carpentry).csv',
  'Booknow services and prices(Electrician).csv',
  'Booknow services and prices(Painting).csv',
  'Booknow services and prices(Plumbing).csv',
] as const;

const SERVICE_NAME_ALIASES: Record<string, SeedSkuRef[]> = {
  [normalizeKey('Cupboard Hinge Repair / Replacement')]: [
    {
      categorySlug: 'carpenter-cupboard-drawer',
      skuSlug: 'cupboard-hinge-repair-replacement',
      name: 'Cupboard Hinge Repair / Replacement',
    },
  ],
  [normalizeKey('Haircut – Women')]: [
    { categorySlug: 'womens-hair', skuSlug: 'haircut', name: 'Haircut' },
  ],
  [normalizeKey('Haircut – Men')]: [
    { categorySlug: 'mens-grooming', skuSlug: 'haircut', name: 'Haircut' },
  ],
  [normalizeKey('Men’s Facial')]: [
    { categorySlug: 'mens-grooming', skuSlug: 'mens-facial', name: "Men's Facial" },
  ],
  [normalizeKey('Men’s D-Tan – Face & Neck')]: [
    { categorySlug: 'mens-grooming', skuSlug: 'mens-dtan-face-neck', name: "Men's D-Tan – Face & Neck" },
  ],
  [normalizeKey('Men’s Manicure')]: [
    { categorySlug: 'mens-grooming', skuSlug: 'mens-manicure', name: "Men's Manicure" },
  ],
  [normalizeKey('Men’s Pedicure')]: [
    { categorySlug: 'mens-grooming', skuSlug: 'mens-pedicure', name: "Men's Pedicure" },
  ],
};

function normalizeKey(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function splitBulletList(text: string): string[] {
  const normalized = String(text || '').replace(/\u00a0/g, ' ').trim();
  if (!normalized) return [];
  if (!normalized.includes('•')) {
    return [normalized];
  }
  return normalized
    .split('•')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFaqItems(text: string): Array<{ question: string; answer: string }> {
  const normalized = String(text || '').replace(/\u00a0/g, ' ').trim();
  if (!normalized) return [];

  const items: Array<{ question: string; answer: string }> = [];
  const regex = /Q:\s*(.*?)\s*A:\s*(.*?)(?=Q:\s*|$)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    const question = String(match[1] || '').trim();
    const answer = String(match[2] || '').trim();
    if (question && answer) {
      items.push({ question, answer });
    }
  }

  return items;
}

function resolveFilePath(fileName: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), `../${fileName}`),
    path.resolve(process.cwd(), `../../${fileName}`),
    path.resolve(__dirname, `../../../${fileName}`),
    path.resolve(__dirname, `../../../../${fileName}`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function parseSupplementalCsv(fileName: string): ParsedCsvRow[] {
  const resolvedPath = resolveFilePath(fileName);
  if (!resolvedPath) return [];

  const text = fs.readFileSync(resolvedPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const rows: ParsedCsvRow[] = [];

  let current: ParsedCsvRow | null = null;

  for (let index = 1; index < lines.length; index += 1) {
    const columns = parseCsvLine(lines[index]);
    const service = String(columns[0] || '').trim();
    const includesCell = String(columns[1] || '').trim();
    const excludesCell = String(columns[2] || '').trim();
    const faqsCell = String(columns[3] || '').trim();

    if (service) {
      if (current) rows.push(current);
      current = {
        service,
        includes: [],
        excludes: [],
        faqItems: [],
      };
    }

    if (!current) continue;

    current.includes.push(...splitBulletList(includesCell));
    current.excludes.push(...splitBulletList(excludesCell));
    current.faqItems.push(...parseFaqItems(faqsCell));
  }

  if (current) rows.push(current);

  return rows.map((row) => ({
    service: row.service,
    includes: Array.from(new Set(row.includes.map((item) => item.trim()).filter(Boolean))),
    excludes: Array.from(new Set(row.excludes.map((item) => item.trim()).filter(Boolean))),
    faqItems: row.faqItems.filter((item) => item.question && item.answer),
  }));
}

function buildSeedLookup(): Map<string, SeedSkuRef[]> {
  const lookup = new Map<string, SeedSkuRef[]>();
  const csvSeed = buildBookNowCsvSeed();

  const register = (item: SeedSkuRef) => {
    const key = normalizeKey(item.name);
    const existing = lookup.get(key) || [];
    existing.push(item);
    lookup.set(key, existing);
  };

  csvSeed.packages.forEach((pkg) => {
    register({
      categorySlug: pkg.categorySlug,
      skuSlug: pkg.skuSlug,
      name: pkg.name,
    });
  });

  BEAUTY_OFFER_SERVICES.forEach((service) => {
    register({
      categorySlug: service.categorySlug,
      skuSlug: service.skuSlug,
      name: service.name,
    });
  });

  return lookup;
}

export function loadSupplementalBookNowContentSeed(): {
  contentByCategoryAndSku: Record<string, BookNowSupplementalContent>;
  unmatchedServices: string[];
  matchedCount: number;
} {
  const seedLookup = buildSeedLookup();
  const contentByCategoryAndSku: Record<string, BookNowSupplementalContent> = {};
  const unmatchedServices: string[] = [];
  let matchedCount = 0;

  for (const fileName of SUPPLEMENTAL_FILES) {
    const rows = parseSupplementalCsv(fileName);

    for (const row of rows) {
      const normalizedService = normalizeKey(row.service);
      const targets =
        SERVICE_NAME_ALIASES[normalizedService] ||
        seedLookup.get(normalizedService) ||
        [];

      if (targets.length === 0) {
        unmatchedServices.push(row.service);
        continue;
      }

      targets.forEach((target) => {
        contentByCategoryAndSku[`${target.categorySlug}::${target.skuSlug}`] = {
          includes: row.includes,
          excludes: row.excludes,
          faqItems: row.faqItems,
        };
        matchedCount += 1;
      });
    }
  }

  return {
    contentByCategoryAndSku,
    unmatchedServices: Array.from(new Set(unmatchedServices)).sort(),
    matchedCount,
  };
}
