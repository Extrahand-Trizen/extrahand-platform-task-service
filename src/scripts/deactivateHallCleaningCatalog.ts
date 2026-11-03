import mongoose from 'mongoose';
import BookNowSkuContent from '../models/BookNowSkuContent';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import ServiceVariant from '../models/ServiceVariant';

const CATEGORY_SLUG = 'full-house';
const SKU_SLUG = 'hall-cleaning';
const PACKAGE_NAME = /^Hall \/ Living Room Cleaning$/i;

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required to deactivate Hall / Living Room Cleaning');
  }

  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DB || 'extrahand',
  });

  try {
    const category = await ServiceCategory.findOne({ slug: CATEGORY_SLUG })
      .select('_id')
      .lean();
    if (!category) {
      throw new Error(`Catalog category "${CATEGORY_SLUG}" was not found`);
    }

    const skus = await ServiceSku.find({
      categoryId: category._id,
      $or: [{ slug: SKU_SLUG }, { name: PACKAGE_NAME }],
    })
      .select('_id slug')
      .lean();
    const skuIds = skus.map((sku) => sku._id);
    const skuSlugs = [...new Set([SKU_SLUG, ...skus.map((sku) => sku.slug)])];

    const [skuResult, variantResult, contentResult] = await Promise.all([
      ServiceSku.updateMany(
        {
          categoryId: category._id,
          $or: [{ slug: SKU_SLUG }, { name: PACKAGE_NAME }],
        },
        { $set: { isActive: false } },
      ),
      skuIds.length > 0
        ? ServiceVariant.updateMany(
            { skuId: { $in: skuIds } },
            { $set: { isActive: false } },
          )
        : Promise.resolve({ modifiedCount: 0 }),
      BookNowSkuContent.updateMany(
        { categorySlug: CATEGORY_SLUG, skuSlug: { $in: skuSlugs } },
        { $set: { isActive: false } },
      ),
    ]);

    const result = {
      active: false,
      skus: skuResult.modifiedCount,
      variants: variantResult.modifiedCount,
      content: contentResult.modifiedCount,
    };
    console.log('Hall / Living Room Cleaning deactivated:', result);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Failed to deactivate Hall / Living Room Cleaning:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
