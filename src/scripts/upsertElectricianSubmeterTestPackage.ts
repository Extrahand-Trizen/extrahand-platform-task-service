import { Database } from '../config/database';
import logger from '../config/logger';
import BookNowSkuContent from '../models/BookNowSkuContent';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';

const CATEGORY_SLUG = 'electrician-submeter-installation';
const SKU_SLUG = 'submeter-installation';
const PACKAGE_NAME = 'Submeter Installation';

/** Canonical catalog price from Booknow services and prices(Sheet1).csv */
const ORIGINAL_PRICE_RUPEES = 349;
const OFFER_PRICE_RUPEES = 249;
const DURATION_MINUTES = 90;
const DURATION_LABEL = '1.5 hrs';

function offerDiscountPercent(originalPrice: number, offerPrice: number): number {
  if (originalPrice <= 0) return 0;
  return Number((((originalPrice - offerPrice) / originalPrice) * 100).toFixed(2));
}

async function main() {
  await Database.connectToDb();

  const category = await ServiceCategory.findOneAndUpdate(
    { slug: CATEGORY_SLUG },
    {
      slug: CATEGORY_SLUG,
      name: 'Submeter Installation',
      description: 'Submeter Installation under Electrician',
      sortOrder: 500,
      isActive: true,
    },
    { upsert: true, new: true },
  );

  if (!category?._id) {
    throw new Error(`Failed to upsert category ${CATEGORY_SLUG}`);
  }

  const discountPercent = offerDiscountPercent(ORIGINAL_PRICE_RUPEES, OFFER_PRICE_RUPEES);

  const sku = await ServiceSku.findOneAndUpdate(
    { categoryId: category._id, slug: SKU_SLUG },
    {
      categoryId: category._id,
      slug: SKU_SLUG,
      name: PACKAGE_NAME,
      description: `${DURATION_LABEL} • Offer ₹${OFFER_PRICE_RUPEES} from ₹${ORIGINAL_PRICE_RUPEES}`,
      basePrice: ORIGINAL_PRICE_RUPEES,
      offerDiscountType: 'percent',
      offerDiscountValue: discountPercent,
      isOfferActive: OFFER_PRICE_RUPEES < ORIGINAL_PRICE_RUPEES,
      pricingUnit: 'fixed',
      durationMinutes: DURATION_MINUTES,
      taskCategory: 'repair',
      isActive: true,
    },
    { upsert: true, new: true },
  );

  await BookNowSkuContent.findOneAndUpdate(
    { categorySlug: CATEGORY_SLUG, skuSlug: SKU_SLUG },
    {
      categorySlug: CATEGORY_SLUG,
      skuSlug: SKU_SLUG,
      displayName: PACKAGE_NAME,
      shortDescription: `${DURATION_LABEL} • Offer ₹${OFFER_PRICE_RUPEES} from ₹${ORIGINAL_PRICE_RUPEES}`,
      longDescription: '',
      includes: ['Submeter mounting', 'Basic electrical connection', 'Testing'],
      excludes: ['New submeter cost', 'Approval fees'],
      imageUrls: [
        'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/Submeter%20Installation.png',
      ],
      faqItems: [],
      sortOrder: 0,
      isActive: true,
    },
    { upsert: true, new: true },
  );

  logger.info('Restored electrician submeter package pricing', {
    categoryId: String(category._id),
    categorySlug: CATEGORY_SLUG,
    skuId: String(sku._id),
    skuSlug: SKU_SLUG,
    originalPrice: ORIGINAL_PRICE_RUPEES,
    offerPrice: OFFER_PRICE_RUPEES,
    discountPercent,
  });

  process.exit(0);
}

main().catch((error) => {
  logger.error('Failed to restore electrician submeter package pricing', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
