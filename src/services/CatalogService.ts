import mongoose from 'mongoose';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import ServiceVariant from '../models/ServiceVariant';
import ServiceAddon from '../models/ServiceAddon';
import ServiceArea from '../models/ServiceArea';
import { UserServiceClient } from '../clients/UserServiceClient';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import logger from '../config/logger';
import { isHardcodedSupportedLocation } from '../constants/locations/isHardcodedSupportedLocation';
import BookNowSkuContent from '../models/BookNowSkuContent';
import BookNowCategoryContent from '../models/BookNowCategoryContent';
import HelpSupportContent from '../models/HelpSupportContent';
import BookNowHubSection from '../models/BookNowHubSection';
import {
  BOOK_NOW_HUB_SECTION_SEED,
} from '../constants/bookNowHubCatalog';
import type { HelpSupportVariant } from '../constants/helpSupportSeedData';
import type {
  PatchCategoryContentInput,
  PatchHelpSupportCategoryInput,
  PatchHubSectionInput,
  PatchSkuContentInput,
  UpsertCategoryContentInput,
  UpsertHelpSupportCategoryInput,
  UpsertHubSectionInput,
  UpsertSkuContentInput,
} from '../schemas/catalogContent';
import type { IServiceSku } from '../models/ServiceSku';
import type { PatchOperationalSkuOfferInput } from '../schemas/catalogContent';

function assertObjectId(id: string, label = 'id'): string {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BadRequestError(`Invalid ${label}`);
  }
  return id;
}

/** Mobile parent label vs catalog subcategory slugs */
const BOOK_NOW_CATEGORY_ALIASES: Record<string, string> = {
  'home-cleaning': 'full-house',
};

function normalizeCatalogLookup(value: string): string {
  return value.toLowerCase().replace(/[-_\s]+/g, '-').trim();
}

function normalizeContentIdentity(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function resolveCategoryAlias(slug: string): string {
  return BOOK_NOW_CATEGORY_ALIASES[slug] || slug;
}

function roundToInt(value: number): number {
  return Math.round(value);
}

type PricingView = {
  originalPrice: number;
  offerPrice: number;
  savingsAmount: number;
  isOfferActive: boolean;
  offerDiscountType: 'percent' | 'flat';
  offerDiscountValue: number;
  appliedPercent: number;
};

type EnrichedSku<T> = T & { pricing: PricingView };

type BookNowPackageListItem = {
  _id: unknown;
  categorySlug: string;
  categoryName: string;
  skuSlug: string;
  name: string;
  description: string;
  durationMinutes: number;
  pricing: PricingView;
  content: {
    displayName: string;
    shortDescription: string;
    longDescription: string;
    includes: string[];
    excludes: string[];
    imageUrls: string[];
    sortOrder: number;
  } | null;
  primaryImageUrl: string;
};

function normalizeHubSectionServices(services: UpsertHubSectionInput['services'] | PatchHubSectionInput['services']) {
  return (Array.isArray(services) ? services : []).map((service, index) => ({
    serviceId: service.serviceId.trim(),
    label: service.label.trim(),
    categorySlug: normalizeCatalogLookup(resolveCategoryAlias(service.categorySlug)),
    sectionId: service.sectionId?.trim() || '',
    imageUrl: service.imageUrl?.trim() || '',
    sortOrder: typeof service.sortOrder === 'number' ? service.sortOrder : index * 10,
    isActive: typeof service.isActive === 'boolean' ? service.isActive : true,
  }));
}

function getSkuOfferPrice(sku: Pick<IServiceSku, 'basePrice' | 'offerDiscountType' | 'offerDiscountValue' | 'isOfferActive'>): number {
  const base = Math.max(0, Number(sku.basePrice || 0));
  if (!sku.isOfferActive) return base;
  const discountValue = Math.max(0, Number(sku.offerDiscountValue || 0));
  const discountType = sku.offerDiscountType || 'percent';

  if (discountType === 'flat') {
    return Math.max(0, roundToInt(base - discountValue));
  }

  const price = base * (1 - discountValue / 100);
  return Math.max(0, roundToInt(price));
}

function enrichSkuPricing<T extends Record<string, unknown>>(
  sku: T & Pick<IServiceSku, 'basePrice' | 'offerDiscountType' | 'offerDiscountValue' | 'isOfferActive'>,
): EnrichedSku<T> {
  const originalPrice = Math.max(0, Number(sku.basePrice || 0));
  const offerPrice = getSkuOfferPrice(sku);
  const savingsAmount = Math.max(0, originalPrice - offerPrice);
  const appliedPercent =
    originalPrice > 0 ? roundToInt((savingsAmount / originalPrice) * 100) : 0;

  return {
    ...sku,
    pricing: {
      originalPrice,
      offerPrice,
      savingsAmount,
      isOfferActive: Boolean(sku.isOfferActive),
      offerDiscountType: sku.offerDiscountType || 'percent',
      offerDiscountValue: Number(sku.offerDiscountValue || 0),
      appliedPercent,
    },
  } as EnrichedSku<T>;
}

function toDurationLabel(durationMinutes: number): string {
  const minutes = Math.max(0, Number(durationMinutes || 0));
  if (minutes <= 0) return '';
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return `${minutes / 60} hr${minutes === 60 ? '' : 's'}`;

  const hours = minutes / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} hrs`;
}

function comparePackageListItems(a: BookNowPackageListItem, b: BookNowPackageListItem): number {
  const sortOrderA = a.content?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const sortOrderB = b.content?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (sortOrderA !== sortOrderB) return sortOrderA - sortOrderB;

  const priceA = a.pricing.offerPrice;
  const priceB = b.pricing.offerPrice;
  if (priceA !== priceB) return priceA - priceB;

  return a.name.localeCompare(b.name);
}

function shouldPreferPackageListItem(
  candidate: BookNowPackageListItem,
  current: BookNowPackageListItem,
): boolean {
  const candidateHasImage = Boolean(candidate.primaryImageUrl);
  const currentHasImage = Boolean(current.primaryImageUrl);
  if (candidateHasImage !== currentHasImage) return candidateHasImage;

  const candidateHasContent = Boolean(candidate.content);
  const currentHasContent = Boolean(current.content);
  if (candidateHasContent !== currentHasContent) return candidateHasContent;

  const candidateSortOrder = candidate.content?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const currentSortOrder = current.content?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (candidateSortOrder !== currentSortOrder) return candidateSortOrder < currentSortOrder;

  return candidate.name.length >= current.name.length;
}

export type BookNowAreaCheckResult = {
  serviceable: boolean;
  hasHelpers: boolean;
  count: number;
  checkPerformed: boolean;
  resolvedCity: string | null;
};

export class CatalogService {
  static async listCategories() {
    const categories = await ServiceCategory.find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    return categories;
  }

  static async getCategoryBySlug(slug: string) {
    const normalized = resolveCategoryAlias(slug);
    const category = await ServiceCategory.findOne({ slug: normalized, isActive: true }).lean();
    if (!category) throw new NotFoundError('Category not found');
    return category;
  }

  static async getCategoryContent(categorySlug: string) {
    const content = await BookNowCategoryContent.findOne({
      categorySlug: normalizeCatalogLookup(resolveCategoryAlias(categorySlug)),
      isActive: true,
    }).lean();
    if (!content) {
      throw new NotFoundError('Book Now category content not found');
    }
    return content;
  }

  static async listCategoryContent(params?: { includeInactive?: boolean }) {
    const query: Record<string, unknown> = {};
    if (!params?.includeInactive) {
      query.isActive = true;
    }
    return BookNowCategoryContent.find(query).sort({ sortOrder: 1, title: 1 }).lean();
  }

  static async listHubSections(params?: { includeInactive?: boolean }) {
    const query: Record<string, unknown> = {};
    if (!params?.includeInactive) {
      query.isActive = true;
    }

    const docs = await BookNowHubSection.find(query).sort({ sortOrder: 1, title: 1 }).lean();
    if (docs.length > 0) {
      return docs;
    }

    return BOOK_NOW_HUB_SECTION_SEED
      .filter(() => params?.includeInactive ?? true)
      .map((section) => ({
        _id: '',
        slug: section.id,
        title: section.title,
        iconKey: section.iconKey,
        sortOrder: section.sortOrder,
        isActive: true,
        services: section.services.map((service, index) => ({
          serviceId: service.id,
          label: service.label,
          categorySlug: service.categorySlug,
          sectionId: service.sectionId || '',
          imageUrl: service.imageUrl || '',
          sortOrder: index * 10,
          isActive: true,
        })),
      }));
  }

  static async upsertHubSection(input: UpsertHubSectionInput) {
    const slug = normalizeCatalogLookup(input.slug);
    return BookNowHubSection.findOneAndUpdate(
      { slug },
      {
        slug,
        title: input.title.trim(),
        iconKey: input.iconKey?.trim() || '',
        sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : 0,
        services: normalizeHubSectionServices(input.services),
        isActive: typeof input.isActive === 'boolean' ? input.isActive : true,
      },
      { upsert: true, new: true },
    ).lean();
  }

  static async patchHubSection(id: string, input: PatchHubSectionInput) {
    assertObjectId(id);
    const update: Record<string, unknown> = {};

    if (input.slug !== undefined) update.slug = normalizeCatalogLookup(input.slug);
    if (input.title !== undefined) update.title = input.title.trim();
    if (input.iconKey !== undefined) update.iconKey = input.iconKey.trim();
    if (input.sortOrder !== undefined) update.sortOrder = input.sortOrder;
    if (input.services !== undefined) update.services = normalizeHubSectionServices(input.services);
    if (input.isActive !== undefined) update.isActive = input.isActive;

    const section = await BookNowHubSection.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true },
    ).lean();
    if (!section) {
      throw new NotFoundError('Book Now category not found');
    }
    return section;
  }

  static async upsertCategoryContent(input: UpsertCategoryContentInput) {
    return BookNowCategoryContent.findOneAndUpdate(
      {
        categorySlug: normalizeCatalogLookup(resolveCategoryAlias(input.categorySlug)),
      },
      {
        categorySlug: normalizeCatalogLookup(resolveCategoryAlias(input.categorySlug)),
        title: input.title.trim(),
        subtitle: input.subtitle?.trim() || '',
        description: input.description?.trim() || '',
        heroImageUrl: input.heroImageUrl?.trim() || '',
        iconUrl: input.iconUrl?.trim() || '',
        faqCategoryKeys: Array.isArray(input.faqCategoryKeys) ? input.faqCategoryKeys : [],
        sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : 0,
        isActive: typeof input.isActive === 'boolean' ? input.isActive : true,
      },
      { upsert: true, new: true },
    ).lean();
  }

  static async patchCategoryContent(id: string, input: PatchCategoryContentInput) {
    assertObjectId(id);
    const update: Record<string, unknown> = {};

    if (input.categorySlug !== undefined) {
      update.categorySlug = normalizeCatalogLookup(resolveCategoryAlias(input.categorySlug));
    }
    if (input.title !== undefined) update.title = input.title.trim();
    if (input.subtitle !== undefined) update.subtitle = input.subtitle.trim();
    if (input.description !== undefined) update.description = input.description.trim();
    if (input.heroImageUrl !== undefined) update.heroImageUrl = input.heroImageUrl.trim();
    if (input.iconUrl !== undefined) update.iconUrl = input.iconUrl.trim();
    if (input.faqCategoryKeys !== undefined) update.faqCategoryKeys = input.faqCategoryKeys;
    if (input.sortOrder !== undefined) update.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) update.isActive = input.isActive;

    const content = await BookNowCategoryContent.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true },
    ).lean();
    if (!content) {
      throw new NotFoundError('Book Now category content not found');
    }
    return content;
  }

  static async listSkusByCategorySlug(categorySlug: string) {
    const category = await this.getCategoryBySlug(categorySlug);
    const [skus, content] = await Promise.all([
      ServiceSku.find({ categoryId: category._id, isActive: true }).sort({ name: 1 }).lean(),
      BookNowCategoryContent.findOne({
        categorySlug: normalizeCatalogLookup(resolveCategoryAlias(categorySlug)),
        isActive: true,
      }).lean(),
    ]);
    return {
      category,
      skus: skus.map((sku) => enrichSkuPricing(sku)),
      content: content || null,
    };
  }

  private static buildPackageListItems(args: {
    category: { slug: string; name: string; _id: unknown };
    skus: Array<Record<string, unknown> & Pick<IServiceSku, 'slug' | 'name' | 'description' | 'durationMinutes' | 'basePrice' | 'offerDiscountType' | 'offerDiscountValue' | 'isOfferActive'>>;
    contentBySkuSlug: Map<string, {
      displayName: string;
      shortDescription?: string;
      longDescription?: string;
      includes?: string[];
      excludes?: string[];
      faqItems?: Array<{ question: string; answer: string }>;
      imageUrls?: string[];
      sortOrder?: number;
    }>;
  }): BookNowPackageListItem[] {
    const { category, skus, contentBySkuSlug } = args;

    const items = skus
      .map((sku) => {
        const normalizedSkuSlug = normalizeCatalogLookup(String(sku.slug || ''));
        const content =
          contentBySkuSlug.get(normalizedSkuSlug) ??
          contentBySkuSlug.get(normalizeContentIdentity(String(sku.slug || ''))) ??
          contentBySkuSlug.get(normalizeCatalogLookup(String(sku.name || ''))) ??
          contentBySkuSlug.get(normalizeContentIdentity(String(sku.name || ''))) ??
          null;
        const enriched = enrichSkuPricing(sku);
        const shortDescription = String(content?.shortDescription || '').trim();
        const fallbackDescription = String(sku.description || '').trim();
        const durationLabel = toDurationLabel(Number(sku.durationMinutes || 0));

        return {
          _id: sku._id,
          categorySlug: category.slug,
          categoryName: category.name,
          skuSlug: String(sku.slug || ''),
          name: String(sku.name || ''),
          description: shortDescription || fallbackDescription || durationLabel,
          durationMinutes: Number(sku.durationMinutes || 0),
          pricing: enriched.pricing,
          content: content
            ? {
                displayName: String(content.displayName || sku.name || ''),
                shortDescription,
                longDescription: String(content.longDescription || '').trim(),
                includes: Array.isArray(content.includes) ? content.includes : [],
                excludes: Array.isArray(content.excludes) ? content.excludes : [],
                faqItems: Array.isArray(content.faqItems) ? content.faqItems : [],
                imageUrls: Array.isArray(content.imageUrls) ? content.imageUrls.filter(Boolean) : [],
                sortOrder: Number(content.sortOrder || 0),
              }
            : null,
          primaryImageUrl: Array.isArray(content?.imageUrls) ? String(content?.imageUrls?.[0] || '').trim() : '',
        };
      })
      .filter((item) => item.name.trim().length > 0);

    const dedupedByName = new Map<string, BookNowPackageListItem>();
    items.forEach((item) => {
      const key =
        normalizeContentIdentity(item.content?.displayName || item.name) ||
        normalizeCatalogLookup(item.skuSlug);
      const current = dedupedByName.get(key);
      if (!current || shouldPreferPackageListItem(item, current)) {
        dedupedByName.set(key, item);
      }
    });

    return Array.from(dedupedByName.values()).sort(comparePackageListItems);
  }

  static async getBookNowHubCatalog(previewLimit = 5) {
    const limit = Math.max(1, Math.min(Number(previewLimit || 5), 8));
    const [categories, skuContents, categoryContents] = await Promise.all([
      ServiceCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      BookNowSkuContent.find({ isActive: true }).lean(),
      BookNowCategoryContent.find({}).sort({ sortOrder: 1, title: 1 }).lean(),
    ]);

    if (categories.length === 0) return [];

    const categoryIds = categories.map((category) => category._id);
    const skus = await ServiceSku.find({ categoryId: { $in: categoryIds }, isActive: true }).lean();
    const contentBySkuKey = new Map<string, (typeof skuContents)[number]>();
    skuContents.forEach((content) => {
      const normalizedCategory = normalizeCatalogLookup(content.categorySlug);
      const keys = [
        normalizeCatalogLookup(content.skuSlug),
        normalizeContentIdentity(content.skuSlug),
        normalizeCatalogLookup(content.displayName),
        normalizeContentIdentity(content.displayName),
      ].filter(Boolean);

      keys.forEach((key) => {
        contentBySkuKey.set(`${normalizedCategory}::${key}`, content);
      });
    });
    const categoryContentBySlug = new Map(
      categoryContents.map((content) => [normalizeCatalogLookup(content.categorySlug), content] as const),
    );
    const inactiveCategoryContentSlugs = new Set(
      categoryContents
        .filter((content) => content.isActive === false)
        .map((content) => normalizeCatalogLookup(content.categorySlug)),
    );

    const categoryBySlug = new Map(
      categories.map((category) => [normalizeCatalogLookup(category.slug), category] as const),
    );
    const packageItemsByCategorySlug = new Map<string, BookNowPackageListItem[]>();

    categories.forEach((category) => {
      const normalizedCategorySlug = normalizeCatalogLookup(category.slug);
      const categorySkus = skus.filter((sku) => String(sku.categoryId) === String(category._id));
      const contentBySkuSlug = new Map<string, (typeof skuContents)[number]>();

      categorySkus.forEach((sku) => {
        const candidateKeys = [
          normalizeCatalogLookup(String(sku.slug || '')),
          normalizeContentIdentity(String(sku.slug || '')),
          normalizeCatalogLookup(String(sku.name || '')),
          normalizeContentIdentity(String(sku.name || '')),
        ].filter(Boolean);
        const content = candidateKeys
          .map((key) => contentBySkuKey.get(`${normalizedCategorySlug}::${key}`))
          .find(Boolean);
        if (content) {
          contentBySkuSlug.set(normalizeCatalogLookup(String(sku.slug || '')), content);
          contentBySkuSlug.set(normalizeContentIdentity(String(sku.slug || '')), content);
          contentBySkuSlug.set(normalizeCatalogLookup(String(sku.name || '')), content);
          contentBySkuSlug.set(normalizeContentIdentity(String(sku.name || '')), content);
        }
      });

      const items = this.buildPackageListItems({
        category,
        skus: categorySkus,
        contentBySkuSlug,
      });

      if (items.length > 0) {
        packageItemsByCategorySlug.set(normalizedCategorySlug, items);
      }
    });

    const hubSectionDocs = await BookNowHubSection.find({ isActive: true })
      .sort({ sortOrder: 1, title: 1 })
      .lean();
    const hubSections = hubSectionDocs.length > 0
      ? hubSectionDocs.map((section) => ({
          id: section.slug,
          title: section.title,
          iconKey: section.iconKey || 'Broom',
          sortOrder: Number(section.sortOrder || 0),
          services: (Array.isArray(section.services) ? section.services : []).map((service) => ({
            id: service.serviceId,
            label: service.label,
            categorySlug: service.categorySlug,
            sectionId: service.sectionId || '',
            imageUrl: service.imageUrl || '',
            isActive: service.isActive !== false,
          })),
        }))
      : BOOK_NOW_HUB_SECTION_SEED.map((section) => ({
          id: section.id,
          title: section.title,
          iconKey: section.iconKey,
          sortOrder: section.sortOrder,
          services: section.services.map((service) => ({
            id: service.id,
            label: service.label,
            categorySlug: service.categorySlug,
            sectionId: service.sectionId || '',
            imageUrl: service.imageUrl || '',
            isActive: true,
          })),
        }));

    const groupedCategorySlugs = new Set(
      hubSections.flatMap((section) => [
        normalizeCatalogLookup(section.id),
        ...section.services.map((service) => normalizeCatalogLookup(service.categorySlug)),
      ]),
    );

    const groupedSections = hubSections
      .map((section) => {
        const services = section.services
          .map((service) => {
            const normalizedCategorySlug = normalizeCatalogLookup(service.categorySlug);
            if (service.isActive === false || inactiveCategoryContentSlugs.has(normalizedCategorySlug)) {
              return null;
            }
            const packages = packageItemsByCategorySlug.get(normalizedCategorySlug) || [];
            if (packages.length === 0) return null;

            const category = categoryBySlug.get(normalizedCategorySlug);
            const categoryContent = categoryContentBySlug.get(normalizedCategorySlug) ?? null;

            return {
              id: service.id,
              label: service.label,
              categorySlug: service.categorySlug,
              categoryName: category?.name || categoryContent?.title || service.label,
              sectionId: service.sectionId || '',
              imageUrl:
                service.imageUrl ||
                categoryContent?.heroImageUrl ||
                packages[0]?.primaryImageUrl ||
                '',
              previewPackages: packages.slice(0, limit),
              totalPackages: packages.length,
            };
          })
          .filter(Boolean);

        return {
          id: section.id,
          slug: section.id,
          title: section.title,
          iconKey: section.iconKey,
          sortOrder: section.sortOrder,
          services,
        };
      })
      .filter((section) => section.services.length > 0);

    const fallbackSections = Array.from(packageItemsByCategorySlug.entries())
      .filter(([categorySlug]) => !groupedCategorySlugs.has(categorySlug))
      .filter(([categorySlug]) => !inactiveCategoryContentSlugs.has(categorySlug))
      .map(([categorySlug, packages]) => {
        const category = categoryBySlug.get(categorySlug);
        const categoryContent = categoryContentBySlug.get(categorySlug) ?? null;
        return {
          id: categorySlug,
          slug: categorySlug,
          title: categoryContent?.title || category?.name || categorySlug,
          iconKey: 'Broom',
          sortOrder: Number(category?.sortOrder || 999),
          services: [
            {
              id: categorySlug,
              label: categoryContent?.title || category?.name || categorySlug,
              categorySlug,
              categoryName: category?.name || categorySlug,
              sectionId: '',
              imageUrl: categoryContent?.heroImageUrl || packages[0]?.primaryImageUrl || '',
              previewPackages: packages.slice(0, limit),
              totalPackages: packages.length,
            },
          ],
        };
      });

    return [...groupedSections, ...fallbackSections].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  static async getBookNowCategoryPackages(categorySlug: string) {
    const category = await this.getCategoryBySlug(categorySlug);
    const normalizedCategorySlug = normalizeCatalogLookup(category.slug);
    const [skus, skuContents, categoryContent] = await Promise.all([
      ServiceSku.find({ categoryId: category._id, isActive: true }).lean(),
      BookNowSkuContent.find({ categorySlug: normalizedCategorySlug, isActive: true }).lean(),
      BookNowCategoryContent.findOne({ categorySlug: normalizedCategorySlug }).lean(),
    ]);

    if (categoryContent?.isActive === false) {
      throw new NotFoundError('Book Now service not found');
    }

    const contentBySkuSlug = new Map<string, (typeof skuContents)[number]>();
    skuContents.forEach((content) => {
      [
        normalizeCatalogLookup(content.skuSlug),
        normalizeContentIdentity(content.skuSlug),
        normalizeCatalogLookup(content.displayName),
        normalizeContentIdentity(content.displayName),
      ]
        .filter(Boolean)
        .forEach((key) => contentBySkuSlug.set(key, content));
    });

    return {
      category: {
        _id: category._id,
        slug: category.slug,
        name: category.name,
        description: category.description || '',
        sortOrder: category.sortOrder ?? 0,
        content: categoryContent
          ? {
              title: categoryContent.title,
              subtitle: categoryContent.subtitle || '',
              description: categoryContent.description || '',
              heroImageUrl: categoryContent.heroImageUrl || '',
              iconUrl: categoryContent.iconUrl || '',
            }
          : null,
      },
      packages: this.buildPackageListItems({
        category,
        skus,
        contentBySkuSlug,
      }),
    };
  }

  static async getSkuDetail(skuSlug: string, categorySlug?: string) {
    const skuQuery: Record<string, unknown> = { slug: skuSlug, isActive: true };
    let categoryFilterApplied = false;

    if (categorySlug) {
      const normalizedCategory = resolveCategoryAlias(categorySlug);
      const category = await ServiceCategory.findOne({
        slug: normalizedCategory,
        isActive: true,
      }).lean();

      if (category) {
        skuQuery.categoryId = category._id;
        categoryFilterApplied = true;
      } else {
        logger.warn('Book Now category slug not in catalog; resolving SKU globally', {
          categorySlug,
          skuSlug,
        });
      }
    }

    let sku = await ServiceSku.findOne(skuQuery).lean();

    if (!sku && categoryFilterApplied) {
      sku = await ServiceSku.findOne({ slug: skuSlug, isActive: true }).lean();
    }

    if (!sku) throw new NotFoundError('Service not found');

    const [variants, addons, category, content] = await Promise.all([
      ServiceVariant.find({ skuId: sku._id, isActive: true }).sort({ isDefault: -1, name: 1 }).lean(),
      ServiceAddon.find({ skuId: sku._id, isActive: true }).sort({ name: 1 }).lean(),
      ServiceCategory.findById(sku.categoryId).lean(),
      this.getSkuContent(sku.slug, categorySlug).catch(() => null),
    ]);

    return { sku: enrichSkuPricing(sku), variants, addons, category, content };
  }

  static async listOperationalSkus(
    params?: { includeInactive?: boolean; categorySlug?: string },
  ): Promise<Record<string, unknown>[]> {
    const query: Record<string, unknown> = {};
    if (!params?.includeInactive) {
      query.isActive = true;
    }
    if (params?.categorySlug) {
      const normalizedCategory = normalizeCatalogLookup(resolveCategoryAlias(params.categorySlug));
      const category = await ServiceCategory.findOne({ slug: normalizedCategory }).lean();
      if (category?._id) {
        query.categoryId = category._id;
      } else {
        return [];
      }
    }

    const skus = await ServiceSku.find(query).sort({ name: 1 }).lean();
    const categoryIds = [...new Set(skus.map((sku) => String(sku.categoryId)))];
    const categories = await ServiceCategory.find({ _id: { $in: categoryIds } })
      .select({ _id: 1, slug: 1, name: 1 })
      .lean();
    const categoryMap = new Map(categories.map((category) => [String(category._id), category]));

    return skus.map((sku) => {
      const category = categoryMap.get(String(sku.categoryId));
      return enrichSkuPricing({
        ...sku,
        categorySlug: category?.slug || '',
        categoryName: category?.name || '',
      });
    });
  }

  static async patchOperationalSkuOffer(
    id: string,
    input: PatchOperationalSkuOfferInput,
  ): Promise<Record<string, unknown>> {
    assertObjectId(id);
    const update: Record<string, unknown> = {};
    if (input.basePrice !== undefined) update.basePrice = input.basePrice;
    if (input.offerDiscountType !== undefined) update.offerDiscountType = input.offerDiscountType;
    if (input.offerDiscountValue !== undefined) update.offerDiscountValue = input.offerDiscountValue;
    if (input.isOfferActive !== undefined) update.isOfferActive = input.isOfferActive;
    if (input.durationMinutes !== undefined) update.durationMinutes = input.durationMinutes;

    const sku = await ServiceSku.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!sku) throw new NotFoundError('Service not found');

    const category = await ServiceCategory.findById(sku.categoryId).select({ slug: 1, name: 1 }).lean();
    return enrichSkuPricing({
      ...sku,
      categorySlug: category?.slug || '',
      categoryName: category?.name || '',
    });
  }

  static async getSkuContent(skuSlug: string, categorySlug?: string) {
    const query: Record<string, unknown> = {
      skuSlug: normalizeCatalogLookup(skuSlug),
      isActive: true,
    };

    if (categorySlug) {
      query.categorySlug = normalizeCatalogLookup(resolveCategoryAlias(categorySlug));
    }

    const content = await BookNowSkuContent.findOne(query).lean();
    if (!content) {
      throw new NotFoundError('Book Now service content not found');
    }

    return content;
  }

  static async listSkuContent(params?: {
    includeInactive?: boolean;
    categorySlug?: string;
  }) {
    const query: Record<string, unknown> = {};
    if (!params?.includeInactive) {
      query.isActive = true;
    }
    if (params?.categorySlug) {
      query.categorySlug = normalizeCatalogLookup(resolveCategoryAlias(params.categorySlug));
    }
    return BookNowSkuContent.find(query).sort({ sortOrder: 1, displayName: 1 }).lean();
  }

  static async upsertSkuContent(input: UpsertSkuContentInput) {
    return BookNowSkuContent.findOneAndUpdate(
      {
        categorySlug: normalizeCatalogLookup(resolveCategoryAlias(input.categorySlug)),
        skuSlug: normalizeCatalogLookup(input.skuSlug),
      },
      {
        categorySlug: normalizeCatalogLookup(resolveCategoryAlias(input.categorySlug)),
        skuSlug: normalizeCatalogLookup(input.skuSlug),
        displayName: input.displayName.trim(),
        shortDescription: input.shortDescription?.trim() || '',
        longDescription: input.longDescription?.trim() || '',
        includes: Array.isArray(input.includes) ? input.includes : [],
        excludes: Array.isArray(input.excludes) ? input.excludes : [],
        imageUrls: Array.isArray(input.imageUrls) ? input.imageUrls : [],
        faqItems: Array.isArray(input.faqItems) ? input.faqItems : [],
        sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : 0,
        isActive: typeof input.isActive === 'boolean' ? input.isActive : true,
      },
      { upsert: true, new: true },
    ).lean();
  }

  static async patchSkuContent(id: string, input: PatchSkuContentInput) {
    assertObjectId(id);
    const update: Record<string, unknown> = {};

    if (input.categorySlug !== undefined) {
      update.categorySlug = normalizeCatalogLookup(resolveCategoryAlias(input.categorySlug));
    }
    if (input.skuSlug !== undefined) {
      update.skuSlug = normalizeCatalogLookup(input.skuSlug);
    }
    if (input.displayName !== undefined) update.displayName = input.displayName.trim();
    if (input.shortDescription !== undefined) {
      update.shortDescription = input.shortDescription.trim();
    }
    if (input.longDescription !== undefined) {
      update.longDescription = input.longDescription.trim();
    }
    if (input.includes !== undefined) update.includes = input.includes;
    if (input.excludes !== undefined) update.excludes = input.excludes;
    if (input.imageUrls !== undefined) update.imageUrls = input.imageUrls;
    if (input.faqItems !== undefined) update.faqItems = input.faqItems;
    if (input.sortOrder !== undefined) update.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) update.isActive = input.isActive;

    const content = await BookNowSkuContent.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!content) {
      throw new NotFoundError('Book Now service content not found');
    }
    return content;
  }

  static async resolveSkuContent(params: { categorySlug: string; taskTitle?: string; skuSlug?: string }) {
    const normalizedCategorySlug = normalizeCatalogLookup(resolveCategoryAlias(params.categorySlug));
    const normalizedSkuSlug = params.skuSlug ? normalizeCatalogLookup(params.skuSlug) : '';
    const normalizedTaskTitle = params.taskTitle ? normalizeCatalogLookup(params.taskTitle) : '';

    const candidates = await BookNowSkuContent.find({
      categorySlug: normalizedCategorySlug,
      isActive: true,
    })
      .sort({ sortOrder: 1, displayName: 1 })
      .lean();

    if (candidates.length === 0) {
      throw new NotFoundError('Book Now service content not found');
    }

    const exactSku = normalizedSkuSlug
      ? candidates.find((item) => normalizeCatalogLookup(item.skuSlug) === normalizedSkuSlug)
      : null;
    if (exactSku) return exactSku;

    const exactName = normalizedTaskTitle
      ? candidates.find((item) => normalizeCatalogLookup(item.displayName) === normalizedTaskTitle)
      : null;
    if (exactName) return exactName;

    const titleSku = normalizedTaskTitle
      ? candidates.find((item) => normalizeCatalogLookup(item.skuSlug) === normalizedTaskTitle)
      : null;
    if (titleSku) return titleSku;

    const fuzzy = normalizedTaskTitle
      ? candidates.find((item) => {
          const normalizedDisplayName = normalizeCatalogLookup(item.displayName);
          const normalizedContentSku = normalizeCatalogLookup(item.skuSlug);
          return (
            normalizedTaskTitle.includes(normalizedContentSku) ||
            normalizedContentSku.includes(normalizedTaskTitle) ||
            normalizedTaskTitle.includes(normalizedDisplayName)
          );
        })
      : null;
    if (fuzzy) return fuzzy;

    return candidates[0];
  }

  static async listHelpSupportCategories(
    variant: HelpSupportVariant,
    params?: { includeInactive?: boolean },
  ) {
    const query: Record<string, unknown> = { variant };
    if (!params?.includeInactive) {
      query.isActive = true;
    }
    return HelpSupportContent.find(query).sort({ sortOrder: 1, title: 1 }).lean();
  }

  static async getHelpSupportCategory(variant: HelpSupportVariant, categoryKey: string) {
    const content = await HelpSupportContent.findOne({
      variant,
      categoryKey,
      isActive: true,
    }).lean();

    if (!content) {
      throw new NotFoundError('Help support category not found');
    }

    return content;
  }

  static async upsertHelpSupportCategory(input: UpsertHelpSupportCategoryInput) {
    return HelpSupportContent.findOneAndUpdate(
      {
        variant: input.variant,
        categoryKey: input.categoryKey,
      },
      {
        variant: input.variant,
        categoryKey: input.categoryKey,
        title: input.title.trim(),
        subtitle: input.subtitle.trim(),
        icon: input.icon.trim(),
        items: Array.isArray(input.items) ? input.items : [],
        sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : 0,
        isActive: typeof input.isActive === 'boolean' ? input.isActive : true,
      },
      { upsert: true, new: true },
    ).lean();
  }

  static async patchHelpSupportCategory(id: string, input: PatchHelpSupportCategoryInput) {
    assertObjectId(id);
    const update: Record<string, unknown> = {};

    if (input.variant !== undefined) update.variant = input.variant;
    if (input.categoryKey !== undefined) update.categoryKey = input.categoryKey.trim();
    if (input.title !== undefined) update.title = input.title.trim();
    if (input.subtitle !== undefined) update.subtitle = input.subtitle.trim();
    if (input.icon !== undefined) update.icon = input.icon.trim();
    if (input.items !== undefined) update.items = input.items;
    if (input.sortOrder !== undefined) update.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) update.isActive = input.isActive;

    const content = await HelpSupportContent.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true },
    ).lean();
    if (!content) {
      throw new NotFoundError('Help support category not found');
    }
    return content;
  }

  static async listServiceAreas(city?: string) {
    const query: Record<string, unknown> = { isActive: true };
    if (city) query.city = new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    return ServiceArea.find(query).sort({ city: 1 }).lean();
  }

  static async checkBookNowArea(params: {
    pinCode?: string;
    city?: string;
    customerUid?: string;
    lat?: number;
    lng?: number;
  }): Promise<BookNowAreaCheckResult> {
    const normalizedCity = params.city?.trim() || null;
    const availability = await UserServiceClient.checkPosterHelperAvailability({
      firebaseUid: params.customerUid,
      city: normalizedCity || undefined,
      pinCode: params.pinCode,
      lat: params.lat,
      lng: params.lng,
      limit: 1,
    });

    if (availability === null) {
      logger.warn('Book Now area check: user-service unavailable, allowing checkout (fail-open)', {
        city: normalizedCity,
        pinCode: params.pinCode,
        customerUid: params.customerUid,
      });
      return {
        serviceable: true,
        hasHelpers: true,
        count: 0,
        checkPerformed: false,
        resolvedCity: normalizedCity,
      };
    }

    logger.info('Book Now area check: poster helper availability', {
      city: normalizedCity,
      pinCode: params.pinCode,
      customerUid: params.customerUid,
      ...availability,
    });

    const hardcodedSupported = isHardcodedSupportedLocation({
      city: availability.resolvedCity ?? normalizedCity,
    });

    return {
      serviceable: availability.serviceable || hardcodedSupported,
      hasHelpers: availability.hasHelpers,
      count: availability.count,
      checkPerformed: availability.checkPerformed,
      resolvedCity: availability.resolvedCity,
    };
  }

  static async isPinCodeServiceable(
    pinCode: string,
    city?: string,
    customerUid?: string,
    coordinates?: [number, number],
  ): Promise<boolean> {
    const result = await this.checkBookNowArea({
      pinCode,
      city,
      customerUid,
      lng: coordinates?.[0],
      lat: coordinates?.[1],
    });
    return result.serviceable;
  }
}
