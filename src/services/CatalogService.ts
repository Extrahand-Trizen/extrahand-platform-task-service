import mongoose from 'mongoose';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import ServiceVariant from '../models/ServiceVariant';
import ServiceAddon from '../models/ServiceAddon';
import ServiceArea from '../models/ServiceArea';
import { UserServiceClient } from '../clients/UserServiceClient';
import { BadRequestError, ConflictError, NotFoundError } from '../errors/AppError';
import logger from '../config/logger';
import { isHardcodedSupportedLocation } from '../constants/locations/isHardcodedSupportedLocation';
import BookNowSkuContent from '../models/BookNowSkuContent';
import BookNowCategoryContent from '../models/BookNowCategoryContent';
import HelpSupportContent from '../models/HelpSupportContent';
import BookNowHubSection from '../models/BookNowHubSection';
import CustomerHomePromotion from '../models/CustomerHomePromotion';
import {
  BOOK_NOW_HUB_SECTION_SEED,
} from '../constants/bookNowHubCatalog';
import type { HelpSupportVariant } from '../constants/helpSupportSeedData';
import type {
  PatchCategoryContentInput,
  PatchHelpSupportCategoryInput,
  PatchHubSectionInput,
  PatchSkuContentInput,
  CreateCustomerHomePromotionInput,
  PatchCustomerHomePromotionInput,
  UpsertCategoryContentInput,
  UpsertHelpSupportCategoryInput,
  UpsertHubSectionInput,
  UpsertSkuContentInput,
  CreateCatalogServiceInput,
  UpdateCatalogServiceInput,
} from '../schemas/catalogContent';
import type { IServiceSku } from '../models/ServiceSku';
import type { PatchOperationalSkuOfferInput } from '../schemas/catalogContent';
import { resolveBookNowServiceFlowConfig } from '../utils/bookNowServiceFlowConfig';
import {
  canAccessPersonalAssistantCatalog,
  isPersonalAssistantCategorySlug,
} from '../utils/personalAssistantCatalogVisibility';
import { LocationPricingService, type PricedSku, type ResolvedSkuPrice } from './LocationPricingService';
import { getSkuOfferPrice } from '../utils/skuPricing';
import { resolveParentCategory } from '../utils/bookNowClientCatalog';

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

function slugifyCatalogValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  globalOfferPrice?: number;
  pricingSource?: ResolvedSkuPrice['pricingSource'];
  locationType?: ResolvedSkuPrice['locationType'];
  locationId?: unknown;
  pricingRuleId?: unknown;
  pricingVersion?: number | null;
};

export type CatalogLocationInput = {
  area?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  coordinates?: [number, number];
};

function hasCatalogLocation(location?: CatalogLocationInput): location is CatalogLocationInput {
  return Boolean(location && (location.area || location.city || location.pinCode || location.coordinates));
}

function withResolvedPricing(pricing: PricingView, resolved: ResolvedSkuPrice): PricingView {
  const originalPrice = Math.max(0, Number(resolved.basePrice || 0));
  const offerPrice = Math.max(0, Number(resolved.effectiveOfferPrice || 0));
  return {
    ...pricing,
    originalPrice,
    offerPrice,
    savingsAmount: Math.max(0, originalPrice - offerPrice),
    isOfferActive: offerPrice > 0 && offerPrice !== originalPrice,
    appliedPercent: originalPrice > 0 && offerPrice < originalPrice ? roundToInt(((originalPrice - offerPrice) / originalPrice) * 100) : 0,
    globalOfferPrice: resolved.globalOfferPrice,
    pricingSource: resolved.pricingSource,
    locationType: resolved.locationType,
    locationId: resolved.locationId,
    pricingRuleId: resolved.pricingRuleId,
    pricingVersion: resolved.version,
  };
}

type EnrichedSku<T> = T & { pricing: PricingView };

type BookNowPackageListItem = {
  _id: unknown;
  categorySlug: string;
  categoryName: string;
  skuSlug: string;
  name: string;
  description: string;
  durationMinutes: number;
  filterId?: string;
  filterLabel?: string;
  pricing: PricingView;
  content: {
    displayName: string;
    shortDescription: string;
    longDescription: string;
    includes: string[];
    excludes: string[];
    imageUrls: string[];
    sortOrder: number;
    isFeaturedOnHome: boolean;
    featuredSortOrder: number;
  } | null;
  primaryImageUrl: string;
  serviceFlow: {
    serviceFlowType: 'standard' | 'consultation_project';
    bookingKind: 'standard' | 'consultation';
    serviceType?: string;
    consultationEnabled: boolean;
    gstExempt: boolean;
  };
};

function getHubPreviewPackages(packages: BookNowPackageListItem[], limit: number) {
  return [...packages]
    .sort((a, b) => {
      const aFeatured = a.content?.isFeaturedOnHome === true;
      const bFeatured = b.content?.isFeaturedOnHome === true;
      if (aFeatured !== bFeatured) return aFeatured ? -1 : 1;
      if (aFeatured && bFeatured) {
        return (a.content?.featuredSortOrder ?? 0) - (b.content?.featuredSortOrder ?? 0);
      }
      if (a.pricing.isOfferActive !== b.pricing.isOfferActive) {
        return a.pricing.isOfferActive ? -1 : 1;
      }
      return 0;
    })
    .slice(0, limit);
}

type AdminCatalogService = {
  _id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string;
  basePrice: number;
  offerPrice: number;
  originalPrice: number;
  defaultPrice: number;
  pricingUnit: 'fixed' | 'hourly';
  durationMinutes: number;
  taskCategory: string;
  partnerCategoryId: string;
  isActive: boolean;
  filterId?: string;
  filterLabel?: string;
};

type AdminCatalogCategory = {
  _id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string;
  sortOrder: number;
  isActive: boolean;
  isVisibleInApp: boolean;
  services: AdminCatalogService[];
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

function enrichSkuPricing<T extends Record<string, unknown>>(
  sku: T & Pick<IServiceSku, 'basePrice' | 'offerPrice' | 'offerDiscountType' | 'offerDiscountValue' | 'isOfferActive'> & Partial<Pick<IServiceSku, 'pricingUnit'>>,
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
      isOfferActive: offerPrice > 0 && offerPrice !== originalPrice,
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

function sortBookNowSkus<T extends { _id: unknown; name: string }>(skus: T[]): T[] {
  return [...skus].sort(
    (a, b) => a.name.localeCompare(b.name) || String(a._id).localeCompare(String(b._id)),
  );
}

function locationPriceRank(source?: string | null): number {
  if (source === 'area') return 3;
  if (source === 'pincode') return 2;
  if (source === 'city') return 1;
  return 0;
}

function shouldPreferPackageListItem(
  candidate: BookNowPackageListItem,
  current: BookNowPackageListItem,
): boolean {
  const rankDiff = locationPriceRank(candidate.pricing.pricingSource) - locationPriceRank(current.pricing.pricingSource);
  if (rankDiff !== 0) return rankDiff > 0;

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

function assertPersonalAssistantAccessible(
  categorySlug: string,
  customerUid?: string | null,
): void {
  if (!isPersonalAssistantCategorySlug(categorySlug)) return;
  if (!canAccessPersonalAssistantCatalog(customerUid)) {
    throw new NotFoundError('Book Now service not found');
  }
}

function filterPersonalAssistantCategories<T extends { slug?: string }>(
  categories: T[],
  customerUid?: string | null,
): T[] {
  if (canAccessPersonalAssistantCatalog(customerUid)) return categories;
  return categories.filter((category) => !isPersonalAssistantCategorySlug(String(category.slug || '')));
}

function filterPersonalAssistantFromHubResponse(
  sections: Array<{
    id: string;
    slug: string;
    title: string;
    iconKey: string;
    sortOrder: number;
    services: Array<{
      id: string;
      label: string;
      categorySlug: string;
      categoryName: string;
      sectionId: string;
      imageUrl: string;
      previewPackages: BookNowPackageListItem[];
      totalPackages: number;
    }>;
  }>,
  customerUid?: string | null,
) {
  if (canAccessPersonalAssistantCatalog(customerUid)) return sections;

  return sections
    .map((section) => {
      if (isPersonalAssistantCategorySlug(section.id) || isPersonalAssistantCategorySlug(section.slug)) {
        return null;
      }
      const services = section.services.filter(
        (service) => !isPersonalAssistantCategorySlug(service.categorySlug),
      );
      if (services.length === 0) return null;
      return { ...section, services };
    })
    .filter((section): section is NonNullable<typeof section> => section !== null);
}

export class CatalogService {
  static async getBookNowHomeCategories(customerUid?: string | null) {
    const [categories, categoryContents, hubSectionDocs] = await Promise.all([
      ServiceCategory.find({ isActive: true })
        .select({ slug: 1, name: 1, sortOrder: 1 })
        .sort({ sortOrder: 1, name: 1 })
        .lean(),
      BookNowCategoryContent.find({})
        .select({ categorySlug: 1, title: 1, heroImageUrl: 1, isActive: 1, sortOrder: 1 })
        .sort({ sortOrder: 1, title: 1 })
        .lean(),
      BookNowHubSection.find({ isActive: true })
        .select({ slug: 1, title: 1, iconKey: 1, sortOrder: 1, services: 1 })
        .sort({ sortOrder: 1, title: 1 })
        .lean(),
    ]);
    const visibleCategories = filterPersonalAssistantCategories(categories, customerUid);
    if (visibleCategories.length === 0) return [];

    const categoryIds = visibleCategories.map((category) => category._id);
    const activeCategoryIds = await ServiceSku.distinct('categoryId', {
      categoryId: { $in: categoryIds },
      isActive: true,
    });
    const activeCategoryIdSet = new Set(activeCategoryIds.map(String));
    const categoryBySlug = new Map(
      visibleCategories.map((category) => [
        normalizeCatalogLookup(category.slug),
        category,
      ] as const),
    );
    const categoryContentBySlug = new Map(
      categoryContents.map((content) => [
        normalizeCatalogLookup(content.categorySlug),
        content,
      ] as const),
    );
    const inactiveCategorySlugs = new Set(
      categoryContents
        .filter((content) => content.isActive === false)
        .map((content) => normalizeCatalogLookup(content.categorySlug)),
    );
    const sections: Array<{
      id: string;
      slug: string;
      title: string;
      iconKey: string;
      sortOrder: number;
      services: Array<{
        serviceId: string;
        label: string;
        categorySlug: string;
        sectionId?: string;
        imageUrl?: string;
        isActive?: boolean;
      }>;
    }> = hubSectionDocs.length > 0
      ? hubSectionDocs.map((section) => ({
          id: section.slug,
          slug: section.slug,
          title: section.title,
          iconKey: section.iconKey || 'Broom',
          sortOrder: Number(section.sortOrder || 0),
          services: section.services.map((service) => ({
            serviceId: service.serviceId,
            label: service.label,
            categorySlug: service.categorySlug,
            sectionId: service.sectionId,
            imageUrl: service.imageUrl,
            isActive: service.isActive,
          })),
        }))
      : BOOK_NOW_HUB_SECTION_SEED.map((section) => ({
          id: section.id,
          slug: section.id,
          title: section.title,
          iconKey: section.iconKey,
          sortOrder: section.sortOrder,
          services: section.services.map((service) => ({
            serviceId: service.id,
            label: service.label,
            categorySlug: service.categorySlug,
            sectionId: service.sectionId,
            imageUrl: service.imageUrl,
            isActive: true,
          })),
        }));
    const groupedCategorySlugs = new Set(
      sections.flatMap((section) => [
        normalizeCatalogLookup(section.id),
        ...section.services.map((service) => normalizeCatalogLookup(service.categorySlug)),
      ]),
    );
    const toHomeService = (service: (typeof sections)[number]['services'][number]) => {
      const slug = normalizeCatalogLookup(service.categorySlug);
      const category = categoryBySlug.get(slug);
      const content = categoryContentBySlug.get(slug);
      if (
        service.isActive === false ||
        !category ||
        !activeCategoryIdSet.has(String(category._id)) ||
        inactiveCategorySlugs.has(slug)
      ) {
        return null;
      }
      return {
        id: service.serviceId,
        label: service.label,
        categorySlug: service.categorySlug,
        categoryName: category.name || content?.title || service.label,
        sectionId: service.sectionId || '',
        imageUrl: service.imageUrl || content?.heroImageUrl || '',
        previewPackages: [],
        totalPackages: 0,
      };
    };
    const groupedSections = sections
      .map((section) => ({
        id: section.id,
        slug: section.slug,
        title: section.title,
        iconKey: section.iconKey,
        sortOrder: section.sortOrder,
        services: section.services.map(toHomeService).filter(
          (service): service is NonNullable<typeof service> => service !== null,
        ),
      }))
      .filter((section) => section.services.length > 0);
    const fallbackSections = visibleCategories
      .filter((category) => {
        const slug = normalizeCatalogLookup(category.slug);
        return (
          activeCategoryIdSet.has(String(category._id)) &&
          !groupedCategorySlugs.has(slug) &&
          !inactiveCategorySlugs.has(slug)
        );
      })
      .map((category) => {
        const slug = normalizeCatalogLookup(category.slug);
        const content = categoryContentBySlug.get(slug);
        return {
          id: slug,
          slug,
          title: content?.title || category.name || slug,
          iconKey: 'Broom',
          sortOrder: Number(category.sortOrder || 999),
          services: [{
            id: slug,
            label: content?.title || category.name || slug,
            categorySlug: slug,
            categoryName: category.name || slug,
            sectionId: '',
            imageUrl: content?.heroImageUrl || '',
            previewPackages: [],
            totalPackages: 0,
          }],
        };
      });

    return filterPersonalAssistantFromHubResponse(
      [...groupedSections, ...fallbackSections].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
      customerUid,
    );
  }

  static async listAdminServices(): Promise<AdminCatalogCategory[]> {
    const [categories, categoryContents, skuContents, hubSectionDocs] = await Promise.all([
      ServiceCategory.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .lean(),
      BookNowCategoryContent.find({}).select({ categorySlug: 1, isActive: 1 }).lean(),
      BookNowSkuContent.find({}).lean(),
      BookNowHubSection.find({ isActive: true }).lean(),
    ]);
    const categoryIds = categories.map((category) => category._id);
    const skus = categoryIds.length > 0
      ? await ServiceSku.find({ categoryId: { $in: categoryIds } })
          .sort({ name: 1 })
          .lean()
      : [];
    const categoryContentActiveBySlug = new Map(
      categoryContents.map((content) => [
        normalizeCatalogLookup(content.categorySlug),
        content.isActive,
      ] as const),
    );
    const pricingSkus = await LocationPricingService.listPricingSkus({});
    const defaultPriceBySkuId = new Map(
      pricingSkus.map((sku) => [String(sku._id), sku.defaultPrice] as const),
    );
    const hubSections = hubSectionDocs.length > 0
      ? hubSectionDocs.map((section) => ({
          id: section.slug,
          services: (Array.isArray(section.services) ? section.services : []).map((service) => ({
            categorySlug: service.categorySlug,
            isActive: service.isActive !== false,
          })),
        }))
      : BOOK_NOW_HUB_SECTION_SEED.map((section) => ({
          id: section.id,
          services: section.services.map((service) => ({
            categorySlug: service.categorySlug,
            isActive: true,
          })),
        }));
    const groupedCategorySlugs = new Set(
      hubSections.flatMap((section) => [
        normalizeCatalogLookup(section.id),
        ...section.services.map((service) => normalizeCatalogLookup(service.categorySlug)),
      ]),
    );
    const activeHubCategorySlugs = new Set(
      hubSections.flatMap((section) =>
        section.services
          .filter((service) =>
            service.isActive &&
            categoryContentActiveBySlug.get(normalizeCatalogLookup(service.categorySlug)) !== false,
          )
          .map((service) => normalizeCatalogLookup(service.categorySlug)),
      ),
    );

    return categories
      .filter((category) => {
        const categorySlug = normalizeCatalogLookup(category.slug);
        const isVisibleInHub = groupedCategorySlugs.has(categorySlug)
          ? activeHubCategorySlugs.has(categorySlug)
          : true;
        return (
          !isPersonalAssistantCategorySlug(categorySlug) ||
          canAccessPersonalAssistantCatalog()
        ) &&
          categoryContentActiveBySlug.get(categorySlug) !== false &&
          isVisibleInHub;
      })
      .map((category) => {
        const categorySkus = sortBookNowSkus(
          skus.filter((sku) => String(sku.categoryId) === String(category._id)),
        );
        const categoryContentsForSkus = skuContents.filter(
          (content) =>
            normalizeCatalogLookup(content.categorySlug) ===
            normalizeCatalogLookup(category.slug),
        );
        const activeContentBySkuSlug = new Map<string, (typeof skuContents)[number]>();
        categoryContentsForSkus
          .filter((content) => content.isActive)
          .forEach((content) => {
            [
              normalizeCatalogLookup(content.skuSlug),
              normalizeContentIdentity(content.skuSlug),
              normalizeCatalogLookup(content.displayName),
              normalizeContentIdentity(content.displayName),
            ]
              .filter(Boolean)
              .forEach((key) => activeContentBySkuSlug.set(key, content));
          });
        const activeCategorySkus = categorySkus.filter((sku) => sku.isActive);
        const appPackages = this.buildPackageListItems({
          category,
          skus: activeCategorySkus,
          contentBySkuSlug: activeContentBySkuSlug,
        });
        const appPackageBySkuId = new Map(
          appPackages.map((item) => [String(item._id), item] as const),
        );
        const allContentBySkuSlug = new Map<string, (typeof skuContents)[number]>();
        categoryContentsForSkus
          .filter(
            (content) =>
              normalizeCatalogLookup(content.categorySlug) ===
              normalizeCatalogLookup(category.slug),
          )
          .forEach((content) => {
            [
              normalizeCatalogLookup(content.skuSlug),
              normalizeContentIdentity(content.skuSlug),
              normalizeCatalogLookup(content.displayName),
              normalizeContentIdentity(content.displayName),
            ]
              .filter(Boolean)
              .forEach((key) => allContentBySkuSlug.set(key, content));
          });

        return {
          _id: String(category._id),
          slug: category.slug,
          name: category.name,
          description: category.description || '',
          iconUrl: category.iconUrl || '',
          sortOrder: Number(category.sortOrder || 0),
          isActive: category.isActive,
          isVisibleInApp: true,
          services: categorySkus
            .filter(
              (service) =>
                !service.isActive || appPackageBySkuId.has(String(service._id)),
            )
            .map((service) => {
              const defaultPrice = defaultPriceBySkuId.get(String(service._id));
              if (defaultPrice === undefined && service.isActive) {
                throw new Error(
                  `Global pricing was not returned for service SKU ${String(service._id)}`,
                );
              }
              const appPackage = appPackageBySkuId.get(String(service._id));
              const content = allContentBySkuSlug.get(
                normalizeCatalogLookup(service.slug),
              );
              return {
                _id: String(service._id),
                slug: service.slug,
                name: appPackage?.content?.displayName || content?.displayName || service.name,
                description: service.description || '',
                imageUrl:
                  appPackage?.primaryImageUrl ||
                  content?.imageUrls?.[0] ||
                  '',
                basePrice: Number(service.basePrice || 0),
                offerPrice: Number(service.offerPrice || 0),
                originalPrice: Number(service.basePrice || 0),
                defaultPrice: defaultPrice ?? getSkuOfferPrice(service),
                pricingUnit: service.pricingUnit,
                durationMinutes: Number(service.durationMinutes || 0),
                taskCategory: service.taskCategory,
                partnerCategoryId: service.partnerCategoryId || '',
                isActive: service.isActive,
                filterId: service.isActive && content?.isActive ? content.filterId || undefined : undefined,
                filterLabel: service.isActive && content?.isActive ? content.filterLabel || undefined : undefined,
              };
            }),
        };
      })
      .filter((category) => category.services.length > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  static async createAdminService(input: CreateCatalogServiceInput) {
    const categorySlug = input.categorySlug
      ? normalizeCatalogLookup(input.categorySlug)
      : slugifyCatalogValue(input.categoryName || '');
    const serviceSlug = slugifyCatalogValue(input.name);

    if (!categorySlug || !serviceSlug) {
      throw new BadRequestError('Category and service names must include letters or numbers');
    }

    const session = await mongoose.startSession();
    let result: { category: AdminCatalogCategory; service: AdminCatalogService } | null = null;

    try {
      await session.withTransaction(async (transactionSession) => {
        let category = await ServiceCategory.findOne({ slug: categorySlug }).session(transactionSession);
        const isNewCategory = !input.categorySlug;

        if (isNewCategory) {
          if (category) {
            throw new ConflictError(`A category with slug "${categorySlug}" already exists`);
          }
          const createdCategories = await ServiceCategory.create(
            [{
              slug: categorySlug,
              name: input.categoryName?.trim(),
              description: input.categoryDescription?.trim() || '',
              iconUrl: input.categoryIconUrl?.trim() || '',
              sortOrder: input.categorySortOrder ?? 0,
              isActive: true,
            }],
            { session: transactionSession },
          );
          category = createdCategories[0];
        } else if (!category) {
          throw new NotFoundError('Selected service category was not found');
        }

        const existingService = await ServiceSku.findOne({
          categoryId: category._id,
          slug: serviceSlug,
        }).session(transactionSession);
        if (existingService) {
          throw new ConflictError(`A service named "${input.name.trim()}" already exists in this category`);
        }

        const createdServices = await ServiceSku.create(
          [{
            categoryId: category._id,
            slug: serviceSlug,
            name: input.name.trim(),
            description: input.description?.trim() || '',
            basePrice: input.basePrice,
            pricingUnit: input.pricingUnit,
            durationMinutes: input.durationMinutes,
            taskCategory: input.partnerCategoryId,
            partnerCategoryId: input.partnerCategoryId,
            isActive: true,
          }],
          { session: transactionSession },
        );
        const service = createdServices[0];

        if (isNewCategory) {
          await BookNowCategoryContent.findOneAndUpdate(
            { categorySlug },
            {
              categorySlug,
              title: input.categoryName?.trim(),
              description: input.categoryDescription?.trim() || '',
              heroImageUrl: input.categoryIconUrl?.trim() || '',
              iconUrl: input.categoryIconUrl?.trim() || '',
              sortOrder: input.categorySortOrder ?? 0,
              isActive: true,
            },
            { upsert: true, new: true, session: transactionSession },
          );
        }

        await BookNowSkuContent.findOneAndUpdate(
          { categorySlug, skuSlug: serviceSlug },
          {
            categorySlug,
            skuSlug: serviceSlug,
            displayName: input.name.trim(),
            shortDescription: input.description?.trim() || '',
            longDescription: input.description?.trim() || '',
            filterId: input.filterId.trim(),
            filterLabel: input.filterLabel.trim(),
            imageUrls: input.imageUrl?.trim() ? [input.imageUrl.trim()] : [],
            isActive: true,
          },
          { upsert: true, new: true, session: transactionSession },
        );

        result = {
          category: {
            _id: String(category._id),
            slug: category.slug,
            name: category.name,
            description: category.description || '',
            iconUrl: category.iconUrl || '',
            sortOrder: Number(category.sortOrder || 0),
            isActive: category.isActive,
            isVisibleInApp: true,
            services: [],
          },
          service: {
            _id: String(service._id),
            slug: service.slug,
            name: service.name,
            description: service.description || '',
            imageUrl: input.imageUrl?.trim() || '',
            basePrice: Number(service.basePrice || 0),
            offerPrice: Number(service.offerPrice || 0),
            originalPrice: Number(service.basePrice || 0),
            defaultPrice: getSkuOfferPrice(service),
            pricingUnit: service.pricingUnit,
            durationMinutes: Number(service.durationMinutes || 0),
            taskCategory: service.taskCategory,
            partnerCategoryId: service.partnerCategoryId || '',
            isActive: service.isActive,
            filterId: input.filterId.trim(),
            filterLabel: input.filterLabel.trim(),
          },
        };
      });
    } finally {
      await session.endSession();
    }

    if (!result) {
      throw new Error('Service creation completed without returning the created records');
    }
    return result;
  }

  static async updateAdminServiceImage(id: string, imageUrl: string) {
    assertObjectId(id, 'service id');
    const sku = await ServiceSku.findById(id).lean();
    if (!sku) throw new NotFoundError('Service not found');
    const category = await ServiceCategory.findById(sku.categoryId).select({ slug: 1 }).lean();
    if (!category) throw new NotFoundError('Service category not found');

    return BookNowSkuContent.findOneAndUpdate(
      {
        categorySlug: normalizeCatalogLookup(category.slug),
        skuSlug: normalizeCatalogLookup(sku.slug),
      },
      {
        $set: { imageUrls: imageUrl ? [imageUrl] : [] },
        $setOnInsert: {
          categorySlug: normalizeCatalogLookup(category.slug),
          skuSlug: normalizeCatalogLookup(sku.slug),
          displayName: sku.name,
          isActive: true,
        },
      },
      { upsert: true, new: true, runValidators: true },
    ).lean();
  }

  static async updateAdminServiceOffer(id: string, offerPrice: number | null) {
    assertObjectId(id, 'service id');
    const sku = await ServiceSku.findById(id).select({ basePrice: 1 }).lean();
    if (!sku) throw new NotFoundError('Service not found');

    if (
      offerPrice !== null &&
      (!Number.isFinite(offerPrice) ||
        offerPrice <= 0 ||
        offerPrice >= Number(sku.basePrice || 0))
    ) {
      throw new BadRequestError('Offer price must be greater than zero and lower than the base price');
    }

    return this.patchOperationalSkuOffer(id, {
      offerPrice: offerPrice ?? 0,
      isOfferActive: offerPrice !== null,
    });
  }

  static async updateAdminServiceStatus(id: string, isActive: boolean) {
    assertObjectId(id, 'service id');
    const session = await mongoose.startSession();
    let updatedService: AdminCatalogService | null = null;
    try {
      await session.withTransaction(async (transactionSession) => {
        const service = await ServiceSku.findById(id).session(transactionSession);
        if (!service) throw new NotFoundError('Service not found');
        const category = await ServiceCategory.findById(service.categoryId)
          .select({ slug: 1 })
          .session(transactionSession);
        if (!category) throw new NotFoundError('Service category not found');

        service.isActive = isActive;
        await service.save({ session: transactionSession });

        await BookNowSkuContent.updateMany(
          {
            categorySlug: normalizeCatalogLookup(category.slug),
            skuSlug: normalizeCatalogLookup(service.slug),
          },
          { $set: { isActive } },
          { session: transactionSession },
        );

        updatedService = {
          _id: String(service._id),
          slug: service.slug,
          name: service.name,
          description: service.description || '',
          imageUrl: '',
          basePrice: Number(service.basePrice || 0),
          offerPrice: Number(service.offerPrice || 0),
          originalPrice: Number(service.basePrice || 0),
          defaultPrice: getSkuOfferPrice(service),
          pricingUnit: service.pricingUnit,
          durationMinutes: Number(service.durationMinutes || 0),
          taskCategory: service.taskCategory,
          partnerCategoryId: service.partnerCategoryId || '',
          isActive: service.isActive,
        };
      });
    } finally {
      await session.endSession();
    }

    if (!updatedService) {
      throw new Error('Service status update completed without returning the updated service');
    }
    return updatedService;
  }

  static async updateAdminService(
    id: string,
    input: UpdateCatalogServiceInput,
  ) {
    assertObjectId(id, 'service id');
    if (
      input.offerPrice !== null &&
      (!Number.isFinite(input.offerPrice) ||
        input.offerPrice <= 0 ||
        input.offerPrice >= input.basePrice)
    ) {
      throw new BadRequestError('Offer price must be greater than zero and lower than the base price');
    }

    const categorySlug = normalizeCatalogLookup(input.categorySlug);
    const session = await mongoose.startSession();
    let updatedService: AdminCatalogService | null = null;
    try {
      await session.withTransaction(async (transactionSession) => {
        const service = await ServiceSku.findById(id).session(transactionSession);
        if (!service) throw new NotFoundError('Service not found');
        const category = await ServiceCategory.findOne({
          slug: categorySlug,
          isActive: true,
        }).session(transactionSession);
        if (!category) throw new NotFoundError('Selected service category was not found');

        const conflictingSku = await ServiceSku.findOne({
          _id: { $ne: service._id },
          categoryId: category._id,
          slug: service.slug,
        }).session(transactionSession);
        if (conflictingSku) {
          throw new ConflictError('A service with this package slug already exists in the selected category');
        }

        const previousCategory = await ServiceCategory.findById(service.categoryId)
          .select({ slug: 1 })
          .session(transactionSession);
        if (!previousCategory) throw new NotFoundError('Current service category was not found');
        const previousCategorySlug = normalizeCatalogLookup(previousCategory.slug);
        if (previousCategorySlug !== categorySlug) {
          const targetContent = await BookNowSkuContent.findOne({
            categorySlug,
            skuSlug: normalizeCatalogLookup(service.slug),
          }).session(transactionSession);
          if (targetContent) {
            throw new ConflictError('Service content already exists in the selected category');
          }
        }

        service.categoryId = category._id;
        service.name = input.name.trim();
        service.description = input.description.trim();
        service.basePrice = input.basePrice;
        service.offerPrice = input.offerPrice ?? 0;
        service.offerDiscountType = 'percent';
        service.offerDiscountValue = 0;
        service.isOfferActive = input.offerPrice !== null;
        service.durationMinutes = input.durationMinutes;
        service.pricingUnit = input.pricingUnit;
        service.taskCategory = input.partnerCategoryId;
        service.partnerCategoryId = input.partnerCategoryId;
        service.isActive = input.isActive;
        await service.save({ session: transactionSession });

        await BookNowSkuContent.findOneAndUpdate(
          {
            categorySlug: previousCategorySlug,
            skuSlug: normalizeCatalogLookup(service.slug),
          },
          {
            $set: {
              categorySlug,
              skuSlug: normalizeCatalogLookup(service.slug),
              displayName: input.name.trim(),
              shortDescription: input.description.trim(),
              longDescription: input.description.trim(),
              imageUrls: input.imageUrl?.trim() ? [input.imageUrl.trim()] : [],
              isActive: input.isActive,
            },
            $setOnInsert: { sortOrder: 0 },
          },
          {
            upsert: true,
            new: true,
            runValidators: true,
            session: transactionSession,
          },
        );

        updatedService = {
          _id: String(service._id),
          slug: service.slug,
          name: service.name,
          description: service.description || '',
          imageUrl: input.imageUrl?.trim() || '',
          basePrice: Number(service.basePrice || 0),
          offerPrice: Number(service.offerPrice || 0),
          originalPrice: Number(service.basePrice || 0),
          defaultPrice: getSkuOfferPrice(service),
          pricingUnit: service.pricingUnit,
          durationMinutes: Number(service.durationMinutes || 0),
          taskCategory: service.taskCategory,
          partnerCategoryId: service.partnerCategoryId || '',
          isActive: service.isActive,
        };
      });
    } finally {
      await session.endSession();
    }

    if (!updatedService) {
      throw new Error('Service update completed without returning the updated service');
    }
    return updatedService;
  }

  static async listCategories(customerUid?: string | null) {
    const [categories, hubSections] = await Promise.all([
      ServiceCategory.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .lean(),
      BookNowHubSection.find({ isActive: true })
        .select({ slug: 1, title: 1, minOrderValue: 1 })
        .lean(),
    ]);

    const hubMinMap = new Map<string, number>();
    for (const h of hubSections) {
      if (typeof (h as any).minOrderValue === 'number') {
        hubMinMap.set(h.slug, (h as any).minOrderValue);
      }
    }

    const mutableCategories: any[] = [...categories];
    for (const c of mutableCategories) {
      const parent = resolveParentCategory(c.slug).slug;
      if (typeof c.minOrderValue !== 'number' && hubMinMap.has(parent)) {
        c.minOrderValue = hubMinMap.get(parent);
      } else if (typeof c.minOrderValue !== 'number' && hubMinMap.has(c.slug)) {
        c.minOrderValue = hubMinMap.get(c.slug);
      }
    }

    const categorySlugs = new Set(mutableCategories.map((c) => c.slug));
    for (const h of hubSections) {
      if (!categorySlugs.has(h.slug) && typeof (h as any).minOrderValue === 'number') {
        mutableCategories.push({
          _id: (h as any)._id,
          slug: h.slug,
          name: (h as any).title || h.slug,
          minOrderValue: (h as any).minOrderValue,
          isActive: true,
        });
      }
    }

    return filterPersonalAssistantCategories(mutableCategories, customerUid);
  }

  static async getCategoryBySlug(slug: string, customerUid?: string | null) {
    assertPersonalAssistantAccessible(slug, customerUid);
    const normalized = resolveCategoryAlias(slug);
    const category = await ServiceCategory.findOne({ slug: normalized, isActive: true }).lean();
    if (!category) throw new NotFoundError('Category not found');
    return category;
  }

  static async getHourlyHelperSkusByCategoryId(
    categoryId: string,
    location?: { area?: string; city?: string; state?: string; pinCode?: string; coordinates?: [number, number] },
  ): Promise<{ category: any; skus: any[] }> {
    if (!categoryId || !mongoose.Types.ObjectId.isValid(String(categoryId))) {
      throw new BadRequestError('A valid categoryId is required');
    }

    const category = await ServiceCategory.findOne({
      _id: new mongoose.Types.ObjectId(String(categoryId)),
      isActive: true,
    }).lean();
    if (!category) {
      throw new NotFoundError('Category not found');
    }

    if (category && typeof (category as any).minOrderValue !== 'number') {
      const hub = await BookNowHubSection.findOne({
        slug: { $in: [(category as any).slug, 'hourly-helper'] },
        isActive: true,
      }).select({ minOrderValue: 1 }).lean();
      if (hub && typeof (hub as any).minOrderValue === 'number') {
        (category as any).minOrderValue = (hub as any).minOrderValue;
      }
    }

    const skus = await ServiceSku.find({
      categoryId: category._id,
      isActive: true,
    }).sort({ durationMinutes: 1, name: 1 }).lean();

    return {
      category,
      skus: await this.enrichSkusWithLocationPricing(skus, location),
    };
  }

  private static async enrichSkusWithLocationPricing<T extends Record<string, unknown> & PricedSku>(
    skus: T[],
    location?: CatalogLocationInput,
  ) {
    if (!hasCatalogLocation(location)) return skus.map((sku) => enrichSkuPricing(sku));
    const context = await LocationPricingService.buildPricingContext(location);
    const priced = await LocationPricingService.priceSkus(skus, context);
    return skus.map((sku) => {
      const enriched = enrichSkuPricing(sku);
      const resolved = priced.get(String(sku._id));
      if (!resolved) return enriched;
      const pricing = withResolvedPricing(enriched.pricing, resolved);
      return {
        ...sku,
        offerPrice: pricing.offerPrice > 0 ? pricing.offerPrice : (sku.offerPrice || 0),
        pricing: { ...pricing, resolvedLocation: context.resolvedLocation },
      };
    });
  }

  static async getCategoryContent(categorySlug: string, customerUid?: string | null) {
    assertPersonalAssistantAccessible(categorySlug, customerUid);
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

  static async listSkusByCategorySlug(
    categorySlug: string,
    customerUid?: string | null,
    location?: { area?: string; city?: string; state?: string; pinCode?: string; coordinates?: [number, number] },
  ): Promise<any> {
    const category = await this.getCategoryBySlug(categorySlug, customerUid);
    const parentSlug = resolveParentCategory(categorySlug).slug;
    if (category && typeof (category as any).minOrderValue !== 'number') {
      const hub = await BookNowHubSection.findOne({
        slug: { $in: [categorySlug, parentSlug] },
        isActive: true,
      }).select({ minOrderValue: 1 }).lean();
      if (hub && typeof (hub as any).minOrderValue === 'number') {
        (category as any).minOrderValue = (hub as any).minOrderValue;
      }
    }
    const [skus, content] = await Promise.all([
      ServiceSku.find({ categoryId: category._id, isActive: true }).sort({ name: 1 }).lean(),
      BookNowCategoryContent.findOne({
        categorySlug: normalizeCatalogLookup(resolveCategoryAlias(categorySlug)),
        isActive: true,
      }).lean(),
    ]);
    return {
      category,
      skus: await this.enrichSkusWithLocationPricing(skus, location),
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
      isFeaturedOnHome?: boolean;
      featuredSortOrder?: number;
      filterId?: string;
      filterLabel?: string;
    }>;
    priceBySkuId?: Map<string, ResolvedSkuPrice>;
  }): BookNowPackageListItem[] {
    const { category, skus, contentBySkuSlug, priceBySkuId } = args;

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
        const resolvedPrice = priceBySkuId?.get(String(sku._id));
        const shortDescription = String(content?.shortDescription || '').trim();
        const fallbackDescription = String(sku.description || '').trim();
        const durationLabel = toDurationLabel(Number(sku.durationMinutes || 0));
        const serviceFlow = resolveBookNowServiceFlowConfig({
          categorySlug: category.slug,
          skuSlug: String(sku.slug || ''),
        });

        return {
          _id: sku._id,
          categorySlug: category.slug,
          categoryName: category.name,
          skuSlug: String(sku.slug || ''),
          name: String(sku.name || ''),
          description: shortDescription || fallbackDescription || durationLabel,
          durationMinutes: Number(sku.durationMinutes || 0),
          filterId: content?.filterId || undefined,
          filterLabel: content?.filterLabel || undefined,
          pricing: resolvedPrice ? withResolvedPricing(enriched.pricing, resolvedPrice) : enriched.pricing,
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
                isFeaturedOnHome: content.isFeaturedOnHome === true,
                featuredSortOrder: Number(content.featuredSortOrder || 0),
              }
            : null,
          primaryImageUrl: Array.isArray(content?.imageUrls) ? String(content?.imageUrls?.[0] || '').trim() : '',
          serviceFlow,
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

  static async getBookNowHubCatalog(
    previewLimit = 5,
    customerUid?: string | null,
    location?: CatalogLocationInput,
    featuredOnly = false,
    includeLocationPricing = true,
  ) {
    const limit = Math.max(1, Math.min(Number(previewLimit || 5), 8));
    const [categories, skuContents, categoryContents] = await Promise.all([
      ServiceCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      BookNowSkuContent.find({ isActive: true }).lean(),
      BookNowCategoryContent.find({}).sort({ sortOrder: 1, title: 1 }).lean(),
    ]);

    const visibleCategories = filterPersonalAssistantCategories(categories, customerUid);
    if (visibleCategories.length === 0) return [];

    const categoriesForHub = visibleCategories;
    const categoryIds = categoriesForHub.map((category) => category._id);
    const skus = await ServiceSku.find({ categoryId: { $in: categoryIds }, isActive: true })
      .sort({ name: 1, _id: 1 })
      .lean();
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
    const categorySlugById = new Map(
      categoriesForHub.map((category) => [String(category._id), normalizeCatalogLookup(category.slug)] as const),
    );
    const findSkuContent = (categorySlug: string, sku: (typeof skus)[number]) => {
      const candidateKeys = [
        normalizeCatalogLookup(String(sku.slug || '')),
        normalizeContentIdentity(String(sku.slug || '')),
        normalizeCatalogLookup(String(sku.name || '')),
        normalizeContentIdentity(String(sku.name || '')),
      ].filter(Boolean);
      return candidateKeys
        .map((key) => contentBySkuKey.get(`${categorySlug}::${key}`))
        .find(Boolean);
    };
    const skusToPrice = featuredOnly
      ? skus.filter((sku) => {
          const categorySlug = categorySlugById.get(String(sku.categoryId));
          return categorySlug && findSkuContent(categorySlug, sku)?.isFeaturedOnHome === true;
        })
      : skus;
    const priceBySkuId =
      includeLocationPricing && hasCatalogLocation(location)
        ? await LocationPricingService.priceSkusForAddress(skusToPrice, location)
        : undefined;
    const categoryContentBySlug = new Map(
      categoryContents.map((content) => [normalizeCatalogLookup(content.categorySlug), content] as const),
    );
    const inactiveCategoryContentSlugs = new Set(
      categoryContents
        .filter((content) => content.isActive === false)
        .map((content) => normalizeCatalogLookup(content.categorySlug)),
    );

    const categoryBySlug = new Map(
      categoriesForHub.map((category) => [normalizeCatalogLookup(category.slug), category] as const),
    );
    const packageItemsByCategorySlug = new Map<string, BookNowPackageListItem[]>();

    categoriesForHub.forEach((category) => {
      const normalizedCategorySlug = normalizeCatalogLookup(category.slug);
      let categorySkus = sortBookNowSkus(
        skus.filter((sku) => String(sku.categoryId) === String(category._id)),
      );
      const contentBySkuSlug = new Map<string, (typeof skuContents)[number]>();

      categorySkus.forEach((sku) => {
        const content = findSkuContent(normalizedCategorySlug, sku);
        if (content) {
          contentBySkuSlug.set(normalizeCatalogLookup(String(sku.slug || '')), content);
          contentBySkuSlug.set(normalizeContentIdentity(String(sku.slug || '')), content);
          contentBySkuSlug.set(normalizeCatalogLookup(String(sku.name || '')), content);
          contentBySkuSlug.set(normalizeContentIdentity(String(sku.name || '')), content);
        }
      });

      if (featuredOnly) {
        categorySkus = categorySkus.filter((sku) => {
          return contentBySkuSlug.get(normalizeCatalogLookup(String(sku.slug || '')))
            ?.isFeaturedOnHome === true;
        });
      }

      const items = this.buildPackageListItems({
        category,
        skus: categorySkus,
        contentBySkuSlug,
        priceBySkuId,
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
              previewPackages: featuredOnly
                ? getHubPreviewPackages(packages, packages.length)
                : getHubPreviewPackages(packages, limit),
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
              previewPackages: featuredOnly
                ? getHubPreviewPackages(packages, packages.length)
                : getHubPreviewPackages(packages, limit),
              totalPackages: packages.length,
            },
          ],
        };
      });

    const hubResponse = [...groupedSections, ...fallbackSections].sort((a, b) => a.sortOrder - b.sortOrder);

    return filterPersonalAssistantFromHubResponse(
      hubResponse as Parameters<typeof filterPersonalAssistantFromHubResponse>[0],
      customerUid,
    );
  }

  static async getBookNowCategoryPackages(categorySlug: string, customerUid?: string | null, location?: CatalogLocationInput) {
    const category = await this.getCategoryBySlug(categorySlug, customerUid);
    const parentSlug = resolveParentCategory(categorySlug).slug;
    if (category && typeof (category as any).minOrderValue !== 'number') {
      const hub = await BookNowHubSection.findOne({
        slug: { $in: [categorySlug, parentSlug] },
        isActive: true,
      }).select({ minOrderValue: 1 }).lean();
      if (hub && typeof (hub as any).minOrderValue === 'number') {
        (category as any).minOrderValue = (hub as any).minOrderValue;
      }
    }
    const normalizedCategorySlug = normalizeCatalogLookup(category.slug);
    const [skus, skuContents, categoryContent] = await Promise.all([
      ServiceSku.find({ categoryId: category._id, isActive: true })
        .sort({ name: 1, _id: 1 })
        .lean(),
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
        priceBySkuId: hasCatalogLocation(location)
          ? await LocationPricingService.priceSkusForAddress(skus, location)
          : undefined,
      }),
    };
  }

  /**
   * Match Book Now cart lines to active SKUs by explicit SKU id, then by slug within the line's category.
   * A slug shared by several categories without a category match stays unmatched rather than guessing.
   */
  static async matchBookNowLineSkus(
    lines: Array<{ catalogSkuId?: string; categorySlug?: string; skuSlug?: string }>,
  ): Promise<Array<IServiceSku | null>> {
    const skuIds = lines
      .map((line) => String(line.catalogSkuId || ''))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const slugs = new Set<string>();
    for (const line of lines) {
      const slug = String(line.skuSlug || '').trim();
      if (!slug) continue;
      slugs.add(slug);
      slugs.add(normalizeCatalogLookup(slug));
    }
    if (skuIds.length === 0 && slugs.size === 0) return lines.map(() => null);

    const skus = await ServiceSku.find({
      isActive: true,
      $or: [
        ...(skuIds.length ? [{ _id: { $in: skuIds } }] : []),
        ...(slugs.size ? [{ slug: { $in: [...slugs] } }] : []),
      ],
    }).lean<IServiceSku[]>();
    const categories = await ServiceCategory.find({
      _id: { $in: [...new Set(skus.map((sku) => String(sku.categoryId)))] },
    }).select('slug').lean();
    const categorySlugById = new Map(categories.map((category) => [String(category._id), category.slug]));

    return lines.map((line) => {
      const byId = line.catalogSkuId ? skus.find((sku) => String(sku._id) === String(line.catalogSkuId)) : undefined;
      if (byId) return byId;
      const slug = normalizeCatalogLookup(String(line.skuSlug || ''));
      if (!slug) return null;
      const candidates = skus.filter((sku) => normalizeCatalogLookup(sku.slug) === slug);
      const categorySlug = line.categorySlug ? resolveCategoryAlias(normalizeCatalogLookup(line.categorySlug)) : '';
      const inCategory = categorySlug
        ? candidates.find((sku) => categorySlugById.get(String(sku.categoryId)) === categorySlug)
        : undefined;
      if (inCategory) return inCategory;
      return candidates.length === 1 ? candidates[0] : null;
    });
  }

  static async getSkuDetail(skuSlug: string, categorySlug?: string, customerUid?: string | null) {
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
      this.getSkuContent(sku.slug, categorySlug, customerUid).catch(() => null),
    ]);

    if (category?.slug) {
      assertPersonalAssistantAccessible(category.slug, customerUid);
    }

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
    if (input.offerPrice !== undefined) update.offerPrice = input.offerPrice;
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

  static async getSkuContent(skuSlug: string, categorySlug?: string, customerUid?: string | null) {
    if (categorySlug) {
      assertPersonalAssistantAccessible(categorySlug, customerUid);
    }
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

    assertPersonalAssistantAccessible(content.categorySlug, customerUid);

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
        isFeaturedOnHome: input.isFeaturedOnHome === true,
        featuredSortOrder: typeof input.featuredSortOrder === 'number' ? input.featuredSortOrder : 0,
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
    if (input.isFeaturedOnHome !== undefined) update.isFeaturedOnHome = input.isFeaturedOnHome;
    if (input.featuredSortOrder !== undefined) update.featuredSortOrder = input.featuredSortOrder;
    if (input.isActive !== undefined) update.isActive = input.isActive;

    const content = await BookNowSkuContent.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!content) {
      throw new NotFoundError('Book Now service content not found');
    }
    return content;
  }

  static async listCustomerHomePromotions(includeInactive = false) {
    const now = new Date();
    const query: Record<string, unknown> = {};
    if (!includeInactive) {
      query.isActive = true;
      query.$and = [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ];
    }
    return CustomerHomePromotion.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
  }

  static async createCustomerHomePromotion(input: CreateCustomerHomePromotionInput) {
    return CustomerHomePromotion.create({
      ...input,
      actionValue: input.actionValue?.trim() || '',
      sortOrder: input.sortOrder ?? 0,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      isActive: input.isActive ?? true,
    });
  }

  static async patchCustomerHomePromotion(id: string, input: PatchCustomerHomePromotionInput) {
    assertObjectId(id, 'promotion id');
    const update: Record<string, unknown> = { ...input };
    if (input.actionValue !== undefined) update.actionValue = input.actionValue.trim();
    if (input.startsAt !== undefined) update.startsAt = input.startsAt ? new Date(input.startsAt) : null;
    if (input.endsAt !== undefined) update.endsAt = input.endsAt ? new Date(input.endsAt) : null;
    if (input.actionType !== undefined || input.actionValue !== undefined) {
      const current = await CustomerHomePromotion.findById(id).lean();
      if (!current) throw new NotFoundError('Customer home promotion not found');
      const actionType = input.actionType ?? current.actionType;
      const actionValue = input.actionValue ?? current.actionValue;
      if (actionType !== 'none' && !actionValue.trim()) {
        throw new BadRequestError('Action value is required for the selected action type');
      }
    }
    if (input.startsAt !== undefined || input.endsAt !== undefined) {
      const current = await CustomerHomePromotion.findById(id).lean();
      if (!current) throw new NotFoundError('Customer home promotion not found');
      const startsAt = input.startsAt === undefined
        ? current.startsAt
        : input.startsAt ? new Date(input.startsAt) : null;
      const endsAt = input.endsAt === undefined
        ? current.endsAt
        : input.endsAt ? new Date(input.endsAt) : null;
      if (startsAt && endsAt && endsAt < startsAt) {
        throw new BadRequestError('End date must be on or after the start date');
      }
    }
    const promotion = await CustomerHomePromotion.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true },
    ).lean();
    if (!promotion) throw new NotFoundError('Customer home promotion not found');
    return promotion;
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
