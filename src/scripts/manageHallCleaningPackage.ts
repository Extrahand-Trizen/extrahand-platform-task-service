import { Database } from '../config/database';
import logger from '../config/logger';
import BookNowSkuContent from '../models/BookNowSkuContent';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';

/**
 * Script to Add or Remove 'Hall Cleaning' under Full House Cleaning ('full-house').
 *
 * Usage:
 *   Add / Upsert:
 *     npx ts-node src/scripts/manageHallCleaningPackage.ts --add
 *   or:
 *     npm run manage:hall-cleaning -- --add
 *
 *   Remove / Delete:
 *     npx ts-node src/scripts/manageHallCleaningPackage.ts --remove
 *   or:
 *     npm run manage:hall-cleaning -- --remove
 */

const CATEGORY_SLUG = 'full-house';
const SKU_SLUG = 'hall-cleaning';
const PACKAGE_NAME = 'Hall / Living Room Cleaning';
const ORIGINAL_PRICE_RUPEES = 799;
const OFFER_PRICE_RUPEES = 499;
const DURATION_MINUTES = 90;
const DURATION_LABEL = '1.5 hrs';

function offerDiscountPercent(originalPrice: number, offerPrice: number): number {
  if (originalPrice <= 0) return 0;
  return Number((((originalPrice - offerPrice) / originalPrice) * 100).toFixed(2));
}

async function addHallCleaning(): Promise<void> {
  const category = await ServiceCategory.findOne({ slug: CATEGORY_SLUG });
  if (!category?._id) {
    throw new Error(`Category with slug "${CATEGORY_SLUG}" not found in database. Run catalog seed first.`);
  }

  const discountPercent = offerDiscountPercent(ORIGINAL_PRICE_RUPEES, OFFER_PRICE_RUPEES);

  // 1. Upsert ServiceSku
  const sku = await ServiceSku.findOneAndUpdate(
    { categoryId: category._id, slug: SKU_SLUG },
    {
      categoryId: category._id,
      slug: SKU_SLUG,
      name: PACKAGE_NAME,
      description: `Living room dusting · Floor scrubbing · Sofa wipe · Balcony (${DURATION_LABEL})`,
      basePrice: ORIGINAL_PRICE_RUPEES,
      offerPrice: OFFER_PRICE_RUPEES,
      offerDiscountType: 'percent',
      offerDiscountValue: discountPercent,
      isOfferActive: OFFER_PRICE_RUPEES < ORIGINAL_PRICE_RUPEES,
      pricingUnit: 'fixed',
      durationMinutes: DURATION_MINUTES,
      taskCategory: 'cleaning',
      isActive: true,
    },
    { upsert: true, new: true },
  );

  // 2. Upsert BookNowSkuContent
  await BookNowSkuContent.findOneAndUpdate(
    { categorySlug: CATEGORY_SLUG, skuSlug: SKU_SLUG },
    {
      categorySlug: CATEGORY_SLUG,
      skuSlug: SKU_SLUG,
      displayName: PACKAGE_NAME,
      shortDescription: `Living room dusting · Floor scrubbing · Sofa wipe · Balcony (${DURATION_LABEL})`,
      longDescription:
        'Dedicated cleaning for living room/hall including ceiling fans, furniture dusting, TV unit wipe, floor mopping and balcony glass clean.',
      includes: [
        'Dry & wet vacuuming / floor scrubbing',
        'Furniture dusting & TV unit wiping',
        'Ceiling fan and switchboard dusting',
        'Balcony floor wipe & sliding glass door cleaning',
        'Sofa surface wipe & dry vacuuming',
      ],
      excludes: [
        'Heavy furniture shifting',
        'Wall painting or stain removal from paint',
        'Inside closed display showcases',
      ],
      imageUrls: [
        'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/fullhouse-combo-1bed.webp',
      ],
      faqItems: [
        {
          question: 'What is covered under Hall Cleaning?',
          answer: 'It covers complete living room floor, electronics exterior, sofa dry vacuum, and fans.',
        },
        {
          question: 'Are cleaning liquids and equipment brought by the helper?',
          answer: 'Yes, all standard cleaning tools and surface-safe liquids are brought by the service partner.',
        },
      ],
      sortOrder: 15, // positioned after Room Combos
      isActive: true,
    },
    { upsert: true, new: true },
  );

  logger.info(`✅ Successfully added/updated "${PACKAGE_NAME}" under category "${CATEGORY_SLUG}"`, {
    skuId: String(sku._id),
    categorySlug: CATEGORY_SLUG,
    skuSlug: SKU_SLUG,
    originalPrice: ORIGINAL_PRICE_RUPEES,
    offerPrice: OFFER_PRICE_RUPEES,
  });
}

async function removeHallCleaning(): Promise<void> {
  const category = await ServiceCategory.findOne({ slug: CATEGORY_SLUG });
  
  const contentResult = await BookNowSkuContent.deleteOne({
    categorySlug: CATEGORY_SLUG,
    skuSlug: SKU_SLUG,
  });

  let skuResult = { deletedCount: 0 };
  if (category?._id) {
    skuResult = await ServiceSku.deleteOne({
      categoryId: category._id,
      slug: SKU_SLUG,
    });
  }

  logger.info(`🗑️ Successfully removed "${PACKAGE_NAME}" from category "${CATEGORY_SLUG}"`, {
    skuDeletedCount: skuResult.deletedCount,
    contentDeletedCount: contentResult.deletedCount,
  });
}

async function main() {
  const isRemove = process.argv.includes('--remove');
  const isAdd = process.argv.includes('--add') || !isRemove;

  await Database.connectToDb();

  try {
    if (isRemove) {
      await removeHallCleaning();
    } else if (isAdd) {
      await addHallCleaning();
    }
  } finally {
    process.exit(0);
  }
}

main().catch((error) => {
  logger.error('Error managing hall cleaning package', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

