/**
 * Unit tests for Hourly Helper cancellation evaluator (no database).
 * Run: npx ts-node src/tests/hourlyCancellationEvaluator.test.ts
 */
import assert from 'assert';
import {
  assertAllowedInvariants,
  evaluateHourlyCancellation,
} from '../services/cancellation/cancellationEvaluator';
import { HOURLY_CANCELLATION_POLICY } from '../services/cancellation/hourlyCancellationPolicy';
import type {
  HourlyCancellationContext,
  HourlyCancellationResult,
} from '../services/cancellation/cancellationTypes';

const PAID_2H = 18900; // ₹189
const FIRST_HOUR = 9900; // ₹99
const PAID_PROMO = 7900; // ₹79 promo — post-arrival must clamp

function baseCtx(
  overrides: Partial<HourlyCancellationContext> = {},
): HourlyCancellationContext {
  const scheduledAt = new Date('2026-08-03T12:00:00.000Z');
  const cancelledAt = new Date('2026-08-03T08:00:00.000Z'); // 4h before → free
  return {
    paidAmountPaise: PAID_2H,
    firstHourRatePaise: FIRST_HOUR,
    cancelledBy: 'CUSTOMER',
    cancelledAt,
    scheduledAt,
    bookingStatus: 'assigning',
    taskStatus: 'open',
    taskExecutionPhase: null,
    ...overrides,
  };
}

function assertDenied(
  result: HourlyCancellationResult,
  reasonCode: HourlyCancellationResult['reasonCode'],
): void {
  assert.strictEqual(result.status, 'DENIED');
  assert.strictEqual(result.reasonCode, reasonCode);
  assert.strictEqual(result.customerFeePaise, 0);
  assert.strictEqual(result.settlement.refundAmountPaise, 0);
  assert.strictEqual(result.settlement.workerCompensationPaise, 0);
  assert.strictEqual(result.settlement.platformRetainedAmountPaise, 0);
  assert.strictEqual(result.refundRequired, false);
}

function assertAllowedMoney(
  result: HourlyCancellationResult,
  paid: number,
  fee: number,
  reasonCode: HourlyCancellationResult['reasonCode'],
): void {
  assert.strictEqual(result.status, 'ALLOWED');
  assert.strictEqual(result.reasonCode, reasonCode);
  assert.strictEqual(result.customerFeePaise, fee);
  assert.strictEqual(result.settlement.refundAmountPaise, paid - fee);
  assert.strictEqual(result.settlement.workerCompensationPaise, fee);
  assert.strictEqual(result.settlement.platformRetainedAmountPaise, 0);
  assert.strictEqual(result.refundRequired, paid - fee > 0);
  assertAllowedInvariants(result, paid);
}

function testUnpaidDenied() {
  assertDenied(
    evaluateHourlyCancellation(baseCtx({ bookingStatus: 'awaiting_payment' })),
    'UNPAID',
  );
  assertDenied(
    evaluateHourlyCancellation(baseCtx({ bookingStatus: 'draft' })),
    'UNPAID',
  );
}

function testAlreadyCancelledDenied() {
  assertDenied(
    evaluateHourlyCancellation(baseCtx({ bookingStatus: 'cancelled' })),
    'ALREADY_CANCELLED',
  );
  assertDenied(
    evaluateHourlyCancellation(baseCtx({ bookingStatus: 'refunded' })),
    'ALREADY_CANCELLED',
  );
}

function testCompletedDenied() {
  assertDenied(
    evaluateHourlyCancellation(
      baseCtx({ taskStatus: 'completed', bookingStatus: 'assigned' }),
    ),
    'COMPLETED',
  );
  assertDenied(
    evaluateHourlyCancellation(
      baseCtx({ taskStatus: 'review', bookingStatus: 'assigned' }),
    ),
    'COMPLETED',
  );
}

function testCustomerFreeCancel() {
  // cancelledAt 4h before scheduled → free
  assertAllowedMoney(
    evaluateHourlyCancellation(baseCtx()),
    PAID_2H,
    0,
    'FREE_CANCEL',
  );
}

function testCustomerLateFlatFee() {
  const scheduledAt = new Date('2026-08-03T12:00:00.000Z');
  const cancelledAt = new Date('2026-08-03T11:00:00.000Z'); // 60 min before
  assertAllowedMoney(
    evaluateHourlyCancellation(baseCtx({ scheduledAt, cancelledAt })),
    PAID_2H,
    HOURLY_CANCELLATION_POLICY.LATE_CANCEL_FEE_PAISE,
    'LATE_FLAT_FEE',
  );
}

function testCustomerLateFeeClampedToPaid() {
  const scheduledAt = new Date('2026-08-03T12:00:00.000Z');
  const cancelledAt = new Date('2026-08-03T11:00:00.000Z');
  const paid = 3000; // less than ₹49
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({ paidAmountPaise: paid, scheduledAt, cancelledAt }),
    ),
    paid,
    paid,
    'LATE_FLAT_FEE',
  );
}

function testExactFreeWindowBoundary() {
  // mins == 120 is NOT free (policy: mins > FREE_WINDOW)
  const scheduledAt = new Date('2026-08-03T12:00:00.000Z');
  const cancelledAt = new Date('2026-08-03T10:00:00.000Z'); // exactly 120 min
  assertAllowedMoney(
    evaluateHourlyCancellation(baseCtx({ scheduledAt, cancelledAt })),
    PAID_2H,
    HOURLY_CANCELLATION_POLICY.LATE_CANCEL_FEE_PAISE,
    'LATE_FLAT_FEE',
  );

  // just over 120 → free
  const cancelledJustOver = new Date('2026-08-03T09:59:00.000Z'); // 121 min
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({ scheduledAt, cancelledAt: cancelledJustOver }),
    ),
    PAID_2H,
    0,
    'FREE_CANCEL',
  );
}

function testCustomerPostArrival() {
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'arrived',
      }),
    ),
    PAID_2H,
    FIRST_HOUR,
    'POST_ARRIVAL_FEE',
  );
}

function testPostArrivalClampsToPaidPromo() {
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        paidAmountPaise: PAID_PROMO,
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'arrived',
      }),
    ),
    PAID_PROMO,
    PAID_PROMO,
    'POST_ARRIVAL_FEE',
  );
}

function testCustomerInProgressDenied() {
  assertDenied(
    evaluateHourlyCancellation(
      baseCtx({
        bookingStatus: 'assigned',
        taskStatus: 'started',
        taskExecutionPhase: 'arrived',
      }),
    ),
    'IN_PROGRESS',
  );
  assertDenied(
    evaluateHourlyCancellation(
      baseCtx({
        bookingStatus: 'assigned',
        taskStatus: 'in_progress',
        taskExecutionPhase: 'arrived',
      }),
    ),
    'IN_PROGRESS',
  );
}

function testHelperCancelledFullRefund() {
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        cancelledBy: 'HELPER',
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'on_the_way',
      }),
    ),
    PAID_2H,
    0,
    'HELPER_CANCELLED',
  );

  // Helper cancel after arrival still full refund (not no-show)
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        cancelledBy: 'HELPER',
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'arrived',
      }),
    ),
    PAID_2H,
    0,
    'HELPER_CANCELLED',
  );
}

function testHelperCancelInProgressDenied() {
  assertDenied(
    evaluateHourlyCancellation(
      baseCtx({
        cancelledBy: 'HELPER',
        bookingStatus: 'assigned',
        taskStatus: 'started',
      }),
    ),
    'IN_PROGRESS',
  );
}

function testPlatformCancelledFullRefund() {
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        cancelledBy: 'PLATFORM',
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'arrived',
      }),
    ),
    PAID_2H,
    0,
    'PLATFORM_CANCELLED',
  );
}

function testSystemCustomerNoShow() {
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        cancelledBy: 'SYSTEM',
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'arrived',
      }),
    ),
    PAID_2H,
    FIRST_HOUR,
    'CUSTOMER_NO_SHOW',
  );
}

function testSystemNoShowClampsPromo() {
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        cancelledBy: 'SYSTEM',
        paidAmountPaise: PAID_PROMO,
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'arrived',
      }),
    ),
    PAID_PROMO,
    PAID_PROMO,
    'CUSTOMER_NO_SHOW',
  );
}

function testSystemBeforeArrivalNoFee() {
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        cancelledBy: 'SYSTEM',
        bookingStatus: 'assigning',
        taskStatus: 'open',
        taskExecutionPhase: null,
      }),
    ),
    PAID_2H,
    0,
    'PLATFORM_CANCELLED',
  );
}

function testOnTheWayUsesTimeWindowNotArrival() {
  // on_the_way is not arrived — late window applies
  const scheduledAt = new Date('2026-08-03T12:00:00.000Z');
  const cancelledAt = new Date('2026-08-03T11:30:00.000Z');
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        scheduledAt,
        cancelledAt,
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'on_the_way',
      }),
    ),
    PAID_2H,
    HOURLY_CANCELLATION_POLICY.LATE_CANCEL_FEE_PAISE,
    'LATE_FLAT_FEE',
  );
}

function testAssignedBookingStillEvaluates() {
  // Existing BookingService blocks assigned for fixed Book Now; hourly evaluator allows it.
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'assigned',
      }),
    ),
    PAID_2H,
    0,
    'FREE_CANCEL',
  );
}

function testOneHourBookingNoShowFullFee() {
  const paid = FIRST_HOUR;
  assertAllowedMoney(
    evaluateHourlyCancellation(
      baseCtx({
        paidAmountPaise: paid,
        cancelledBy: 'SYSTEM',
        bookingStatus: 'assigned',
        taskStatus: 'assigned',
        taskExecutionPhase: 'arrived',
      }),
    ),
    paid,
    paid,
    'CUSTOMER_NO_SHOW',
  );
  const result = evaluateHourlyCancellation(
    baseCtx({
      paidAmountPaise: paid,
      cancelledBy: 'SYSTEM',
      bookingStatus: 'assigned',
      taskStatus: 'assigned',
      taskExecutionPhase: 'arrived',
    }),
  );
  assert.strictEqual(result.refundRequired, false);
}

testUnpaidDenied();
testAlreadyCancelledDenied();
testCompletedDenied();
testCustomerFreeCancel();
testCustomerLateFlatFee();
testCustomerLateFeeClampedToPaid();
testExactFreeWindowBoundary();
testCustomerPostArrival();
testPostArrivalClampsToPaidPromo();
testCustomerInProgressDenied();
testHelperCancelledFullRefund();
testHelperCancelInProgressDenied();
testPlatformCancelledFullRefund();
testSystemCustomerNoShow();
testSystemNoShowClampsPromo();
testSystemBeforeArrivalNoFee();
testOnTheWayUsesTimeWindowNotArrival();
testAssignedBookingStillEvaluates();
testOneHourBookingNoShowFullFee();

console.log('hourlyCancellationEvaluator.test.ts: all tests passed');
