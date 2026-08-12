/**
 * Unit tests for Hourly cancellation context builders + orchestrator pure paths.
 * Run: npx ts-node src/tests/hourlyCancellationOrchestrator.test.ts
 */
import assert from 'assert';
import {
  buildHourlyCancellationContext,
  defaultFirstHourRatePaise,
  formatScheduleDateKeyIST,
  isHourlyBookingFromHints,
  isPersistedCancellationResult,
  resolveVisitScheduledAt,
  rupeesToPaise,
  toHourlyCancellationResult,
} from '../services/cancellation/cancellationContext';
import { evaluateHourlyCancellation } from '../services/cancellation/cancellationEvaluator';
import { HOURLY_CANCELLATION_POLICY } from '../services/cancellation/hourlyCancellationPolicy';
import type { PersistedHourlyCancellationResult } from '../services/cancellation/cancellationTypes';
import { HOURLY_HELPER_CATEGORY_SLUG } from '../constants/hourlyBooking';

function testRupeesToPaise() {
  assert.strictEqual(rupeesToPaise(189), 18900);
  assert.strictEqual(rupeesToPaise(99.5), 9950);
  assert.strictEqual(rupeesToPaise(-1), 0);
}

function testDefaultFirstHour() {
  assert.strictEqual(defaultFirstHourRatePaise(), 9900);
}

function testIsHourlyHints() {
  assert.strictEqual(
    isHourlyBookingFromHints([
      { categorySlug: HOURLY_HELPER_CATEGORY_SLUG, skuSlug: 'hourly-2h' },
    ]),
    true,
  );
  assert.strictEqual(
    isHourlyBookingFromHints([{ categorySlug: 'bathroom', skuSlug: 'deep-clean' }]),
    false,
  );
  assert.strictEqual(
    isHourlyBookingFromHints([{ pricingUnit: 'hourly', categorySlug: 'x' }]),
    true,
  );
}

function testResolveVisitScheduledAt() {
  // 2026-08-03 stored as midnight IST
  const scheduledDate = new Date('2026-08-03T00:00:00.000+05:30');
  assert.strictEqual(formatScheduleDateKeyIST(scheduledDate), '2026-08-03');

  const at = resolveVisitScheduledAt({
    scheduledDate,
    scheduledTimeStart: '2:00 PM',
  });
  assert.strictEqual(at.toISOString(), '2026-08-03T08:30:00.000Z'); // 14:00 IST
}

function testBuildContextAndEvaluateLate() {
  const scheduledDate = new Date('2026-08-03T00:00:00.000+05:30');
  const ctx = buildHourlyCancellationContext({
    paidAmountRupees: 189,
    cancelledBy: 'CUSTOMER',
    cancelledAt: new Date('2026-08-03T07:30:00.000Z'), // 13:00 IST — 60m before 14:00
    scheduledDate,
    scheduledTimeStart: '2:00 PM',
    bookingStatus: 'assigned',
    taskStatus: 'assigned',
    taskExecutionPhase: 'on_the_way',
    helperAssigned: true,
  });

  assert.strictEqual(ctx.paidAmountPaise, 18900);
  assert.strictEqual(ctx.firstHourRatePaise, 9900);
  assert.strictEqual(ctx.taskExecutionPhase, 'on_the_way');
  assert.strictEqual(ctx.helperAssigned, true);

  const result = evaluateHourlyCancellation(ctx);
  assert.strictEqual(result.status, 'ALLOWED');
  assert.strictEqual(result.reasonCode, 'LATE_FLAT_FEE');
  assert.strictEqual(
    result.customerFeePaise,
    HOURLY_CANCELLATION_POLICY.LATE_CANCEL_FEE_PAISE,
  );
}

function testBuildContextPostArrival() {
  const scheduledDate = new Date('2026-08-03T00:00:00.000+05:30');
  const ctx = buildHourlyCancellationContext({
    paidAmountRupees: 189,
    cancelledBy: 'CUSTOMER',
    cancelledAt: new Date('2026-08-03T08:00:00.000Z'),
    scheduledDate,
    scheduledTimeStart: '2:00 PM',
    bookingStatus: 'assigned',
    taskStatus: 'assigned',
    taskExecutionPhase: 'arrived',
    helperAssigned: true,
  });
  const result = evaluateHourlyCancellation(ctx);
  assert.strictEqual(result.reasonCode, 'POST_ARRIVAL_FEE');
  assert.strictEqual(result.customerFeePaise, 9900);
}

function testNoHelperAssignedFullRefund() {
  const scheduledDate = new Date('2026-08-03T00:00:00.000+05:30');
  const ctx = buildHourlyCancellationContext({
    paidAmountRupees: 189,
    cancelledBy: 'CUSTOMER',
    cancelledAt: new Date('2026-08-03T07:30:00.000Z'),
    scheduledDate,
    scheduledTimeStart: '2:00 PM',
    bookingStatus: 'paid',
    taskStatus: 'open',
    taskExecutionPhase: null,
    helperAssigned: false,
  });
  const result = evaluateHourlyCancellation(ctx);
  assert.strictEqual(result.status, 'ALLOWED');
  assert.strictEqual(result.reasonCode, 'NO_HELPER_ASSIGNED');
  assert.strictEqual(result.customerFeePaise, 0);
  assert.strictEqual(result.settlement.refundAmountPaise, 18900);
}

function testPersistedResultRoundTrip() {
  const persisted: PersistedHourlyCancellationResult = {
    status: 'ALLOWED',
    reasonCode: 'FREE_CANCEL',
    reason: 'ok',
    customerFeePaise: 0,
    settlement: {
      refundAmountPaise: 18900,
      workerCompensationPaise: 0,
      platformRetainedAmountPaise: 0,
    },
    refundRequired: true,
    evaluatedAt: new Date().toISOString(),
    cancelledBy: 'CUSTOMER',
  };
  assert.strictEqual(isPersistedCancellationResult(persisted), true);
  assert.strictEqual(isPersistedCancellationResult({ foo: 1 }), false);
  const round = toHourlyCancellationResult(persisted);
  assert.strictEqual(round.reasonCode, 'FREE_CANCEL');
  assert.strictEqual(round.settlement.refundAmountPaise, 18900);
}

function testMissingScheduleThrows() {
  assert.throws(() =>
    resolveVisitScheduledAt({ scheduledDate: null, scheduledTimeStart: '2:00 PM' }),
  );
}

testRupeesToPaise();
testDefaultFirstHour();
testIsHourlyHints();
testResolveVisitScheduledAt();
testBuildContextAndEvaluateLate();
testBuildContextPostArrival();
testNoHelperAssignedFullRefund();
testPersistedResultRoundTrip();
testMissingScheduleThrows();

console.log('hourlyCancellationOrchestrator.test.ts: all tests passed');
