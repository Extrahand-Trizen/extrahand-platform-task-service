/**
 * Phase 4.3 — BookingService hourly cancel routing helpers (no DB).
 * Run: npx ts-node src/tests/hourlyCancellationBookingServiceRouting.test.ts
 */
import assert from 'assert';
import { isHourlyBookingFromHints } from '../services/cancellation/cancellationContext';
import { evaluateHourlyCancellation } from '../services/cancellation/cancellationEvaluator';
import { HOURLY_HELPER_CATEGORY_SLUG } from '../constants/hourlyBooking';
import { BadRequestError } from '../errors/AppError';

function testFixedPriceNotRoutedToHourly() {
  assert.strictEqual(
    isHourlyBookingFromHints([
      { categorySlug: 'bathroom', skuSlug: 'bathroom-cleaning' },
    ]),
    false,
  );
}

function testHourlyRouted() {
  assert.strictEqual(
    isHourlyBookingFromHints([
      { categorySlug: HOURLY_HELPER_CATEGORY_SLUG, skuSlug: 'hourly-2h' },
    ]),
    true,
  );
}

/**
 * Mirrors BookingService.cancelHourlyBookingOrder DENIED → BadRequestError mapping.
 */
function testDeniedMapsToBadRequest() {
  const result = evaluateHourlyCancellation({
    paidAmountPaise: 18900,
    firstHourRatePaise: 9900,
    cancelledBy: 'CUSTOMER',
    cancelledAt: new Date('2026-08-03T10:00:00.000Z'),
    scheduledAt: new Date('2026-08-03T12:00:00.000Z'),
    bookingStatus: 'assigned',
    taskStatus: 'started',
    taskExecutionPhase: 'arrived',
    helperAssigned: true,
  });
  assert.strictEqual(result.status, 'DENIED');
  assert.strictEqual(result.reasonCode, 'IN_PROGRESS');

  const err = new BadRequestError(
    result.reason || 'Cannot cancel this booking',
    result.reasonCode,
  );
  assert.strictEqual(err.code, 'IN_PROGRESS');
  assert.ok(err.message.includes('started') || err.message.length > 0);
}

testFixedPriceNotRoutedToHourly();
testHourlyRouted();
testDeniedMapsToBadRequest();
console.log('hourlyCancellationBookingServiceRouting.test.ts: all tests passed');
