import {
  PERSONAL_ASSISTANT_CATEGORY,
  LEGACY_PERSONAL_ASSISTANT_CATEGORY_SLUG,
  PERSONAL_ASSISTANT_CATEGORY_SLUG,
  PERSONAL_ASSISTANT_DURATION_SKUS,
} from '../constants/personalAssistantBooking';
import { personalAssistantCatalogIsActive } from '../utils/personalAssistantCatalogVisibility';
import { BOOK_NOW_CATEGORY_HERO_IMAGE_BY_SLUG } from '../constants/bookNowHubCatalog';
import BookNowCategoryContent from '../models/BookNowCategoryContent';
import BookNowHubSection from '../models/BookNowHubSection';
import BookNowSkuContent from '../models/BookNowSkuContent';
import BookNowServiceLocationAvailability from '../models/BookNowServiceLocationAvailability';
import BookingItem from '../models/BookingItem';
import BookingOrder from '../models/BookingOrder';
import Task from '../models/Task';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import ServiceVariant from '../models/ServiceVariant';
import ServiceArea from '../models/ServiceArea';
import logger from '../config/logger';
import {
  DAILY_LABOUR_CATEGORY,
  DAILY_LABOUR_OPTIONS,
} from '../constants/dailyLabour';

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
  static async migratePersonalAssistantCategorySlug(): Promise<void> {
    const oldSlug = LEGACY_PERSONAL_ASSISTANT_CATEGORY_SLUG;
    const newSlug = PERSONAL_ASSISTANT_CATEGORY_SLUG;
    const [oldCategory, newCategory, oldContent, newContent, oldHub, newHub] = await Promise.all([
      ServiceCategory.findOne({ slug: oldSlug }).lean(),
      ServiceCategory.findOne({ slug: newSlug }).lean(),
      BookNowCategoryContent.findOne({ categorySlug: oldSlug }).lean(),
      BookNowCategoryContent.findOne({ categorySlug: newSlug }).lean(),
      BookNowHubSection.findOne({ slug: oldSlug }).lean(),
      BookNowHubSection.findOne({ slug: newSlug }).lean(),
    ]);

    if (oldCategory && newCategory) {
      const oldSkus = await ServiceSku.find({ categoryId: oldCategory._id })
        .select('_id slug')
        .lean();
      const newSkuSlugs = new Set(
        (await ServiceSku.find({ categoryId: newCategory._id }).select('slug').lean())
          .map((sku) => sku.slug),
      );
      for (const sku of oldSkus) {
        if (newSkuSlugs.has(sku.slug)) {
          await ServiceSku.updateOne({ _id: sku._id }, { $set: { isActive: false } });
        } else {
          await ServiceSku.updateOne(
            { _id: sku._id },
            { $set: { categoryId: newCategory._id } },
          );
          newSkuSlugs.add(sku.slug);
        }
      }
      if (
        Number(oldCategory.minOrderValue || 0) > 0 &&
        Number(newCategory.minOrderValue || 0) <= 0
      ) {
        await ServiceCategory.updateOne(
          { _id: newCategory._id },
          { $set: { minOrderValue: oldCategory.minOrderValue } },
        );
      }
      await ServiceCategory.deleteOne({ _id: oldCategory._id });
    } else if (oldCategory) {
      await ServiceCategory.updateOne(
        { _id: oldCategory._id },
        { $set: { slug: newSlug } },
      );
    }

    if (oldContent && newContent) {
      await BookNowCategoryContent.deleteOne({ _id: oldContent._id });
    } else if (oldContent) {
      await BookNowCategoryContent.updateOne(
        { _id: oldContent._id },
        { $set: { categorySlug: newSlug } },
      );
    }

    if (oldHub && newHub) {
      const mergedServices = new Map<string, Record<string, unknown>>();
      for (const service of [...oldHub.services, ...newHub.services]) {
        const normalizedService = {
          ...service,
          serviceId: service.serviceId === oldSlug ? newSlug : service.serviceId,
          categorySlug: service.categorySlug === oldSlug ? newSlug : service.categorySlug,
        };
        mergedServices.set(
          `${normalizedService.serviceId}:${normalizedService.categorySlug}`,
          normalizedService,
        );
      }
      await BookNowHubSection.updateOne(
        { _id: newHub._id },
        { $set: { services: [...mergedServices.values()] } },
      );
      await BookNowHubSection.deleteOne({ _id: oldHub._id });
    } else if (oldHub) {
      await BookNowHubSection.updateOne(
        { _id: oldHub._id },
        {
          $set: {
            slug: newSlug,
            services: oldHub.services.map((service) => ({
              ...service,
              serviceId: service.serviceId === oldSlug ? newSlug : service.serviceId,
              categorySlug: service.categorySlug === oldSlug ? newSlug : service.categorySlug,
            })),
          },
        },
      );
    }

    await Promise.all([
      BookNowHubSection.updateMany(
        { 'services.serviceId': oldSlug },
        { $set: { 'services.$[service].serviceId': newSlug } },
        { arrayFilters: [{ 'service.serviceId': oldSlug }] },
      ),
      BookNowHubSection.updateMany(
        { 'services.categorySlug': oldSlug },
        { $set: { 'services.$[service].categorySlug': newSlug } },
        { arrayFilters: [{ 'service.categorySlug': oldSlug }] },
      ),
      Task.updateMany(
        { categorySlug: oldSlug },
        { $set: { categorySlug: newSlug } },
      ),
      BookingItem.updateMany(
        { 'skuSnapshot.categorySlug': oldSlug },
        { $set: { 'skuSnapshot.categorySlug': newSlug } },
      ),
      BookingOrder.updateMany(
        { 'pendingLines.categorySlug': oldSlug },
        { $set: { 'pendingLines.$[line].categorySlug': newSlug } },
        { arrayFilters: [{ 'line.categorySlug': oldSlug }] },
      ),
      BookingOrder.updateMany(
        { 'pendingLines.catalogId': oldSlug },
        { $set: { 'pendingLines.$[line].catalogId': newSlug } },
        { arrayFilters: [{ 'line.catalogId': oldSlug }] },
      ),
    ]);

    const oldSkuContent = await BookNowSkuContent.find({ categorySlug: oldSlug }).lean();
    for (const content of oldSkuContent) {
      const existing = await BookNowSkuContent.findOne({
        categorySlug: newSlug,
        skuSlug: content.skuSlug,
      }).select('_id').lean();
      if (existing) {
        await BookNowSkuContent.deleteOne({ _id: content._id });
      } else {
        await BookNowSkuContent.updateOne(
          { _id: content._id },
          { $set: { categorySlug: newSlug } },
        );
      }
    }

    const oldAvailability = await BookNowServiceLocationAvailability.find({
      catalogId: oldSlug,
    }).lean();
    for (const availability of oldAvailability) {
      const existing = await BookNowServiceLocationAvailability.findOne({
        catalogId: newSlug,
        locationType: availability.locationType,
        locationId: availability.locationId,
      }).select('_id').lean();
      if (existing) {
        await BookNowServiceLocationAvailability.deleteOne({ _id: availability._id });
      } else {
        await BookNowServiceLocationAvailability.updateOne(
          { _id: availability._id },
          { $set: { catalogId: newSlug } },
        );
      }
    }

    logger.info('Personal Assistant category slug migration complete', {
      oldSlug,
      newSlug,
    });
  }

  static async deactivateDailyLabourCatalog(): Promise<{
    active: false;
    categories: number;
    categoryContent: number;
    hubSections: number;
    skus: number;
    variants: number;
  }> {
    const category = await ServiceCategory.findOne({ slug: DAILY_LABOUR_CATEGORY.slug })
      .select('_id')
      .lean();
    const skuIds = category
      ? await ServiceSku.find({
          categoryId: category._id,
          slug: { $in: DAILY_LABOUR_OPTIONS.map((option) => option.slug) },
        })
          .distinct('_id')
      : [];

    const [categoryResult, contentResult, hubResult, skuResult, variantResult] =
      await Promise.all([
        ServiceCategory.updateOne(
          { slug: DAILY_LABOUR_CATEGORY.slug },
          { $set: { isActive: false } },
        ),
        BookNowCategoryContent.updateOne(
          { categorySlug: DAILY_LABOUR_CATEGORY.slug },
          { $set: { isActive: false } },
        ),
        BookNowHubSection.updateOne(
          { slug: DAILY_LABOUR_CATEGORY.slug },
          {
            $set: {
              isActive: false,
              'services.$[].isActive': false,
            },
          },
        ),
        category
          ? ServiceSku.updateMany(
              {
                categoryId: category._id,
                slug: { $in: DAILY_LABOUR_OPTIONS.map((option) => option.slug) },
              },
              { $set: { isActive: false } },
            )
          : Promise.resolve({ modifiedCount: 0 }),
        skuIds.length > 0
          ? ServiceVariant.updateMany(
              { skuId: { $in: skuIds } },
              { $set: { isActive: false } },
            )
          : Promise.resolve({ modifiedCount: 0 }),
      ]);
    const result = {
      active: false as const,
      categories: categoryResult.modifiedCount,
      categoryContent: contentResult.modifiedCount,
      hubSections: hubResult.modifiedCount,
      skus: skuResult.modifiedCount,
      variants: variantResult.modifiedCount,
    };
    logger.info('Daily Labour catalog deactivated', {
      categorySlug: DAILY_LABOUR_CATEGORY.slug,
      ...result,
    });
    return result;
  }

  static async deactivateFullHomeDeepClean(): Promise<{
    active: false;
    skus: number;
    variants: number;
  }> {
    const skuSlugs = ['full-home-deep', 'full-home-deep-clean'];
    const category = await ServiceCategory.findOne({ slug: 'full-house' })
      .select('_id')
      .lean();
    const skuIds = category
      ? await ServiceSku.find({
          categoryId: category._id,
          $or: [
            { slug: { $in: skuSlugs } },
            { name: /^full home deep clean$/i },
          ],
        }).distinct('_id')
      : [];

    const [skuResult, variantResult] = await Promise.all([
      category
        ? ServiceSku.updateMany(
            {
              categoryId: category._id,
              $or: [
                { slug: { $in: skuSlugs } },
                { name: /^full home deep clean$/i },
              ],
            },
            { $set: { isActive: false } },
          )
        : Promise.resolve({ modifiedCount: 0 }),
      skuIds.length > 0
        ? ServiceVariant.updateMany(
            { skuId: { $in: skuIds } },
            { $set: { isActive: false } },
          )
        : Promise.resolve({ modifiedCount: 0 }),
    ]);

    const result = {
      active: false as const,
      skus: skuResult.modifiedCount,
      variants: variantResult.modifiedCount,
    };
    logger.info('Full Home Deep Clean catalog item deactivated', {
      categorySlug: 'full-house',
      skuSlugs,
      ...result,
    });
    return result;
  }

  /** Seed Personal Assistant category + duration SKUs. Idempotent. */
  static async seedPersonalAssistantCatalog(): Promise<{ categoryId: string; skus: number }> {
    await BookNowCatalogBootstrap.migratePersonalAssistantCategorySlug();
    const isActive = personalAssistantCatalogIsActive();
    const heroImageUrl =
      BOOK_NOW_CATEGORY_HERO_IMAGE_BY_SLUG[PERSONAL_ASSISTANT_CATEGORY_SLUG] || '';

    const category = await ServiceCategory.findOneAndUpdate(
      { slug: PERSONAL_ASSISTANT_CATEGORY.slug },
      {
        slug: PERSONAL_ASSISTANT_CATEGORY.slug,
        name: PERSONAL_ASSISTANT_CATEGORY.name,
        description: PERSONAL_ASSISTANT_CATEGORY.description,
        iconUrl: heroImageUrl,
        sortOrder: PERSONAL_ASSISTANT_CATEGORY.sortOrder,
        isActive,
      },
      { upsert: true, new: true },
    );

    await BookNowCategoryContent.findOneAndUpdate(
      { categorySlug: PERSONAL_ASSISTANT_CATEGORY.slug },
      {
        categorySlug: PERSONAL_ASSISTANT_CATEGORY.slug,
        title: PERSONAL_ASSISTANT_CATEGORY.name,
        subtitle: 'Personal Assistance',
        description: PERSONAL_ASSISTANT_CATEGORY.description,
        heroImageUrl,
        faqCategoryKeys: [],
        sortOrder: PERSONAL_ASSISTANT_CATEGORY.sortOrder,
        isActive,
      },
      { upsert: true, new: true },
    );

    await BookNowHubSection.findOneAndUpdate(
      { slug: PERSONAL_ASSISTANT_CATEGORY.slug },
      {
        slug: PERSONAL_ASSISTANT_CATEGORY.slug,
        title: PERSONAL_ASSISTANT_CATEGORY.name,
        iconKey: 'User',
        sortOrder: PERSONAL_ASSISTANT_CATEGORY.sortOrder,
        services: [
          {
            serviceId: PERSONAL_ASSISTANT_CATEGORY_SLUG,
            label: 'Personal Assistant',
            categorySlug: PERSONAL_ASSISTANT_CATEGORY_SLUG,
            sectionId: '',
            imageUrl: heroImageUrl,
            sortOrder: 10,
            isActive,
          },
        ],
        isActive,
      },
      { upsert: true, new: true },
    );

    let skus = 0;
    for (const def of PERSONAL_ASSISTANT_DURATION_SKUS) {
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
          taskCategory: 'other',
          isActive,
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
          isActive,
        },
        { upsert: true, new: true },
      );
    }

    logger.info('Personal Assistant catalog seed complete', {
      categorySlug: PERSONAL_ASSISTANT_CATEGORY_SLUG,
      skus,
      isActive,
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

    await BookNowCatalogBootstrap.deactivateFullHomeDeepClean();

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

    logger.info('Book Now catalog bootstrap complete', {
      categories: categories.length,
      skus: skuCount,
      serviceCities: SERVICE_CITIES.length,
    });

    return { categories: categories.length, skus: skuCount };
  }
}
