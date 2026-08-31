import { Database } from '../config/database';
import logger from '../config/logger';
import BookNowSkuContent from '../models/BookNowSkuContent';
import BookNowCategoryContent from '../models/BookNowCategoryContent';
import HelpSupportContent from '../models/HelpSupportContent';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import BookNowHubSection from '../models/BookNowHubSection';
import {
  BOOK_NOW_SERVICE_DETAILS,
} from '../constants/bookNowServiceDetails';
import {
  BOOK_NOW_CATEGORY_CONTENT_SEED,
} from '../constants/bookNowCategoryContentSeed';
import {
  BOOK_NOW_CATEGORY_HERO_IMAGE_BY_SLUG,
  BOOK_NOW_PACKAGE_IMAGE_URLS_BY_CATEGORY_AND_SKU,
} from '../constants/bookNowHubCatalog';
import {
  HELP_SUPPORT_SEED_DATA,
} from '../constants/helpSupportSeedData';
import {
  BEAUTY_OFFER_CATEGORIES,
  BEAUTY_OFFER_SERVICES,
} from '../constants/beautyOfferCatalogSeed';
import { buildBookNowCsvSeed } from '../utils/bookNowCsvCatalogSeed';
import { loadSupplementalBookNowContentSeed } from '../utils/bookNowSupplementalContentSeed';
import { BookNowCatalogBootstrap } from '../services/BookNowCatalogBootstrap';
import {
  PERSONAL_ASSISTANT_CATEGORY,
  PERSONAL_ASSISTANT_CATEGORY_SLUG,
} from '../constants/personalAssistantBooking';
import { personalAssistantCatalogIsActive } from '../utils/personalAssistantCatalogVisibility';

const BOOK_NOW_SKU_CONTENT_OVERRIDES: Record<
  string,
  {
    includes: string[];
    excludes: string[];
    faqItems: Array<{ question: string; answer: string }>;
  }
> = {
  'pest-control-ant-control::ant-control-kitchen-only': {
    includes: [
      'Inspection of kitchen and ant-prone areas',
      'Treatment around counters and cabinets',
      'Treatment of common ant entry points',
      'Professional ant-control treatment',
    ],
    excludes: [
      'Removal/restocking of utensils',
      'Treatment of cockroaches, termites, rodents or other pests',
    ],
    faqItems: [
      { question: 'Do I need to remove utensils?', answer: 'Yes, clear utensils and exposed food before treatment.' },
      { question: 'Which areas are treated?', answer: 'Counters, cabinets, corners, gaps and common ant entry points.' },
      { question: 'Is the service safe for children and pets?', answer: 'Keep children and pets away from treated areas until the treatment has dried.' },
      { question: 'Is cleaning included?', answer: 'No, post-treatment cleaning is not included.' },
    ],
  },
  'pest-control-ant-control::ant-control-kitchen-1-bedroom': {
    includes: [
      'Inspection of kitchen and bedroom',
      'Treatment of ant-prone areas',
      'Treatment around cabinets, corners and gaps',
      'Professional ant-control treatment',
    ],
    excludes: [
      'Removal/restocking of household items',
      'Treatment of unrelated pest infestations',
    ],
    faqItems: [
      { question: 'What areas are covered?', answer: 'Kitchen and one bedroom.' },
      { question: 'Should food and utensils be removed?', answer: 'Yes, clear food and utensils from treatment areas.' },
      { question: 'Is furniture shifting included?', answer: 'No, heavy furniture movement is not included.' },
      { question: 'Is post-treatment cleaning included?', answer: 'No.' },
    ],
  },
  'pest-control-ant-control::ant-control-kitchen-2-bedrooms': {
    includes: [
      'Inspection of kitchen and two bedrooms',
      'Treatment of visible ant activity',
      'Treatment of entry points and hiding areas',
      'Professional ant-control application',
    ],
    excludes: [
      'Removal/restocking of household items',
      'Treatment of other pests',
    ],
    faqItems: [
      { question: 'What is covered?', answer: 'Kitchen and two bedrooms.' },
      { question: 'Do I need to clear the kitchen?', answer: 'Yes, food and utensils should be cleared from treatment areas.' },
      { question: 'Are heavy items moved?', answer: 'No, heavy furniture or household items are not moved.' },
      { question: 'Can children and pets stay during treatment?', answer: 'They should stay away from treated areas until they are safe to re-enter.' },
    ],
  },
  'pest-control-ant-control::ant-control-kitchen-3-bedrooms': {
    includes: [
      'Inspection of kitchen and three bedrooms',
      'Treatment of ant-prone areas',
      'Treatment around cabinets, corners and crevices',
      'Professional ant-control treatment',
    ],
    excludes: [
      'Removal/restocking of household items',
      'Treatment of unrelated pests',
    ],
    faqItems: [
      { question: 'What areas are treated?', answer: 'Kitchen and three bedrooms.' },
      { question: 'Should food and utensils be removed?', answer: 'Yes, clear them before treatment.' },
      { question: 'Is furniture shifting included?', answer: 'No, heavy furniture movement is not included.' },
      { question: 'Is cleaning included?', answer: 'No.' },
    ],
  },
  'pest-control-ant-control::ant-control-1-bhk': {
    includes: [
      'Inspection of complete 1 BHK',
      'Treatment of kitchen, bedroom and common areas',
      'Treatment of ant entry points and hiding areas',
      'Professional ant-control treatment',
    ],
    excludes: [
      'Removal/restocking of household items',
      'Treatment of other pests',
    ],
    faqItems: [
      { question: 'What does 1 BHK treatment cover?', answer: 'Kitchen, bedroom, living area and common ant-prone locations.' },
      { question: 'Should food be cleared?', answer: 'Yes, exposed food should be removed from treatment areas.' },
      { question: 'Is furniture movement included?', answer: 'No heavy furniture movement is included.' },
      { question: 'Is deep cleaning included?', answer: 'No.' },
    ],
  },
  'pest-control-ant-control::ant-control-2-bhk': {
    includes: [
      'Inspection of complete 2 BHK',
      'Treatment of kitchen, bedrooms and common areas',
      'Treatment of entry points and hiding areas',
      'Professional ant-control application',
    ],
    excludes: [
      'Removal/restocking of belongings',
      'Treatment of unrelated pests',
    ],
    faqItems: [
      { question: 'What areas are covered?', answer: 'Kitchen, bedrooms and suitable common areas.' },
      { question: 'Should utensils be removed?', answer: 'Yes, utensils and exposed food should be cleared.' },
      { question: 'Is furniture shifting included?', answer: 'No heavy furniture movement is included.' },
      { question: 'Is post-treatment cleaning included?', answer: 'No.' },
    ],
  },
  'pest-control-ant-control::ant-control-3-bhk-villa': {
    includes: [
      'Inspection of property and ant-prone areas',
      'Treatment of kitchen, rooms and common areas',
      'Treatment of entry points, gaps and hiding spots',
      'Professional ant-control application',
    ],
    excludes: [
      'Utensil removal/restocking',
      'Treatment of rodents, termites, wasps or other pests',
    ],
    faqItems: [
      { question: 'What does the service cover?', answer: 'Kitchen, rooms and common ant-prone residential areas.' },
      { question: 'Do I need to remove utensils?', answer: 'Yes, clear utensils and exposed food before treatment.' },
      { question: 'Is restocking included?', answer: 'No, putting household items back is not included.' },
      { question: 'Are other pests included?', answer: 'No, other pest treatments require a separate service.' },
    ],
  },
  'pest-control-cockroach-control::cockroach-control-kitchen-only': {
    includes: [
      'Inspection of kitchen and cockroach-prone areas',
      'Treatment of cabinets, corners, sink area and gaps',
      'Treatment of visible and hidden cockroach activity areas',
      'Application of professional pest-control treatment',
    ],
    excludes: [
      'Removal/restocking of utensils',
      'Treatment of rodents, termites or other unrelated pests',
    ],
    faqItems: [
      { question: 'Is the service safe for children and pets?', answer: 'Keep children and pets away from the treated area until the treatment has completely dried.' },
      { question: 'Do I need to remove utensils?', answer: 'Yes, utensils and food items should be cleared from the areas being treated.' },
      { question: 'Will the professional put the utensils back?', answer: 'No, arranging and restocking utensils is not included.' },
      { question: 'Which areas are treated?', answer: 'Cabinets, corners, sink areas, gaps, crevices and other cockroach-prone areas in the kitchen.' },
    ],
  },
  'pest-control-cockroach-control::cockroach-control-kitchen-1-bedroom': {
    includes: [
      'Inspection of the kitchen and bedroom',
      'Treatment of cockroach-prone areas and hiding spots',
      'Treatment around cabinets, corners, gaps and crevices',
      'Professional pest-control treatment in affected areas',
    ],
    excludes: [
      'Removal/restocking of utensils and household items',
      'Treatment of unrelated pests such as rodents or termites',
    ],
    faqItems: [
      { question: 'Do I need to prepare the areas?', answer: 'Yes, food, utensils and easily movable items should be cleared from treatment areas.' },
      { question: 'Is bedroom treatment included?', answer: 'Yes, the bedroom is inspected and treated in suitable cockroach-prone areas.' },
      { question: 'Can we stay in the room during treatment?', answer: 'No, occupants should stay away from the treated area during application and until it is safe to re-enter.' },
      { question: 'Is cleaning included?', answer: 'No, deep cleaning after treatment is not included.' },
    ],
  },
  'pest-control-cockroach-control::cockroach-control-kitchen-2-bedrooms': {
    includes: [
      'Inspection of kitchen and two bedrooms',
      'Treatment of cockroach hiding and activity areas',
      'Treatment around cabinets, corners, gaps and crevices',
      'Professional pest-control application in affected areas',
    ],
    excludes: [
      'Removal/restocking of utensils and personal belongings',
      'Treatment of pests other than cockroaches',
    ],
    faqItems: [
      { question: 'What areas are covered?', answer: 'The kitchen and two bedrooms included in the selected service are covered.' },
      { question: 'Do I need to remove food items?', answer: 'Yes, food and exposed consumable items should be removed before treatment.' },
      { question: 'Does the service include moving furniture?', answer: 'No, heavy furniture or large household items are not included in the service.' },
      { question: 'Is post-treatment cleaning included?', answer: 'No, cleaning and rearranging household items are not included.' },
    ],
  },
  'pest-control-cockroach-control::cockroach-control-kitchen-3-bedrooms': {
    includes: [
      'Inspection of kitchen and three bedrooms',
      'Treatment of identified cockroach-prone areas',
      'Treatment around cabinets, corners, gaps and crevices',
      'Professional pest-control application in affected areas',
    ],
    excludes: [
      'Removal/restocking of utensils and household belongings',
      'Treatment of other pest problems not related to cockroaches',
    ],
    faqItems: [
      { question: 'What is covered?', answer: 'The selected kitchen and three bedrooms are inspected and treated.' },
      { question: 'Should utensils and food be removed?', answer: 'Yes, exposed food and utensils should be cleared from treatment areas.' },
      { question: 'Are large furniture items moved?', answer: 'No, moving heavy furniture is not included.' },
      { question: 'Can children and pets remain inside?', answer: 'They should stay away from treated areas during application and until the treatment has dried.' },
    ],
  },
  'pest-control-cockroach-control::cockroach-control-1-bhk': {
    includes: [
      'Inspection of the complete 1 BHK space',
      'Treatment of kitchen, living area and bedroom cockroach-prone locations',
      'Treatment of corners, gaps, cabinets and hiding areas',
      'Professional pest-control treatment in affected areas',
    ],
    excludes: [
      'Removal/restocking of household items',
      'Treatment of unrelated pests such as termites, rodents or bed bugs',
    ],
    faqItems: [
      { question: 'What does 1 BHK treatment cover?', answer: 'The kitchen, bedroom, living area and other suitable cockroach-prone areas within the 1 BHK are covered.' },
      { question: 'Do I need to prepare the home?', answer: 'Yes, food, utensils and exposed items should be cleared from treatment areas.' },
      { question: 'Is furniture shifting included?', answer: 'No, heavy furniture shifting is not included.' },
      { question: 'Is deep cleaning included?', answer: 'No, post-treatment deep cleaning is not part of the service.' },
    ],
  },
  'pest-control-cockroach-control::cockroach-control-2-bhk': {
    includes: [
      'Inspection of the complete 2 BHK space',
      'Treatment of kitchen, bedrooms and common cockroach-prone areas',
      'Treatment around cabinets, corners, gaps and crevices',
      'Professional pest-control application in affected areas',
    ],
    excludes: [
      'Removal/restocking of household belongings',
      'Treatment of unrelated pest infestations',
    ],
    faqItems: [
      { question: 'What does 2 BHK treatment cover?', answer: 'The kitchen, bedrooms, living/common areas and suitable cockroach-prone locations are covered.' },
      { question: 'Should food and utensils be removed?', answer: 'Yes, exposed food and utensils should be cleared before treatment.' },
      { question: 'Does the professional move heavy furniture?', answer: 'No, heavy furniture movement is excluded.' },
      { question: 'Can we stay during treatment?', answer: 'Occupants should leave the treated areas during application and return only after they are safe to re-enter.' },
    ],
  },
  'pest-control-cockroach-control::cockroach-control-3-bhk-villa': {
    includes: [
      'Inspection of the selected home/villa and cockroach-prone areas',
      'Treatment of kitchen, rooms and common areas',
      'Treatment of hiding spots, corners, gaps and crevices',
      'Professional pest-control application in affected areas',
    ],
    excludes: [
      'Removal/restocking of utensils and household items',
      'Treatment of unrelated pests or extensive structural repairs',
    ],
    faqItems: [
      { question: 'What does 3+ BHK/Villa treatment cover?', answer: 'The selected residential areas, kitchen, rooms and common cockroach-prone locations are inspected and treated.' },
      { question: 'Do I need to prepare the property?', answer: 'Yes, exposed food, utensils and movable items should be cleared from treatment areas.' },
      { question: 'Is heavy furniture movement included?', answer: 'No, heavy furniture shifting is not included.' },
      { question: 'Is deep cleaning included?', answer: 'No, deep cleaning and post-treatment housekeeping are not included.' },
    ],
  },
};

const LAUNDRY_SKU_CONTENT_OVERRIDES: Record<
  string,
  {
    includes: string[];
    excludes: string[];
    faqItems: Array<{ question: string; answer: string }>;
  }
> = {
  'laundry-wash-by-weight::clothes-washing-per-kg': {
    includes: [
      'Sorting of washable clothes',
      'Washing with detergent',
      'Rinsing and basic drying arrangement',
      'Folding after wash',
    ],
    excludes: [
      'Sarees and traditional wear',
      'Dry cleaning and heavy stain treatment',
      'Bleach treatment, fabric repair and ironing',
    ],
    faqItems: [
      { question: 'Is detergent included?', answer: 'Yes, detergent is included in the service.' },
      { question: 'Is ironing included?', answer: 'No, ironing is not included in clothes washing.' },
      { question: 'Can delicate clothes be washed?', answer: 'Only if the garments are suitable for normal washing.' },
    ],
  },
  'laundry-wash-by-weight::wash-and-iron-per-kg': {
    includes: [
      'Sorting of washable clothes',
      'Washing and drying arrangement',
      'Ironing after wash',
      'Folding after ironing',
    ],
    excludes: [
      'Sarees and traditional wear',
      'Dry cleaning and heavy stain treatment',
      'Bleach treatment, fabric repair and specialized delicate-garment care',
    ],
    faqItems: [
      { question: 'Does this include washing and ironing?', answer: 'Yes, it includes both washing and ironing.' },
      { question: 'Are stains guaranteed to come out?', answer: 'No, stain removal depends on fabric type and stain condition.' },
      { question: 'Can formal clothes be included?', answer: 'Only if they are suitable for normal wash and iron handling.' },
    ],
  },
  'laundry-ironing-services::ironing-steam-ironing-8-pieces': {
    includes: [
      'Ironing or steam ironing of garments',
      'Basic garment handling',
    ],
    excludes: [
      'Washing and stain removal',
      'Dry cleaning',
      'Repairs and alterations',
    ],
    faqItems: [
      { question: 'Does washing come with it?', answer: 'No, this service covers ironing only.' },
      { question: 'Can different garments be included?', answer: 'Yes, subject to fabric suitability and serviceability.' },
      { question: 'Is steam ironing included?', answer: 'Yes, ironing or steam ironing is included based on the selected service handling.' },
    ],
  },
  'laundry-traditional-wear::saree-and-traditional-wear-cleaning-per-piece': {
    includes: [
      'Suitable hand-washing for traditional wear',
      'Rinsing after wash',
      'Basic drying arrangement',
      'Basic folding after cleaning',
    ],
    excludes: [
      'Dry cleaning',
      'Embroidery restoration and colour restoration',
      'Heavy stain treatment and ironing',
    ],
    faqItems: [
      { question: 'Can every saree be washed?', answer: 'No, only sarees and traditional wear suitable for this cleaning method can be accepted.' },
      { question: 'Does it include ironing?', answer: 'No, ironing is not included in this package.' },
      { question: 'What about heavily embroidered garments?', answer: 'They need assessment before service because delicate work may not be suitable for standard cleaning.' },
    ],
  },
  'laundry-bedding-and-blankets::bedsheet-cleaning-per-piece': {
    includes: [
      'Washing and rinsing of the bedsheet',
      'Basic drying arrangement',
      'Basic folding after cleaning',
    ],
    excludes: [
      'Dry cleaning and heavy stain treatment',
      'Specialized machine drying',
      'Repairs and ironing',
    ],
    faqItems: [
      { question: 'Can all bedsheets be cleaned?', answer: 'Only when the bedsheet material and size are suitable for the service.' },
      { question: 'Is drying included?', answer: 'Basic drying arrangement is included.' },
      { question: 'Is ironing included?', answer: 'No, ironing is not included in bedsheet cleaning.' },
    ],
  },
  'laundry-bedding-and-blankets::single-blanket-cleaning-per-piece': {
    includes: [
      'Washing and rinsing of the blanket',
      'Basic drying arrangement',
      'Basic folding after cleaning',
    ],
    excludes: [
      'Dry cleaning and heavy stain treatment',
      'Specialized drying',
      'Repairs and ironing',
    ],
    faqItems: [
      { question: 'Can all blankets be cleaned?', answer: 'No, the blanket material and size must be suitable for the service.' },
      { question: 'Is drying included?', answer: 'Basic drying arrangement is included.' },
      { question: 'Is ironing included?', answer: 'No, ironing is not included.' },
    ],
  },
  'laundry-bedding-and-blankets::double-blanket-cleaning-per-piece': {
    includes: [
      'Washing and rinsing of the blanket',
      'Basic drying arrangement',
      'Basic folding after cleaning',
    ],
    excludes: [
      'Dry cleaning and heavy stain treatment',
      'Specialized drying',
      'Repairs and ironing',
    ],
    faqItems: [
      { question: 'Can all blankets be cleaned?', answer: 'No, the blanket material and size must be suitable for the service.' },
      { question: 'Is drying included?', answer: 'Basic drying arrangement is included.' },
      { question: 'Is ironing included?', answer: 'No, ironing is not included.' },
    ],
  },
  'laundry-shoe-cleaning::shoe-cleaning-per-pair': {
    includes: [
      'Surface cleaning of shoes',
      'Brushing and sole cleaning',
      'Basic drying after cleaning',
    ],
    excludes: [
      'Deep restoration and suede/leather restoration',
      'Colour restoration and polishing restoration',
      'Repairs',
    ],
    faqItems: [
      { question: 'Can all shoes be cleaned?', answer: 'No, cleaning depends on the shoe material and condition.' },
      { question: 'Are permanent stains guaranteed to disappear?', answer: 'No, permanent or deep stains may remain after cleaning.' },
      { question: 'Does it include shoe repair?', answer: 'No, repair is not included in shoe cleaning.' },
    ],
  },
};

const SUPPLEMENTAL_BOOK_NOW_CONTENT = loadSupplementalBookNowContentSeed();

function resolveBookNowSkuContentOverride(categorySlug: string, skuSlug: string) {
  return (
    BOOK_NOW_SKU_CONTENT_OVERRIDES[`${categorySlug}::${skuSlug}`] ||
    LAUNDRY_SKU_CONTENT_OVERRIDES[`${categorySlug}::${skuSlug}`] ||
    SUPPLEMENTAL_BOOK_NOW_CONTENT.contentByCategoryAndSku[`${categorySlug}::${skuSlug}`] ||
    null
  );
}

async function seedBookNowSkuContent(): Promise<number> {
  let count = 0;

  for (let index = 0; index < BOOK_NOW_SERVICE_DETAILS.length; index += 1) {
    const item = BOOK_NOW_SERVICE_DETAILS[index];
    await BookNowSkuContent.findOneAndUpdate(
      {
        categorySlug: item.catalogId,
        skuSlug: item.packageId,
      },
      {
        categorySlug: item.catalogId,
        skuSlug: item.packageId,
        displayName: item.name,
        includes: item.includes,
        excludes: item.notIncludes,
        imageUrls:
          BOOK_NOW_PACKAGE_IMAGE_URLS_BY_CATEGORY_AND_SKU[`${item.catalogId}::${item.packageId}`] || [],
        sortOrder: index,
        isActive: true,
      },
      { upsert: true, new: true },
    );
    count += 1;
  }

  return count;
}

async function seedBookNowCsvCatalog(): Promise<{
  hubSectionCount: number;
  categoryCount: number;
  skuCount: number;
  contentCount: number;
}> {
  const seed = buildBookNowCsvSeed();
  const categoryIdBySlug = new Map<string, string>();
  let hubSectionCount = 0;
  let categoryCount = 0;
  let skuCount = 0;
  let contentCount = 0;

  for (const section of seed.hubSections) {
    await BookNowHubSection.findOneAndUpdate(
      { slug: section.slug },
      {
        slug: section.slug,
        title: section.title,
        iconKey: section.iconKey,
        sortOrder: section.sortOrder,
        services: section.services.map((service) => ({
          serviceId: service.serviceId,
          label: service.label,
          categorySlug: service.categorySlug,
          sectionId: service.sectionId || '',
          imageUrl: service.imageUrl || '',
          sortOrder: service.serviceSortOrder,
          isActive: true,
        })),
        isActive: true,
      },
      { upsert: true, new: true },
    );
    hubSectionCount += 1;
  }

  for (const category of seed.categories) {
    const doc = await ServiceCategory.findOneAndUpdate(
      { slug: category.slug },
      {
        slug: category.slug,
        name: category.name,
        description: category.description,
        iconUrl: category.heroImageUrl,
        sortOrder: category.sortOrder,
        isActive: true,
      },
      { upsert: true, new: true },
    );
    if (doc?._id) {
      categoryIdBySlug.set(category.slug, String(doc._id));
      categoryCount += 1;
    }

    await BookNowCategoryContent.findOneAndUpdate(
      { categorySlug: category.slug },
      {
        categorySlug: category.slug,
        title: category.name,
        subtitle: category.topLevelCategory,
        description: category.description,
        heroImageUrl: category.heroImageUrl,
        faqCategoryKeys: [],
        sortOrder: category.sortOrder,
        isActive: true,
      },
      { upsert: true, new: true },
    );
  }

  for (const pkg of seed.packages) {
    const categoryId = categoryIdBySlug.get(pkg.categorySlug);
    if (!categoryId) {
      continue;
    }

    const discountPercent =
      pkg.originalPrice > 0
        ? Number(
            (
              ((pkg.originalPrice - pkg.offerPrice) / pkg.originalPrice) *
              100
            ).toFixed(2),
          )
        : 0;

    await ServiceSku.findOneAndUpdate(
      { categoryId, slug: pkg.skuSlug },
      {
        categoryId,
        slug: pkg.skuSlug,
        name: pkg.name,
        description: pkg.description,
        basePrice: pkg.originalPrice,
        offerDiscountType: 'percent',
        offerDiscountValue: Math.max(0, discountPercent),
        isOfferActive: pkg.offerPrice < pkg.originalPrice,
        pricingUnit: 'fixed',
        durationMinutes: pkg.durationMinutes,
        taskCategory:
          seed.categories.find((category) => category.slug === pkg.categorySlug)?.taskCategory ||
          'other',
        isActive: true,
      },
      { upsert: true, new: true },
    );
    skuCount += 1;

    await BookNowSkuContent.findOneAndUpdate(
      {
        categorySlug: pkg.categorySlug,
        skuSlug: pkg.skuSlug,
      },
      (() => {
        const override = resolveBookNowSkuContentOverride(pkg.categorySlug, pkg.skuSlug);
        return {
          categorySlug: pkg.categorySlug,
          skuSlug: pkg.skuSlug,
          displayName: pkg.name,
          shortDescription: pkg.description,
          longDescription: '',
          includes: override?.includes ?? [],
          excludes: override?.excludes ?? [],
          imageUrls: pkg.imageUrls,
          faqItems: override?.faqItems ?? [],
          sortOrder: pkg.sortOrder,
          isActive: true,
        };
      })(),
      { upsert: true, new: true },
    );
    contentCount += 1;
  }

  return { hubSectionCount, categoryCount, skuCount, contentCount };
}

async function seedBookNowCategoryContent(): Promise<number> {
  let count = 0;

  for (const item of BOOK_NOW_CATEGORY_CONTENT_SEED) {
    await BookNowCategoryContent.findOneAndUpdate(
      { categorySlug: item.categorySlug },
      {
        categorySlug: item.categorySlug,
        title: item.title,
        subtitle: item.subtitle,
        description: item.description,
        heroImageUrl:
          item.heroImageUrl ||
          BOOK_NOW_CATEGORY_HERO_IMAGE_BY_SLUG[item.categorySlug] ||
          '',
        faqCategoryKeys: [],
        sortOrder: item.sortOrder,
        isActive: true,
      },
      { upsert: true, new: true },
    );
    count += 1;
  }

  return count;
}

async function seedHelpSupportContent(): Promise<number> {
  let count = 0;

  for (const [variant, categories] of Object.entries(HELP_SUPPORT_SEED_DATA)) {
    for (const category of categories) {
      await HelpSupportContent.findOneAndUpdate(
        {
          variant,
          categoryKey: category.categoryKey,
        },
        {
          variant,
          categoryKey: category.categoryKey,
          title: category.title,
          subtitle: category.subtitle,
          icon: category.icon,
          items: category.items,
          sortOrder: category.sortOrder,
          isActive: true,
        },
        { upsert: true, new: true },
      );
      count += 1;
    }
  }

  return count;
}

async function seedBeautyOfferCatalog(): Promise<{ categoryCount: number; skuCount: number; contentCount: number }> {
  let categoryCount = 0;
  let skuCount = 0;
  let contentCount = 0;

  const categoryIdBySlug = new Map<string, string>();

  for (const category of BEAUTY_OFFER_CATEGORIES) {
    const doc = await ServiceCategory.findOneAndUpdate(
      { slug: category.slug },
      {
        slug: category.slug,
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
        isActive: true,
      },
      { upsert: true, new: true },
    );
    if (doc?._id) {
      categoryIdBySlug.set(category.slug, String(doc._id));
      categoryCount += 1;
    }
  }

  for (const service of BEAUTY_OFFER_SERVICES) {
    const categoryId = categoryIdBySlug.get(service.categorySlug);
    if (!categoryId) continue;

    const discountPercent =
      service.originalPrice > 0
        ? Number((((service.originalPrice - service.offerPrice) / service.originalPrice) * 100).toFixed(2))
        : 0;

    await ServiceSku.findOneAndUpdate(
      {
        categoryId,
        slug: service.skuSlug,
      },
      {
        categoryId,
        slug: service.skuSlug,
        name: service.name,
        description: `${service.durationLabel} • Offer ₹${service.offerPrice} from ₹${service.originalPrice}`,
        basePrice: service.originalPrice,
        offerDiscountType: 'percent',
        offerDiscountValue: Math.max(0, discountPercent),
        isOfferActive: true,
        pricingUnit: 'fixed',
        durationMinutes: service.durationMinutes,
        taskCategory: 'beauty-services',
        isActive: true,
      },
      { upsert: true, new: true },
    );
    skuCount += 1;

    await BookNowSkuContent.findOneAndUpdate(
      {
        categorySlug: service.categorySlug,
        skuSlug: service.skuSlug,
      },
      (() => {
        const override = resolveBookNowSkuContentOverride(service.categorySlug, service.skuSlug);
        return {
        categorySlug: service.categorySlug,
        skuSlug: service.skuSlug,
        displayName: service.name,
        shortDescription: `${service.durationLabel} • Offer ₹${service.offerPrice} (Orig ₹${service.originalPrice})`,
        longDescription: '',
        includes: override?.includes ?? [],
        excludes: override?.excludes ?? [],
        imageUrls: [],
        faqItems: override?.faqItems ?? [],
        sortOrder: 0,
        isActive: true,
      };
      })(),
      { upsert: true, new: true },
    );
    contentCount += 1;
  }

  return { categoryCount, skuCount, contentCount };
}

async function seedPersonalAssistantCatalog(): Promise<{
  categoryId: string;
  skus: number;
}> {
  const isActive = personalAssistantCatalogIsActive();
  const result = await BookNowCatalogBootstrap.seedPersonalAssistantCatalog();
  const imageUrl = BOOK_NOW_CATEGORY_HERO_IMAGE_BY_SLUG[PERSONAL_ASSISTANT_CATEGORY_SLUG] || '';

  await BookNowHubSection.findOneAndUpdate(
    { slug: PERSONAL_ASSISTANT_CATEGORY.slug },
    {
      slug: PERSONAL_ASSISTANT_CATEGORY.slug,
      title: 'Personal Assistance',
      iconKey: 'User',
      sortOrder: PERSONAL_ASSISTANT_CATEGORY.sortOrder,
      services: [
        {
          serviceId: PERSONAL_ASSISTANT_CATEGORY_SLUG,
          label: PERSONAL_ASSISTANT_CATEGORY.name,
          categorySlug: PERSONAL_ASSISTANT_CATEGORY_SLUG,
          sectionId: '',
          imageUrl,
          sortOrder: 10,
          isActive,
        },
      ],
      isActive,
    },
    { upsert: true, new: true },
  );

  return result;
}

async function main() {
  await Database.connectToDb();

  const [csvSeed, skuCount, categoryCount, faqCount, beautySeed, personalAssistantSeed] =
    await Promise.all([
    seedBookNowCsvCatalog(),
    seedBookNowSkuContent(),
    seedBookNowCategoryContent(),
    seedHelpSupportContent(),
    seedBeautyOfferCatalog(),
    seedPersonalAssistantCatalog(),
  ]);

  logger.info('Seeded Book Now content', {
    skuCount,
    categoryCount,
    faqCount,
    csvHubSectionCount: csvSeed.hubSectionCount,
    csvCategoryCount: csvSeed.categoryCount,
    csvSkuCount: csvSeed.skuCount,
    csvContentCount: csvSeed.contentCount,
    beautyCategoryCount: beautySeed.categoryCount,
    beautySkuCount: beautySeed.skuCount,
    personalAssistantCategoryId: personalAssistantSeed.categoryId,
    personalAssistantSkuCount: personalAssistantSeed.skus,
    beautyContentCount: beautySeed.contentCount,
    supplementalContentMatchedCount: SUPPLEMENTAL_BOOK_NOW_CONTENT.matchedCount,
    supplementalContentUnmatchedServices: SUPPLEMENTAL_BOOK_NOW_CONTENT.unmatchedServices,
  });
  process.exit(0);
}

main().catch((error) => {
  logger.error('Failed to seed Book Now content', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
