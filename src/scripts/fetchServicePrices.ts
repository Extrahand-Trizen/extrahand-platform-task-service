/**
 * Fetch all active services and their prices from the database.
 *
 * Outputs a structured table: Category → SKU name, basePrice, offerPrice,
 * pricingUnit, and any variants with their price deltas.
 *
 * Usage (from extrahand-platform-task-service):
 *   npx ts-node --transpile-only src/scripts/fetchServicePrices.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { config } from '../config/env';
import ServiceCategory from '../models/ServiceCategory';
import ServiceSku from '../models/ServiceSku';
import ServiceVariant from '../models/ServiceVariant';

async function main(): Promise<void> {
  const uri = config.MONGODB_URI;
  if (!uri) {
    console.error('❌  No MONGODB_URI found in environment.');
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: config.MONGODB_DB ?? 'extrahand' });
  console.log('✅  Connected to MongoDB\n');

  // ── 1. Fetch all active categories, sorted by display order ──────────────
  const categories = await ServiceCategory.find({ isActive: true }).sort({
    sortOrder: 1,
    name: 1,
  });

  if (categories.length === 0) {
    console.log('No active service categories found.');
    return;
  }

  let totalSkus = 0;

  for (const category of categories) {
    // ── 2. Fetch active SKUs for this category ──────────────────────────────
    const skus = await ServiceSku.find({
      categoryId: category._id,
      isActive: true,
    }).sort({ name: 1 });

    console.log('═'.repeat(70));
    console.log(
      `📂  ${category.name.toUpperCase()}  (slug: ${category.slug})`,
    );
    if (category.description) {
      console.log(`    ${category.description}`);
    }
    console.log('─'.repeat(70));

    if (skus.length === 0) {
      console.log('    (no active SKUs)\n');
      continue;
    }

    for (const sku of skus) {
      totalSkus++;

      const effectivePrice =
        sku.isOfferActive && sku.offerPrice && sku.offerPrice > 0
          ? sku.offerPrice
          : sku.basePrice;

      const offerTag =
        sku.isOfferActive && sku.offerPrice && sku.offerPrice > 0
          ? ` → ₹${sku.offerPrice} (offer active)`
          : '';

      const unit = sku.pricingUnit === 'hourly' ? '/hr' : ' fixed';

      console.log(
        `  🔧  ${sku.name}  [slug: ${sku.slug}]`,
      );
      console.log(
        `       Price : ₹${sku.basePrice}${unit}${offerTag}`,
      );
      console.log(
        `       Duration: ${sku.durationMinutes} min  |  Category tag: ${sku.taskCategory}`,
      );

      if (sku.description) {
        console.log(`       ${sku.description}`);
      }

      // ── 3. Fetch variants for this SKU ──────────────────────────────────
      const variants = await ServiceVariant.find({
        skuId: sku._id,
        isActive: true,
      }).sort({ isDefault: -1, name: 1 });

      if (variants.length > 0) {
        console.log('       Variants:');
        for (const v of variants) {
          const variantPrice = effectivePrice + v.priceDelta;
          const deltaStr =
            v.priceDelta > 0
              ? `+₹${v.priceDelta}`
              : v.priceDelta < 0
                ? `-₹${Math.abs(v.priceDelta)}`
                : '±₹0';
          const defaultTag = v.isDefault ? ' [default]' : '';
          console.log(
            `         • ${v.name}${defaultTag}  ${deltaStr}  → ₹${variantPrice}`,
          );
        }
      }

      console.log();
    }
  }

  console.log('═'.repeat(70));
  console.log(
    `\n📊  Summary: ${categories.length} categories, ${totalSkus} active SKUs\n`,
  );
}

main()
  .catch((err) => {
    console.error('❌  Script failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log('🔌  Disconnected from MongoDB');
  });
