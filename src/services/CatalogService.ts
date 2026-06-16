import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import ServiceVariant from '../models/ServiceVariant';
import ServiceAddon from '../models/ServiceAddon';
import ServiceArea from '../models/ServiceArea';
import { UserServiceClient } from '../clients/UserServiceClient';
import { NotFoundError } from '../errors/AppError';
import logger from '../config/logger';
import { isHardcodedSupportedLocation } from '../constants/locations/isHardcodedSupportedLocation';

/** Mobile parent label vs catalog subcategory slugs */
const BOOK_NOW_CATEGORY_ALIASES: Record<string, string> = {
  'home-cleaning': 'full-house',
};

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
    const normalized = BOOK_NOW_CATEGORY_ALIASES[slug] || slug;
    const category = await ServiceCategory.findOne({ slug: normalized, isActive: true }).lean();
    if (!category) throw new NotFoundError('Category not found');
    return category;
  }

  static async listSkusByCategorySlug(categorySlug: string) {
    const category = await this.getCategoryBySlug(categorySlug);
    const skus = await ServiceSku.find({ categoryId: category._id, isActive: true })
      .sort({ name: 1 })
      .lean();
    return { category, skus };
  }

  static async getSkuDetail(skuSlug: string, categorySlug?: string) {
    const skuQuery: Record<string, unknown> = { slug: skuSlug, isActive: true };
    let categoryFilterApplied = false;

    if (categorySlug) {
      const normalizedCategory = BOOK_NOW_CATEGORY_ALIASES[categorySlug] || categorySlug;
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

    const [variants, addons, category] = await Promise.all([
      ServiceVariant.find({ skuId: sku._id, isActive: true }).sort({ isDefault: -1, name: 1 }).lean(),
      ServiceAddon.find({ skuId: sku._id, isActive: true }).sort({ name: 1 }).lean(),
      ServiceCategory.findById(sku.categoryId).lean(),
    ]);

    return { sku, variants, addons, category };
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
