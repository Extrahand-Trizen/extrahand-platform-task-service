import fs from 'fs';
import path from 'path';

const CDN_IMAGE_BASE = 'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images';

function cdnImage(name: string): string {
  return `${CDN_IMAGE_BASE}/${name}.webp`;
}

function slugify(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value.trim());
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(value.trim());
      value = '';
      if (row.some((cell) => cell !== '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    value += char;
  }

  if (value || row.length > 0) {
    row.push(value.trim());
    if (row.some((cell) => cell !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

function resolveCsvPath(): string {
  const candidates = [
    path.resolve(process.cwd(), '../ADPT4EH/Booknow services and prices(Sheet1).csv'),
    path.resolve(process.cwd(), '../../ADPT4EH/Booknow services and prices(Sheet1).csv'),
    path.resolve(__dirname, '../../../ADPT4EH/Booknow services and prices(Sheet1).csv'),
    path.resolve(__dirname, '../../../../ADPT4EH/Booknow services and prices(Sheet1).csv'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Booknow services and prices(Sheet1).csv not found');
}

function parsePrice(value: string): number {
  const cleaned = String(value || '')
    .replace(/[^\d.]/g, '')
    .trim();
  if (!cleaned) {
    return 0;
  }
  return Math.round(Number(cleaned));
}

function parseDurationMinutes(label: string): number {
  const normalized = String(label || '')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .trim();

  if (!normalized) {
    return 30;
  }

  const range = normalized.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  const single = normalized.match(/(\d+(?:\.\d+)?)/);
  const base = range
    ? (Number(range[1]) + Number(range[2])) / 2
    : single
      ? Number(single[1])
      : 0;

  if (normalized.includes('hr')) {
    return Math.max(15, Math.round(base * 60));
  }

  if (normalized.includes('min')) {
    return Math.max(15, Math.round(base));
  }

  if (normalized.includes('pickup')) {
    return 60;
  }

  return Math.max(15, Math.round(base || 30));
}

type CsvItem = {
  name: string;
  offerPrice: number;
  originalPrice: number;
  durationLabel: string;
  durationMinutes: number;
};

type RawSection = {
  title: string;
  items: CsvItem[];
};

const PAINTING_PLACEHOLDER_IMAGE = cdnImage('general-home-cleaning');

const PAINTING_SERVICE_SEEDS: Array<{
  serviceId: string;
  label: string;
  categorySlug: string;
  imageUrl: string;
  serviceSortOrder: number;
  packages: CsvItem[];
}> = [
  {
    serviceId: 'interior-painting',
    label: 'Interior Painting',
    categorySlug: 'painting-interior',
    imageUrl: PAINTING_PLACEHOLDER_IMAGE,
    serviceSortOrder: 1,
    packages: [
      { name: '1 Room Painting', offerPrice: 4999, originalPrice: 5999, durationLabel: '1 Day', durationMinutes: 480 },
      { name: '2 Rooms Painting', offerPrice: 8999, originalPrice: 10999, durationLabel: '1-2 Days', durationMinutes: 720 },
      { name: 'Full 1 BHK Painting', offerPrice: 8999, originalPrice: 10999, durationLabel: '1-2 Days', durationMinutes: 720 },
      { name: 'Full 2 BHK Painting', offerPrice: 11999, originalPrice: 14999, durationLabel: '2 Days', durationMinutes: 960 },
      { name: 'Full 3 BHK Painting', offerPrice: 15999, originalPrice: 19999, durationLabel: '2-3 Days', durationMinutes: 1200 },
      { name: 'Full 4 BHK Painting', offerPrice: 19999, originalPrice: 24999, durationLabel: '3-4 Days', durationMinutes: 1680 },
    ],
  },
  {
    serviceId: 'exterior-painting',
    label: 'Exterior Painting',
    categorySlug: 'painting-exterior',
    imageUrl: PAINTING_PLACEHOLDER_IMAGE,
    serviceSortOrder: 2,
    packages: [
      { name: 'Balcony / Small Exterior Area', offerPrice: 2999, originalPrice: 3999, durationLabel: '1 Day', durationMinutes: 480 },
      { name: 'Exterior Wall Painting', offerPrice: 4999, originalPrice: 6499, durationLabel: '1-2 Days', durationMinutes: 720 },
    ],
  },
  {
    serviceId: 'rental-painting',
    label: 'Rental Painting',
    categorySlug: 'painting-rental',
    imageUrl: PAINTING_PLACEHOLDER_IMAGE,
    serviceSortOrder: 3,
    packages: [
      { name: '1 BHK Rental Painting', offerPrice: 8999, originalPrice: 10999, durationLabel: '1-2 Days', durationMinutes: 720 },
      { name: '2 BHK Rental Painting', offerPrice: 11999, originalPrice: 14999, durationLabel: '2 Days', durationMinutes: 960 },
      { name: '3 BHK Rental Painting', offerPrice: 15999, originalPrice: 19999, durationLabel: '2-3 Days', durationMinutes: 1200 },
    ],
  },
  {
    serviceId: 'waterproofing',
    label: 'Waterproofing',
    categorySlug: 'painting-waterproofing',
    imageUrl: PAINTING_PLACEHOLDER_IMAGE,
    serviceSortOrder: 4,
    packages: [
      { name: 'Wall Waterproofing', offerPrice: 4999, originalPrice: 5999, durationLabel: '1 Day', durationMinutes: 480 },
      { name: 'Terrace Waterproofing', offerPrice: 5499, originalPrice: 6999, durationLabel: '1-2 Days', durationMinutes: 720 },
      { name: 'Bathroom / Kitchen Grouting', offerPrice: 2399, originalPrice: 2999, durationLabel: '3-5 Hours', durationMinutes: 300 },
    ],
  },
];

export type BookNowCsvServiceSeed = {
  serviceId: string;
  label: string;
  categorySlug: string;
  imageUrl: string;
  sectionId?: string;
  serviceSortOrder: number;
  packages: CsvItem[];
};

export type BookNowCsvHubSectionSeed = {
  slug: string;
  title: string;
  iconKey: string;
  sortOrder: number;
  services: BookNowCsvServiceSeed[];
};

export type BookNowCsvCategorySeed = {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  taskCategory: string;
  heroImageUrl: string;
  serviceLabel: string;
  topLevelCategory: string;
};

export type BookNowCsvPackageSeed = {
  categorySlug: string;
  skuSlug: string;
  name: string;
  offerPrice: number;
  originalPrice: number;
  durationLabel: string;
  durationMinutes: number;
  description: string;
  imageUrls: string[];
  sortOrder: number;
};

export type BookNowCsvSeed = {
  hubSections: BookNowCsvHubSectionSeed[];
  categories: BookNowCsvCategorySeed[];
  packages: BookNowCsvPackageSeed[];
};

function loadRawSections(): RawSection[] {
  const rows = parseCsv(fs.readFileSync(resolveCsvPath(), 'utf8'));
  const sections: RawSection[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const first = String(rows[i]?.[0] || '').replace(/\u00a0/g, ' ').trim();
    if (!first || first.toUpperCase() !== first || first === 'SERVICE') {
      continue;
    }

    const title = first;
    const items: CsvItem[] = [];
    let cursor = i + 1;
    const nextFirst = String(rows[cursor]?.[0] || '').replace(/\u00a0/g, ' ').trim();
    if (nextFirst.toUpperCase() === 'SERVICE') {
      cursor += 1;
    }
    i = cursor;

    while (i < rows.length) {
      const row = rows[i];
      const nextTitle = String(row?.[0] || '').replace(/\u00a0/g, ' ').trim();
      if (nextTitle && nextTitle.toUpperCase() === nextTitle && nextTitle !== 'SERVICE') {
        i -= 1;
        break;
      }

      if (row && row[0]) {
        const name = String(row[0] || '').trim();
        const offerPrice = parsePrice(row[1] || '');
        const originalPrice = parsePrice(row[2] || '') || offerPrice;
        const durationLabel = String(row[3] || '').trim();
        items.push({
          name,
          offerPrice,
          originalPrice,
          durationLabel,
          durationMinutes: parseDurationMinutes(durationLabel),
        });
      }
      i += 1;
    }

    sections.push({ title, items });
  }

  return sections;
}

function buildHomeCleaningServices(
  mainSection: RawSection,
): BookNowCsvServiceSeed[] {
  const buckets: Record<string, BookNowCsvServiceSeed> = {
    'full-house': {
      serviceId: 'full-house',
      label: 'Full House',
      categorySlug: 'full-house',
      imageUrl: cdnImage('fullhouse-booknow'),
      serviceSortOrder: 10,
      packages: [],
    },
    bathroom: {
      serviceId: 'bathroom',
      label: 'Bathroom',
      categorySlug: 'bathroom',
      imageUrl: cdnImage('bathroom-booknow'),
      serviceSortOrder: 20,
      packages: [],
    },
    kitchen: {
      serviceId: 'kitchen',
      label: 'Kitchen',
      categorySlug: 'kitchen',
      imageUrl: cdnImage('kitchen-booknow'),
      serviceSortOrder: 30,
      packages: [],
    },
    sofa: {
      serviceId: 'sofa',
      label: 'Sofa',
      categorySlug: 'sofa',
      imageUrl: cdnImage('sofa-booknow'),
      serviceSortOrder: 40,
      packages: [],
    },
    mattress: {
      serviceId: 'mattress',
      label: 'Mattress',
      categorySlug: 'mattress',
      imageUrl: cdnImage('mattress-cleaning-post_card'),
      serviceSortOrder: 50,
      packages: [],
    },
    'window-glass': {
      serviceId: 'window-glass',
      label: 'Window Glass',
      categorySlug: 'window-glass',
      imageUrl: cdnImage('window-glass-interior-post_card'),
      serviceSortOrder: 60,
      packages: [],
    },
  };

  mainSection.items.forEach((item) => {
    const name = item.name.toLowerCase();
    if (
      /^(\d+\s*bhk|1 bedroom combo|2 bedroom combo|full home deep clean)/i.test(item.name)
    ) {
      buckets['full-house'].packages.push(item);
      return;
    }
    if (name.startsWith('bathroom cleaning') || name.startsWith('deep bathroom cleaning')) {
      buckets.bathroom.packages.push(item);
      return;
    }
    if (
      name.includes('kitchen') ||
      name.includes('fridge cleaning') ||
      name.includes('chimney') ||
      name.includes('sink & under-sink') ||
      name.includes('gas stove')
    ) {
      buckets.kitchen.packages.push(item);
      return;
    }
    if (name.includes('mattress')) {
      buckets.mattress.packages.push(item);
      return;
    }
    if (name.includes('window cleaning')) {
      buckets['window-glass'].packages.push(item);
      return;
    }
    buckets.sofa.packages.push(item);
  });

  return Object.values(buckets)
    .filter((service) => service.packages.length > 0)
    .sort(
    (left, right) => left.serviceSortOrder - right.serviceSortOrder,
  );
}

function buildPrefixServices(
  section: RawSection,
  config: {
    slug: string;
    title: string;
    iconKey: string;
    sortOrder: number;
    categoryTask: string;
    serviceMap: Array<{
      match: RegExp;
      serviceId: string;
      label: string;
      categorySlug: string;
      imageUrl: string;
      sectionId?: string;
      sortOrder: number;
    }>;
  },
): BookNowCsvHubSectionSeed {
  const services = config.serviceMap
    .map((service) => ({
      serviceId: service.serviceId,
      label: service.label,
      categorySlug: service.categorySlug,
      imageUrl: service.imageUrl,
      sectionId: service.sectionId,
      serviceSortOrder: service.sortOrder,
      packages: section.items.filter((item) => service.match.test(item.name)),
    }))
    .filter((service) => service.packages.length > 0);

  return {
    slug: config.slug,
    title: config.title,
    iconKey: config.iconKey,
    sortOrder: config.sortOrder,
    services,
  };
}

function buildElectricianServices(section: RawSection): BookNowCsvHubSectionSeed {
  const serviceImageUrl = cdnImage('auto-electricians');
  const buckets = new Map<string, BookNowCsvServiceSeed>();

  section.items.forEach((item, index) => {
    const label = item.name.includes(' - ')
      ? item.name.split(' - ')[0].trim()
      : item.name.includes(' – ')
        ? item.name.split(' – ')[0].trim()
        : item.name.trim();
    const serviceId = slugify(label);
    if (!buckets.has(serviceId)) {
      buckets.set(serviceId, {
        serviceId,
        label,
        categorySlug: `electrician-${serviceId}`,
        imageUrl: serviceImageUrl,
        serviceSortOrder: index + 1,
        packages: [],
      });
    }
    buckets.get(serviceId)!.packages.push(item);
  });

  return {
    slug: 'electrician',
    title: 'Electrician',
    iconKey: 'Zap',
    sortOrder: 50,
    services: Array.from(buckets.values()),
  };
}

function buildPlumbingServices(section: RawSection): BookNowCsvHubSectionSeed {
  const rules = [
    {
      id: 'tap-mixer',
      label: 'Tap & Mixer',
      categorySlug: 'plumbing-tap-mixer',
      imageUrl: cdnImage('plumbing-tap-mixer'),
      match: /(tap|mixer)/i,
    },
    {
      id: 'toilet',
      label: 'Toilet',
      categorySlug: 'plumbing-toilet',
      imageUrl: cdnImage('plumbing-toilet'),
      match: /(toilet|flush|jet spray|seat cover)/i,
    },
    {
      id: 'basin-sink',
      label: 'Basin & Sink',
      categorySlug: 'plumbing-basin-sink',
      imageUrl: cdnImage('plumbing-basin-sink'),
      match: /(basin|sink)/i,
    },
    {
      id: 'bath-shower',
      label: 'Bath & Shower',
      categorySlug: 'plumbing-bath-shower',
      imageUrl: cdnImage('plumbing-bath-shower'),
      match: /(shower)/i,
    },
    {
      id: 'drainage-pipe',
      label: 'Drainage Pipe',
      categorySlug: 'plumbing-drainage-pipe',
      imageUrl: cdnImage('plumbing-drainage-pipe'),
      match: /(drain|blockage)/i,
    },
    {
      id: 'water-pipe-connection',
      label: 'Water Pipe',
      categorySlug: 'plumbing-water-pipe-connection',
      imageUrl: cdnImage('plumbing-water-pipe-connection'),
      match: /(water pipe|pipe repair|pipe replacement|pipe connection)/i,
    },
    {
      id: 'water-tank',
      label: 'Water Tank',
      categorySlug: 'plumbing-water-tank',
      imageUrl: cdnImage('plumbing-water-tank'),
      match: /(water tank)/i,
    },
    {
      id: 'grouting',
      label: 'Grouting',
      categorySlug: 'plumbing-grouting',
      imageUrl: cdnImage('plumbing-grouting'),
      match: /(grouting)/i,
    },
  ];

  const buckets = new Map<string, BookNowCsvServiceSeed>();
  section.items.forEach((item, index) => {
    const rule = rules.find((candidate) => candidate.match.test(item.name)) || {
      id: 'general',
      label: 'General Plumbing',
      categorySlug: 'plumbing',
      imageUrl: cdnImage('plumbing'),
    };
    if (!buckets.has(rule.id)) {
      buckets.set(rule.id, {
        serviceId: rule.id,
        label: rule.label,
        categorySlug: rule.categorySlug,
        imageUrl: rule.imageUrl,
        serviceSortOrder: index + 1,
        packages: [],
      });
    }
    buckets.get(rule.id)!.packages.push(item);
  });

  return {
    slug: 'plumbing',
    title: 'Plumbing',
    iconKey: 'Wrench',
    sortOrder: 60,
    services: Array.from(buckets.values()),
  };
}

function buildCarpentryServices(sectionMap: Map<string, RawSection>): BookNowCsvHubSectionSeed {
  const carpentrySections = [
    {
      title: 'CUPBOARD & DRAWER',
      serviceId: 'cupboard-drawer',
      label: 'Cupboard & Drawer',
      categorySlug: 'carpenter-cupboard-drawer',
      imageUrl: cdnImage('carpenter-cupboard-drawer'),
    },
    {
      title: 'KITCHEN FITTINGS',
      serviceId: 'kitchen-fittings',
      label: 'Kitchen Fittings',
      categorySlug: 'carpenter-kitchen-fittings',
      imageUrl: cdnImage('carpenter-cupboard-drawer'),
    },
    {
      title: 'SHELVES & WALL DÉCOR',
      serviceId: 'shelves-wall-decor',
      label: 'Shelves & Wall Decor',
      categorySlug: 'carpenter-shelves-wall-decor',
      imageUrl: cdnImage('carpenter-drill-hang'),
    },
    {
      title: 'WOODEN DOORS',
      serviceId: 'wooden-doors',
      label: 'Wooden Doors',
      categorySlug: 'carpenter-door',
      imageUrl: cdnImage('carpenter-door'),
    },
    {
      title: 'WINDOWS & CURTAINS',
      serviceId: 'windows-curtains',
      label: 'Windows & Curtains',
      categorySlug: 'carpenter-windows-curtain',
      imageUrl: cdnImage('carpenter-windows-curtain'),
    },
    {
      title: 'FURNITURE REPAIR',
      serviceId: 'furniture-repair',
      label: 'Furniture Repair',
      categorySlug: 'carpenter-furniture-repair',
      imageUrl: cdnImage('carpenter-bed'),
    },
    {
      title: 'FURNITURE ASSEMBLY',
      serviceId: 'furniture-assembly',
      label: 'Furniture Assembly',
      categorySlug: 'carpenter-furniture-assembly',
      imageUrl: cdnImage('carpenter-furniture-assembly'),
    },
    {
      title: 'WARDROBE ASSEMBLY',
      serviceId: 'wardrobe-assembly',
      label: 'Wardrobe Assembly',
      categorySlug: 'carpenter-wardrobe',
      imageUrl: cdnImage('carpenter-wardrobe'),
    },
    {
      title: 'CLOTHES HANGERS',
      serviceId: 'clothes-hangers',
      label: 'Clothes Hangers',
      categorySlug: 'carpenter-clothes-hangers',
      imageUrl: cdnImage('carpenter-drill-hang'),
    },
  ];

  return {
    slug: 'carpentry',
    title: 'Carpentry',
    iconKey: 'Hammer',
    sortOrder: 70,
    services: carpentrySections
      .map((entry, index) => {
        const section = sectionMap.get(entry.title);
        if (!section || section.items.length === 0) {
          return null;
        }
        return {
          serviceId: entry.serviceId,
          label: entry.label,
          categorySlug: entry.categorySlug,
          imageUrl: entry.imageUrl,
          serviceSortOrder: index + 1,
          packages: section.items,
        } satisfies BookNowCsvServiceSeed;
      })
      .filter(Boolean) as BookNowCsvServiceSeed[],
  };
}

function buildBeautyServices(): BookNowCsvHubSectionSeed {
  return {
    slug: 'beauty-services',
    title: 'Beauty Services',
    iconKey: 'Sparkles',
    sortOrder: 80,
    services: [
      {
        serviceId: 'womens-beauty',
        label: "Women's Beauty",
        categorySlug: 'womens-beauty',
        imageUrl: cdnImage('beauty-services'),
        serviceSortOrder: 1,
        packages: [],
      },
      {
        serviceId: 'womens-hair',
        label: "Women's Hair",
        categorySlug: 'womens-hair',
        imageUrl: cdnImage('beauty-services'),
        serviceSortOrder: 2,
        packages: [],
      },
      {
        serviceId: 'mens-grooming',
        label: "Men's Grooming",
        categorySlug: 'mens-grooming',
        imageUrl: cdnImage('beauty-services'),
        serviceSortOrder: 3,
        packages: [],
      },
      {
        serviceId: 'massage',
        label: 'Massage',
        categorySlug: 'massage',
        imageUrl: cdnImage('massage-spa'),
        serviceSortOrder: 4,
        packages: [],
      },
    ],
  };
}

function buildPaintingServices(): BookNowCsvHubSectionSeed {
  return {
    slug: 'painting',
    title: 'Painting',
    iconKey: 'Paintbrush',
    sortOrder: 85,
    services: PAINTING_SERVICE_SEEDS.map((service) => ({
      serviceId: service.serviceId,
      label: service.label,
      categorySlug: service.categorySlug,
      imageUrl: service.imageUrl,
      serviceSortOrder: service.serviceSortOrder,
      packages: service.packages,
    })),
  };
}

export function buildBookNowCsvSeed(): BookNowCsvSeed {
  const rawSections = loadRawSections();
  const sectionMap = new Map(rawSections.map((section) => [section.title, section] as const));

  const hubSections: BookNowCsvHubSectionSeed[] = [
    {
      slug: 'home-cleaning',
      title: 'Home Cleaning',
      iconKey: 'Broom',
      sortOrder: 10,
      services: buildHomeCleaningServices(
        sectionMap.get('HOME CLEANING') || { title: 'HOME CLEANING', items: [] },
      ),
    },
    buildPrefixServices(sectionMap.get('AC SERVICES') || { title: 'AC SERVICES', items: [] }, {
      slug: 'ac-services',
      title: 'AC Services',
      iconKey: 'Snowflake',
      sortOrder: 20,
      categoryTask: 'repair',
      serviceMap: [
        { match: /^AC Repair/i, serviceId: 'ac-repair', label: 'AC Repair', categorySlug: 'ac-services', imageUrl: cdnImage('acrepair-booknow'), sectionId: 'repair', sortOrder: 1 },
        { match: /^Foam Jet AC Service/i, serviceId: 'ac-servicing', label: 'AC Servicing', categorySlug: 'ac-services', imageUrl: cdnImage('acservicing-booknow'), sectionId: 'servicing', sortOrder: 2 },
        { match: /^AC Gas Refill/i, serviceId: 'gas-refill', label: 'Gas Refill', categorySlug: 'ac-services', imageUrl: cdnImage('gasrefill-booknow'), sectionId: 'gas-refill', sortOrder: 3 },
        { match: /^AC Installation/i, serviceId: 'install', label: 'Install', categorySlug: 'ac-services', imageUrl: cdnImage('acinstall-booknow'), sectionId: 'install', sortOrder: 4 },
        { match: /^AC Uninstallation/i, serviceId: 'uninstall', label: 'Uninstall', categorySlug: 'ac-services', imageUrl: cdnImage('acuninstall-booknow'), sectionId: 'uninstall', sortOrder: 5 },
      ],
    }),
    buildPrefixServices(sectionMap.get('APPLIANCES REPAIR') || { title: 'APPLIANCES REPAIR', items: [] }, {
      slug: 'appliance-repair',
      title: 'Appliance Repair',
      iconKey: 'Wrench',
      sortOrder: 30,
      categoryTask: 'repair',
      serviceMap: [
        { match: /^Washing Machine/i, serviceId: 'washing-machine', label: 'Washing Machine', categorySlug: 'appliance-repair', imageUrl: cdnImage('wachingmachinecheckup-booknow'), sectionId: 'washing-machine', sortOrder: 1 },
        { match: /^Refrigerator/i, serviceId: 'refrigerator', label: 'Refrigerator', categorySlug: 'appliance-repair', imageUrl: cdnImage('refrigeratorcheckup-booknow'), sectionId: 'refrigerator', sortOrder: 2 },
        { match: /^Water Purifier/i, serviceId: 'water-purifier', label: 'Water Purifier', categorySlug: 'appliance-repair', imageUrl: cdnImage('waterpurifiervheckup-booknow'), sectionId: 'water-purifier', sortOrder: 3 },
        { match: /^Geyser/i, serviceId: 'geyser', label: 'Geyser', categorySlug: 'appliance-repair', imageUrl: cdnImage('geysercheckup-booknow'), sectionId: 'geyser', sortOrder: 4 },
      ],
    }),
    buildPrefixServices(sectionMap.get('PEST CONTROL') || { title: 'PEST CONTROL', items: [] }, {
      slug: 'pest-control',
      title: 'Pest Control',
      iconKey: 'Bug',
      sortOrder: 40,
      categoryTask: 'cleaning',
      serviceMap: [
        { match: /^Cockroach Control/i, serviceId: 'cockroach-control', label: 'Cockroach Control', categorySlug: 'pest-control-cockroach-control', imageUrl: cdnImage('pest-control'), sortOrder: 1 },
        { match: /^Ant Control/i, serviceId: 'ant-control', label: 'Ant Control', categorySlug: 'pest-control-ant-control', imageUrl: cdnImage('ant-control'), sortOrder: 2 },
        { match: /^Bed Bug Control/i, serviceId: 'bed-bug-control', label: 'Bed Bug Control', categorySlug: 'pest-control-bed-bug-control', imageUrl: cdnImage('bed-bug-control'), sortOrder: 3 },
      ],
    }),
    buildElectricianServices(sectionMap.get('ELECTRICIAN') || { title: 'ELECTRICIAN', items: [] }),
    buildPlumbingServices(sectionMap.get('PLUMBING') || { title: 'PLUMBING', items: [] }),
    buildCarpentryServices(sectionMap),
    buildPaintingServices(),
    buildBeautyServices(),
  ].filter((section) => section.services.length > 0);

  const categories: BookNowCsvCategorySeed[] = [];
  const packages: BookNowCsvPackageSeed[] = [];
  let categorySort = 0;

  hubSections.forEach((hubSection) => {
    hubSection.services.forEach((service) => {
      categorySort += 10;
      categories.push({
        slug: service.categorySlug,
        name: service.label,
        description: `${service.label} under ${hubSection.title}`,
        sortOrder: categorySort,
        taskCategory:
          hubSection.slug === 'home-cleaning' || hubSection.slug === 'pest-control'
            ? 'cleaning'
            : hubSection.slug === 'painting'
              ? 'other'
            : hubSection.slug === 'beauty-services'
              ? 'other'
              : 'repair',
        heroImageUrl: service.imageUrl,
        serviceLabel: service.label,
        topLevelCategory: hubSection.title,
      });

      service.packages.forEach((item, index) => {
        const skuSlug = slugify(item.name);
        packages.push({
          categorySlug: service.categorySlug,
          skuSlug,
          name: item.name,
          offerPrice: item.offerPrice,
          originalPrice: item.originalPrice || item.offerPrice,
          durationLabel: item.durationLabel,
          durationMinutes: item.durationMinutes,
          description: `${item.durationLabel} • Offer ₹${item.offerPrice}${item.originalPrice ? ` from ₹${item.originalPrice}` : ''}`,
          imageUrls: service.imageUrl ? [service.imageUrl] : [],
          sortOrder: index,
        });
      });
    });
  });

  return { hubSections, categories, packages };
}
