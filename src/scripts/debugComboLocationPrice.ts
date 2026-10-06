import { Database } from '../config/database';
import { CatalogService } from '../services/CatalogService';
import ServiceSku from '../models/ServiceSku';
import ServiceCategory from '../models/ServiceCategory';
import HourlySkuLocationPrice from '../models/HourlySkuLocationPrice';

async function main() {
  await Database.connectToDb();
  const skus = await ServiceSku.find({
    isActive: true,
    $or: [
      { slug: /combo|bedroom|bhk/i },
      { name: /combo|bedroom/i },
    ],
  }).lean();
  const categories = await ServiceCategory.find({
    _id: { $in: skus.map((sku) => sku.categoryId) },
  }).select('slug name').lean();
  const categoryById = new Map(categories.map((category) => [String(category._id), category]));
  const rules = await HourlySkuLocationPrice.find({
    skuId: { $in: skus.map((sku) => sku._id) },
    isActive: true,
  }).lean();
  const rulesBySku = new Map<string, typeof rules>();
  for (const rule of rules) {
    const key = String(rule.skuId);
    const list = rulesBySku.get(key) ?? [];
    list.push(rule);
    rulesBySku.set(key, list);
  }

  for (const sku of skus) {
    const category = categoryById.get(String(sku.categoryId));
    const skuRules = rulesBySku.get(String(sku._id)) ?? [];
    console.log(JSON.stringify({
      slug: sku.slug,
      name: sku.name,
      category: category?.slug,
      categoryName: category?.name,
      basePrice: sku.basePrice,
      offerPrice: sku.offerPrice,
      isOfferActive: sku.isOfferActive,
      rules: skuRules.map((rule) => ({
        offerPrice: rule.offerPrice,
        locationType: rule.locationType,
        locationId: String(rule.locationId),
      })),
    }));
  }

  const priced = await CatalogService.getBookNowCategoryPackages('full-house', null, {
    area: 'Uppal',
    city: 'Hyderabad',
    state: 'Telangana',
  });
  const fs = await import('fs');
  fs.writeFileSync(
    'D:/ExtraHand/fh-priced.json',
    JSON.stringify(priced.packages.map((item) => ({
      skuSlug: item.skuSlug,
      name: item.name,
      display: item.content?.displayName || null,
      offer: item.pricing.offerPrice,
      global: item.pricing.globalOfferPrice,
      original: item.pricing.originalPrice,
      source: item.pricing.pricingSource,
    })), null, 2),
  );
  console.log('wrote', priced.packages.length);
  const appShaped = await CatalogService.getBookNowCategoryPackages('full-house', null, {
    area: 'Uppal',
    coordinates: [78.5681716, 17.4015441],
  });
  const combo = appShaped.packages.find((item) => item.skuSlug === '1-bedroom-combo' || item.skuSlug === 'combo-1bed');
  console.log('APP SHAPE', JSON.stringify(combo ? {
    slug: combo.skuSlug,
    offer: combo.pricing.offerPrice,
    global: combo.pricing.globalOfferPrice,
    source: combo.pricing.pricingSource,
  } : null));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
