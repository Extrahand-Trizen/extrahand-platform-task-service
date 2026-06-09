import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import ServiceVariant from '../models/ServiceVariant';
import ServiceAddon from '../models/ServiceAddon';
import ServiceArea from '../models/ServiceArea';
import { NotFoundError } from '../errors/AppError';

export class CatalogService {
  static async listCategories() {
    const categories = await ServiceCategory.find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    return categories;
  }

  static async getCategoryBySlug(slug: string) {
    const category = await ServiceCategory.findOne({ slug, isActive: true }).lean();
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
    if (categorySlug) {
      const category = await this.getCategoryBySlug(categorySlug);
      skuQuery.categoryId = category._id;
    }
    const sku = await ServiceSku.findOne(skuQuery).lean();
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

  static async isPinCodeServiceable(pinCode: string, city?: string): Promise<boolean> {
    const query: Record<string, unknown> = { isActive: true, pinCodes: pinCode };
    if (city) query.city = new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const area = await ServiceArea.findOne(query).lean();
    if (area) return true;
    if (!city) return false;
    const cityWide = await ServiceArea.findOne({
      isActive: true,
      city: new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      pinCodes: { $size: 0 },
    }).lean();
    return Boolean(cityWide);
  }
}
