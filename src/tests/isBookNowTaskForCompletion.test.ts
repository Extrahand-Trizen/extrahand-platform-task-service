/**
 * Unit tests for Book Now completion identity helper (no database).
 * Run: npx ts-node src/tests/isBookNowTaskForCompletion.test.ts
 */
import assert from 'assert';
import { isBookNowTaskForCompletion } from '../utils/isBookNowTaskForCompletion';

function testBookingSourceBookNow() {
  assert.strictEqual(isBookNowTaskForCompletion({ bookingSource: 'book_now' }), true);
}

function testBookingOrderId() {
  assert.strictEqual(
    isBookNowTaskForCompletion({ bookingSource: 'marketplace', bookingOrderId: 'ord_1' }),
    true,
  );
}

function testMarketplaceOnly() {
  assert.strictEqual(isBookNowTaskForCompletion({ bookingSource: 'marketplace' }), false);
  assert.strictEqual(isBookNowTaskForCompletion({}), false);
}

testBookingSourceBookNow();
testBookingOrderId();
testMarketplaceOnly();
console.log('isBookNowTaskForCompletion.test.ts: all tests passed');
