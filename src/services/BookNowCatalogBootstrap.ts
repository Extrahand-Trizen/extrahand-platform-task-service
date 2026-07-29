import {
  HOURLY_DURATION_SKUS,
  HOURLY_HELPER_CATEGORY,
  HOURLY_HELPER_CATEGORY_SLUG,
} from '../constants/hourlyBooking';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import ServiceVariant from '../models/ServiceVariant';
import ServiceArea from '../models/ServiceArea';
import logger from '../config/logger';

type SeedCategory = { slug: string; name: string; sortOrder: number };
type SeedPackage = {
  catalogId: string;
  packageId: string;
  name: string;
  basePrice: number;
  durationMinutes: number;
  description: string;
};

const BATHROOM_TIER_PRICES: Record<string, Record<number, number>> = {
  'regular-clean': { 1: 249, 2: 469, 3: 679, 4: 879, 5: 1069 },
  'deep-clean': { 1: 399, 2: 749, 3: 1089, 4: 1419, 5: 1739 },
};

const TASK_CATEGORY_BY_CATALOG: Record<string, string> = {
  'full-house': 'cleaning',
  bathroom: 'cleaning',
  kitchen: 'cleaning',
  sofa: 'cleaning',
  mattress: 'cleaning',
  'window-glass': 'cleaning',
  'ac-services': 'repair',
  'appliance-repair': 'repair',
};

const SERVICE_CITIES = [
  'Bengaluru',
  'Hyderabad',
  'Mumbai',
  'Delhi',
  'Chennai',
  'Pune',
  'Kolkata',
];

function resolveSeedDataPath(): string {
  const candidates = [
    path.join(__dirname, '../data/book-now-catalog-seed-data.json'),
    path.join(process.cwd(), 'src/data/book-now-catalog-seed-data.json'),
    path.join(process.cwd(), 'scripts/book-now-catalog-seed-data.json'),
    path.join(process.cwd(), 'dist/data/book-now-catalog-seed-data.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('book-now-catalog-seed-data.json not found');
}

function loadSeedData(): { categories: SeedCategory[]; packages: SeedPackage[] } {
  const raw = fs.readFileSync(resolveSeedDataPath(), 'utf8');
  const data = JSON.parse(raw) as { categories: SeedCategory[]; packages: SeedPackage[] };

  if (!data.packages.some((p) => p.packageId === 'deep-clean' && p.catalogId === 'bathroom')) {
    data.packages.push({
      catalogId: 'bathroom',
      packageId: 'deep-clean',
      name: 'Deep Bathroom Cleaning',
      basePrice: 399,
      durationMinutes: 90,
      description: 'Deep bathroom cleaning with tile scrub and stain treatment.',
    });
  }

  return data;
}

export class BookNowCatalogBootstrap {
  /** Seed Hourly Helper category + duration SKUs (pricingUnit=hourly). Idempotent. */
  static async seedHourlyHelperCatalog(): Promise<{ categoryId: string; skus: number }> {
    const category = await ServiceCategory.findOneAndUpdate(
      { slug: HOURLY_HELPER_CATEGORY.slug },
      {
        slug: HOURLY_HELPER_CATEGORY.slug,
        name: HOURLY_HELPER_CATEGORY.name,
        description: HOURLY_HELPER_CATEGORY.description,
        sortOrder: HOURLY_HELPER_CATEGORY.sortOrder,
        isActive: true,
      },
      { upsert: true, new: true },
    );

    let skus = 0;
    for (const def of HOURLY_DURATION_SKUS) {
      const sku = await ServiceSku.findOneAndUpdate(
        { categoryId: category._id, slug: def.slug },
        {
          categoryId: category._id,
          slug: def.slug,
          name: def.name,
          description: def.description,
          basePrice: def.basePrice,
          pricingUnit: 'hourly',
          durationMinutes: def.durationMinutes,
          // Must match Task.category enum — `helper` is invalid and breaks payment-captured.
          taskCategory: 'other',
          isActive: true,
        },
        { upsert: true, new: true },
      );
      skus += 1;

      await ServiceVariant.findOneAndUpdate(
        { skuId: sku._id, slug: 'default' },
        {
          skuId: sku._id,
          slug: 'default',
          name: 'Standard',
          priceDelta: 0,
          durationDeltaMinutes: 0,
          isDefault: true,
          isActive: true,
        },
        { upsert: true, new: true },
      );
    }

    logger.info('Hourly Helper catalog seed complete', {
      categorySlug: HOURLY_HELPER_CATEGORY_SLUG,
      skus,
    });

    return { categoryId: String(category._id), skus };
  }

  static async run(): Promise<{ categories: number; skus: number }> {
    const { categories, packages } = loadSeedData();
    const categoryBySlug = new Map<string, mongoose.Types.ObjectId>();

    for (const cat of categories) {
      const doc = await ServiceCategory.findOneAndUpdate(
        { slug: cat.slug },
        {
          slug: cat.slug,
          name: cat.name,
          description: `${cat.name} — Book Now`,
          sortOrder: cat.sortOrder,
          isActive: true,
        },
        { upsert: true, new: true },
      );
      categoryBySlug.set(cat.slug, doc._id);
    }

    let skuCount = 0;
    for (const pkg of packages) {
      const categoryId = categoryBySlug.get(pkg.catalogId);
      if (!categoryId) continue;

      const taskCategory = TASK_CATEGORY_BY_CATALOG[pkg.catalogId] || 'cleaning';

      const sku = await ServiceSku.findOneAndUpdate(
        { categoryId, slug: pkg.packageId },
        {
          categoryId,
          slug: pkg.packageId,
          name: pkg.name,
          description: pkg.description,
          basePrice: pkg.basePrice,
          pricingUnit: 'fixed',
          durationMinutes: pkg.durationMinutes,
          taskCategory,
          isActive: true,
        },
        { upsert: true, new: true },
      );
      skuCount += 1;

      const bathroomTiers = BATHROOM_TIER_PRICES[pkg.packageId];
      if (bathroomTiers) {
        for (const [countStr, tierPrice] of Object.entries(bathroomTiers)) {
          const count = Number(countStr);
          const variantSlug = `bathrooms-${count}`;
          await ServiceVariant.findOneAndUpdate(
            { skuId: sku._id, slug: variantSlug },
            {
              skuId: sku._id,
              slug: variantSlug,
              name: count === 1 ? '1 Bathroom' : `${count} Bathrooms`,
              priceDelta: tierPrice - pkg.basePrice,
              durationDeltaMinutes: Math.max(0, (count - 1) * 30),
              isDefault: count === 1,
              isActive: true,
            },
            { upsert: true, new: true },
          );
        }
      } else {
        await ServiceVariant.findOneAndUpdate(
          { skuId: sku._id, slug: 'default' },
          {
            skuId: sku._id,
            slug: 'default',
            name: 'Standard',
            priceDelta: 0,
            durationDeltaMinutes: 0,
            isDefault: true,
            isActive: true,
          },
          { upsert: true, new: true },
        );
      }
    }

    for (const city of SERVICE_CITIES) {
      await ServiceArea.findOneAndUpdate(
        { city },
        { city, pinCodes: [], isActive: true },
        { upsert: true, new: true },
      );
    }

    await ServiceArea.findOneAndUpdate(
      { city: 'Bengaluru', pinCodes: { $in: ['560001', '560034', '560038', '560103'] } },
      {
        city: 'Bengaluru',
        pinCodes: ['560001', '560034', '560038', '560103'],
        isActive: true,
      },
      { upsert: true, new: true },
    );

    const hourly = await BookNowCatalogBootstrap.seedHourlyHelperCatalog();

    logger.info('Book Now catalog bootstrap complete', {
      categories: categories.length + 1,
      skus: skuCount + hourly.skus,
      hourlyHelperSkus: hourly.skus,
      serviceCities: SERVICE_CITIES.length,
    });

    return { categories: categories.length + 1, skus: skuCount + hourly.skus };
  }
}
