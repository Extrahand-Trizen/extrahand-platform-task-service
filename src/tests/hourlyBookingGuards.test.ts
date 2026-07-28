/**
 * Unit tests for Hourly Helper M1 guards (no database).
 * Run: npx ts-node src/tests/hourlyBookingGuards.test.ts
 */
import assert from 'assert';
import {
  assertHourlySingleVisitCheckout,
  hourInTimeZone,
  isHourlyCatalogLineInput,
  isHourlyResolvedLine,
  parseBookingFulfillmentType,
} from '../utils/hourlyBookingGuards';
import { HOURLY_HELPER_CATEGORY_SLUG } from '../constants/hourlyBooking';

function testDetectHourlyInput() {
  assert.strictEqual(
    isHourlyCatalogLineInput({ categorySlug: HOURLY_HELPER_CATEGORY_SLUG, skuSlug: 'hourly-2h' }),
    true,
  );
  assert.strictEqual(isHourlyCatalogLineInput({ skuSlug: 'hourly-1h' }), true);
  assert.strictEqual(
    isHourlyCatalogLineInput({ categorySlug: 'bathroom', skuSlug: 'deep-clean', name: 'x' } as never),
    false,
  );
}

function testIsHourlyResolvedIndependentOfLineCount() {
  assert.strictEqual(
    isHourlyResolvedLine({ pricingUnit: 'hourly', categorySlug: 'bathroom' }),
    true,
  );
  assert.strictEqual(
    isHourlyResolvedLine({ pricingUnit: 'fixed', categorySlug: HOURLY_HELPER_CATEGORY_SLUG }),
    true,
  );
  assert.strictEqual(
    isHourlyResolvedLine({ pricingUnit: 'fixed', categorySlug: 'bathroom' }),
    false,
  );
}

function testParseFulfillmentType() {
  assert.strictEqual(parseBookingFulfillmentType('instant'), 'instant');
  assert.strictEqual(parseBookingFulfillmentType('SCHEDULED'), 'scheduled');
  assert.strictEqual(parseBookingFulfillmentType(undefined), undefined);
  assert.throws(() => parseBookingFulfillmentType('recurring'));
}

function testAssertSingleVisit() {
  assert.throws(() =>
    assertHourlySingleVisitCheckout({
      lines: [
        {
          pricingUnit: 'hourly',
          categorySlug: HOURLY_HELPER_CATEGORY_SLUG,
          skuId: 'x',
          quantity: 1,
          durationMinutes: 60,
          lineTotal: 100,
        },
        {
          pricingUnit: 'hourly',
          categorySlug: HOURLY_HELPER_CATEGORY_SLUG,
          skuId: 'y',
          quantity: 1,
          durationMinutes: 60,
          lineTotal: 100,
        },
      ],
      fulfillmentType: 'instant',
    }),
  );

  assert.doesNotThrow(() =>
    assertHourlySingleVisitCheckout({
      lines: [
        {
          pricingUnit: 'hourly',
          categorySlug: HOURLY_HELPER_CATEGORY_SLUG,
          skuId: 'x',
          quantity: 1,
          durationMinutes: 120,
          lineTotal: 549,
        },
      ],
      fulfillmentType: 'scheduled',
    }),
  );

  // Non-hourly lines: no-op
  assert.doesNotThrow(() =>
    assertHourlySingleVisitCheckout({
      lines: [
        {
          pricingUnit: 'fixed',
          categorySlug: 'bathroom',
          quantity: 1,
          durationMinutes: 60,
          lineTotal: 249,
        },
      ],
    }),
  );
}

function testHourInTimezone() {
  // 2026-07-28 10:30 UTC = 16:00 Asia/Kolkata
  const d = new Date('2026-07-28T10:30:00.000Z');
  assert.strictEqual(hourInTimeZone(d, 'Asia/Kolkata'), 16);
}

function run() {
  testDetectHourlyInput();
  testIsHourlyResolvedIndependentOfLineCount();
  testParseFulfillmentType();
  testAssertSingleVisit();
  testHourInTimezone();
  console.log('hourlyBookingGuards.test.ts: all passed');
}

run();
