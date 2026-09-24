/**
 * testHourlyLocationPricing.ts
 *
 * Fetches hourly helper duration SKUs for three locations:
 *   1. Madhapur, Hyderabad, Telangana
 *   2. Uppal, Hyderabad, Telangana
 *   3. Bobbili, Vizianagaram, Andhra Pradesh
 *
 * Shows how location-based pricing resolves for each location and
 * produces a side-by-side comparison table.
 *
 * Usage:  npx ts-node src/scripts/testHourlyLocationPricing.ts
 */
import { Database } from '../config/database';
import { CatalogService } from '../services/CatalogService';
import { LocationPricingService } from '../services/LocationPricingService';
import ServiceSku from '../models/ServiceSku';
import ServiceCategory from '../models/ServiceCategory';
// logger not needed for this script

const LOCATIONS = [
  {
    label: 'Madhapur',
    area: 'Madhapur',
    city: 'Hyderabad',
    state: 'Telangana',
    pinCode: '500081',
  },
  {
    label: 'Uppal',
    area: 'Uppal',
    city: 'Hyderabad',
    state: 'Telangana',
    pinCode: '500039',
  },
  {
    label: 'Bobbili',
    area: 'Bobbili',
    city: 'Bobbili',
    state: 'Andhra Pradesh',
    pinCode: '535558',
  },
];

const CATEGORY_SLUG = 'hourly-helper';

function formatPrice(price: number): string {
  return `₹${price.toLocaleString('en-IN')}`;
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return `${minutes / 60} hr${minutes === 60 ? '' : 's'}`;
  return `${(minutes / 60).toFixed(1)} hrs`;
}

async function main() {
  await Database.connectToDb();
  console.log('\n====================================================');
  console.log('  HOURLY HELPER — LOCATION-BASED PRICING TEST');
  console.log('====================================================\n');

  // ── 1. Check if the hourly-helper category exists ─────────────
  const category = await ServiceCategory.findOne({ slug: CATEGORY_SLUG }).lean();
  if (!category) {
    console.error('❌ Category "hourly-helper" NOT FOUND in ServiceCategory collection!');
    console.error('   Run the seed first:  npx ts-node src/scripts/seedBookNowContent.ts');
    process.exit(1);
  }
  console.log(`✅ Category found: "${category.name}" (slug: ${category.slug}, isActive: ${category.isActive})`);
  console.log(`   _id: ${category._id}\n`);

  // ── 2. List all hourly SKUs in DB ─────────────────────────────
  const allHourlySkus = await ServiceSku.find({
    categoryId: category._id,
    pricingUnit: 'hourly',
  })
    .sort({ durationMinutes: 1 })
    .lean();

  console.log(`📦 Hourly SKUs in database: ${allHourlySkus.length}`);
  if (allHourlySkus.length === 0) {
    console.error('❌ No hourly SKUs found! The duration strip will be empty.');
    console.error('   The seed may not have run. Restart the task-service to trigger seedHourlyHelperCatalog().');
    process.exit(1);
  }

  console.log('');
  console.log('┌──────────────────────┬────────────────┬──────────────┬─────────────┬──────────┬────────┐');
  console.log('│ SKU Slug             │ Name           │ Duration     │ Base Price  │ Offer    │ Active │');
  console.log('├──────────────────────┼────────────────┼──────────────┼─────────────┼──────────┼────────┤');
  for (const sku of allHourlySkus) {
    const slug = String(sku.slug).padEnd(20);
    const name = String(sku.name).substring(0, 14).padEnd(14);
    const dur = durationLabel(sku.durationMinutes).padEnd(12);
    const base = formatPrice(sku.basePrice).padEnd(11);
    const offer = formatPrice(Number(sku.offerPrice || 0)).padEnd(8);
    const active = sku.isActive ? '  ✅  ' : '  ❌  ';
    console.log(`│ ${slug} │ ${name} │ ${dur} │ ${base} │ ${offer} │${active}│`);
  }
  console.log('└──────────────────────┴────────────────┴──────────────┴─────────────┴──────────┴────────┘');
  console.log('');

  // ── 3. Fetch for each location via CatalogService ─────────────
  const locationResults: Array<{
    label: string;
    skus: Array<{
      slug: string;
      name: string;
      durationMinutes: number;
      basePrice: number;
      offerPrice: number;
      pricingSource: string;
    }>;
  }> = [];

  for (const loc of LOCATIONS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📍 Location: ${loc.label} (${loc.area}, ${loc.city}, ${loc.state}, PIN: ${loc.pinCode})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // 3a. Resolve address
    try {
      const resolved = await LocationPricingService.resolveAddress({
        area: loc.area,
        city: loc.city,
        state: loc.state,
        pincode: loc.pinCode,
      });
      console.log(`   Address resolution: confidence=${resolved.confidence}, source=${resolved.source}`);
      console.log(`   stateId=${resolved.stateId}, cityId=${resolved.cityId}, pincodeId=${resolved.pincodeId}, areaId=${resolved.areaId}`);
    } catch (err: any) {
      console.log(`   ⚠️  Address resolution failed: ${err.message}`);
    }

    // 3b. Fetch category with SKUs (same as what the mobile app does)
    try {
      const { skus } = await CatalogService.listSkusByCategorySlug(
        CATEGORY_SLUG,
        undefined,  // no customerUid
        {
          area: loc.area,
          city: loc.city,
          state: loc.state,
          pinCode: loc.pinCode,
        },
      );

      const hourlySorted = skus
        .filter((s: any) => s.pricingUnit === 'hourly')
        .sort((a: any, b: any) => a.durationMinutes - b.durationMinutes);

      console.log(`\n   Hourly SKUs returned: ${hourlySorted.length}`);

      if (hourlySorted.length === 0) {
        console.log('   ⚠️  No hourly SKUs in response — duration strip would be EMPTY');
        locationResults.push({ label: loc.label, skus: [] });
        continue;
      }

      const skuResults: typeof locationResults[number]['skus'] = [];

      console.log('');
      console.log('   ┌──────────────┬──────────────┬─────────────┬─────────────┬──────────────────┐');
      console.log('   │ SKU Slug     │ Duration     │ Base Price  │ Offer Price │ Pricing Source   │');
      console.log('   ├──────────────┼──────────────┼─────────────┼─────────────┼──────────────────┤');

      for (const sku of hourlySorted as any[]) {
        const pricing = sku.pricing || {};
        const slug = String(sku.slug).substring(0, 12).padEnd(12);
        const dur = durationLabel(sku.durationMinutes).padEnd(12);
        const base = formatPrice(Number(pricing.originalPrice || sku.basePrice || 0)).padEnd(11);
        const offer = formatPrice(Number(pricing.offerPrice || 0)).padEnd(11);
        const source = String(pricing.pricingSource || 'global').padEnd(16);

        console.log(`   │ ${slug} │ ${dur} │ ${base} │ ${offer} │ ${source} │`);

        skuResults.push({
          slug: String(sku.slug),
          name: String(sku.name),
          durationMinutes: Number(sku.durationMinutes),
          basePrice: Number(pricing.originalPrice || sku.basePrice || 0),
          offerPrice: Number(pricing.offerPrice || 0),
          pricingSource: String(pricing.pricingSource || 'global'),
        });
      }
      console.log('   └──────────────┴──────────────┴─────────────┴─────────────┴──────────────────┘');

      locationResults.push({ label: loc.label, skus: skuResults });
    } catch (err: any) {
      console.error(`   ❌ API Error: ${err.message}`);
      locationResults.push({ label: loc.label, skus: [] });
    }
  }

  // ── 4. Side-by-side comparison ────────────────────────────────
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║           SIDE-BY-SIDE COMPARISON — EFFECTIVE PRICES BY LOCATION            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Collect all unique durations
  const allDurations = [...new Set(
    locationResults.flatMap((r) => r.skus.map((s) => s.durationMinutes)),
  )].sort((a, b) => a - b);

  if (allDurations.length === 0) {
    console.log('⚠️  No durations to compare — all locations returned empty results.');
  } else {
    // Header
    const locHeaders = locationResults.map((r) => r.label.padEnd(16)).join('│ ');
    console.log(`  Duration     │ ${locHeaders}`);
    console.log(`  ─────────────┼${'─'.repeat(17 + '│ '.length * (locationResults.length - 1) + 16 * (locationResults.length - 1))}`);

    for (const dur of allDurations) {
      const durStr = durationLabel(dur).padEnd(13);
      const prices = locationResults.map((locResult) => {
        const sku = locResult.skus.find((s) => s.durationMinutes === dur);
        if (!sku) return '—'.padEnd(16);
        const effective = sku.offerPrice > 0 ? sku.offerPrice : sku.basePrice;
        const src = sku.pricingSource === 'global' ? '' : ` (${sku.pricingSource})`;
        return `${formatPrice(effective)}${src}`.padEnd(16);
      });
      console.log(`  ${durStr} │ ${prices.join('│ ')}`);
    }
  }

  console.log('\n\n── Summary ──');
  for (const locResult of locationResults) {
    const sources = [...new Set(locResult.skus.map((s) => s.pricingSource))];
    console.log(`  ${locResult.label}: ${locResult.skus.length} SKUs, pricing sources: [${sources.join(', ')}]`);
  }

  console.log('\n✅ Done.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
