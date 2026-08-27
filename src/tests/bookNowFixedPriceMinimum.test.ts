/**
 * Unit tests for Book Now fixed-price minimum checkout.
 * Run: npx ts-node src/tests/bookNowFixedPriceMinimum.test.ts
 */
import assert from 'assert';
import {
  assertBookNowFixedPriceMinimumCheckout,
  getBookNowFixedPriceMinimumShortfall,
  shouldSkipBookNowFixedPriceMinimum,
} from '../utils/bookNowFixedPriceMinimum';
import { BOOK_NOW_MIN_CHECKOUT_NOT_MET_CODE } from '../constants/bookNowCheckout';
import { BadRequestError } from '../errors/AppError';

function fixedLine(lineTotal: number, categorySlug = 'kitchen') {
  return { lineTotal, categorySlug, pricingUnit: 'fixed' as const };
}

function hourlyLine(lineTotal: number) {
  return { lineTotal, categorySlug: 'hourly-helper', pricingUnit: 'hourly' as const };
}

function personalAssistantLine(lineTotal: number) {
  return { lineTotal, categorySlug: 'personal-assistance', pricingUnit: 'hourly' as const };
}

function paintingConsultationLine(lineTotal: number) {
  return {
    lineTotal,
    categorySlug: 'painting',
    packageSlug: 'painting-consultation-interior-1-room',
    serviceFlowType: 'consultation_project' as const,
    bookingKind: 'consultation' as const,
    serviceType: 'painting',
    pricingUnit: 'fixed' as const,
  };
}

assert.strictEqual(shouldSkipBookNowFixedPriceMinimum([hourlyLine(99)]), true);
assert.strictEqual(shouldSkipBookNowFixedPriceMinimum([personalAssistantLine(149)]), true);
assert.strictEqual(shouldSkipBookNowFixedPriceMinimum([paintingConsultationLine(99)]), true);
assert.strictEqual(shouldSkipBookNowFixedPriceMinimum([fixedLine(99)]), false);

assert.strictEqual(getBookNowFixedPriceMinimumShortfall([fixedLine(99)]), 100);
assert.strictEqual(getBookNowFixedPriceMinimumShortfall([fixedLine(199)]), 0);
assert.strictEqual(getBookNowFixedPriceMinimumShortfall([fixedLine(198)]), 1);
assert.strictEqual(
  getBookNowFixedPriceMinimumShortfall([fixedLine(100), fixedLine(98)]),
  1,
);
assert.strictEqual(getBookNowFixedPriceMinimumShortfall([hourlyLine(50)]), 0);
assert.strictEqual(getBookNowFixedPriceMinimumShortfall([paintingConsultationLine(99)]), 0);

try {
  assertBookNowFixedPriceMinimumCheckout([fixedLine(150)]);
  assert.fail('expected minimum checkout error');
} catch (error) {
  assert.ok(error instanceof BadRequestError);
  assert.strictEqual(error.code, BOOK_NOW_MIN_CHECKOUT_NOT_MET_CODE);
  assert.match(error.message, /₹199/);
  assert.match(error.message, /₹49/);
}

assertBookNowFixedPriceMinimumCheckout([fixedLine(199)]);
assertBookNowFixedPriceMinimumCheckout([personalAssistantLine(149)]);
assertBookNowFixedPriceMinimumCheckout([hourlyLine(79)]);
assertBookNowFixedPriceMinimumCheckout([paintingConsultationLine(99)]);

console.log('bookNowFixedPriceMinimum.test.ts: all passed');
