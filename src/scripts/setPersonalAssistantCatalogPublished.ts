/**
 * Publish or unpublish Personal Assistant in the Book Now catalog (MongoDB).
 *
 * Usage:
 *   npm run pa-catalog:unpublish
 *   npm run pa-catalog:publish
 *   BOOK_NOW_PERSONAL_ASSISTANT_PREVIEW_UIDS=uid1,uid2 npm run pa-catalog:unpublish
 */
import { Database } from '../config/database';
import logger from '../config/logger';
import BookNowCategoryContent from '../models/BookNowCategoryContent';
import BookNowHubSection from '../models/BookNowHubSection';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import ServiceVariant from '../models/ServiceVariant';
import {
  PERSONAL_ASSISTANT_CATEGORY_SLUG,
  PERSONAL_ASSISTANT_DURATION_SKUS,
} from '../constants/personalAssistantBooking';

function parsePublishFlag(argv: string[]): boolean {
  const publish = argv.includes('--publish');
  const unpublish = argv.includes('--unpublish');
  if (publish === unpublish) {
    throw new Error('Pass exactly one of --publish or --unpublish');
  }
  return publish;
}

async function main() {
  const publish = parsePublishFlag(process.argv.slice(2));
  const isActive = publish;

  await Database.connectToDb();

  const category = await ServiceCategory.findOne({ slug: PERSONAL_ASSISTANT_CATEGORY_SLUG });
  if (!category) {
    logger.warn('Personal Assistant category not found — nothing to update', {
      slug: PERSONAL_ASSISTANT_CATEGORY_SLUG,
    });
    process.exit(0);
  }

  await ServiceCategory.updateOne({ _id: category._id }, { $set: { isActive } });

  await BookNowCategoryContent.updateOne(
    { categorySlug: PERSONAL_ASSISTANT_CATEGORY_SLUG },
    { $set: { isActive } },
  );

  await BookNowHubSection.updateOne(
    { slug: PERSONAL_ASSISTANT_CATEGORY_SLUG },
    { $set: { isActive } },
  );

  const hubSection = await BookNowHubSection.findOne({ slug: PERSONAL_ASSISTANT_CATEGORY_SLUG }).lean();
  if (hubSection && Array.isArray(hubSection.services) && hubSection.services.length > 0) {
    await BookNowHubSection.updateOne(
      { slug: PERSONAL_ASSISTANT_CATEGORY_SLUG },
      {
        $set: {
          services: hubSection.services.map((service) => ({
            ...service,
            isActive,
          })),
        },
      },
    );
  }

  const skuSlugs = PERSONAL_ASSISTANT_DURATION_SKUS.map((sku) => sku.slug);
  const skus = await ServiceSku.find({ categoryId: category._id, slug: { $in: skuSlugs } })
    .select({ _id: 1 })
    .lean();
  const skuIds = skus.map((sku) => sku._id);

  if (skuIds.length > 0) {
    await ServiceSku.updateMany({ _id: { $in: skuIds } }, { $set: { isActive } });
    await ServiceVariant.updateMany({ skuId: { $in: skuIds } }, { $set: { isActive } });
  }

  logger.info('Personal Assistant catalog visibility updated', {
    slug: PERSONAL_ASSISTANT_CATEGORY_SLUG,
    isActive,
    skuCount: skuIds.length,
  });

  process.exit(0);
}

main().catch((error) => {
  logger.error('Failed to update Personal Assistant catalog visibility', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
