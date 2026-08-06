/**
 * Phase 4.4 — settlement payload shaping (no network).
 * Run: npx ts-node src/tests/hourlyCancellationSettlement.test.ts
 */
import assert from 'assert';
import { evaluateHourlyCancellation } from '../services/cancellation/cancellationEvaluator';
import { HOURLY_CANCELLATION_POLICY } from '../services/cancellation/hourlyCancellationPolicy';

function testLateSettlementShape() {
  const result = evaluateHourlyCancellation({
    paidAmountPaise: 18900,
    firstHourRatePaise: 9900,
    cancelledBy: 'CUSTOMER',
    cancelledAt: new Date('2026-08-03T11:00:00.000Z'),
    scheduledAt: new Date('2026-08-03T12:00:00.000Z'),
    bookingStatus: 'assigned',
    taskStatus: 'assigned',
    taskExecutionPhase: 'on_the_way',
  });
  assert.strictEqual(result.status, 'ALLOWED');
  assert.strictEqual(
    result.settlement.refundAmountPaise,
    18900 - HOURLY_CANCELLATION_POLICY.LATE_CANCEL_FEE_PAISE,
  );
  assert.strictEqual(
    result.settlement.workerCompensationPaise,
    HOURLY_CANCELLATION_POLICY.LATE_CANCEL_FEE_PAISE,
  );
  assert.strictEqual(result.settlement.platformRetainedAmountPaise, 0);
  assert.strictEqual(result.refundRequired, true);
}

function testFeeOnlyNoShowSettlement() {
  const result = evaluateHourlyCancellation({
    paidAmountPaise: 9900,
    firstHourRatePaise: 9900,
    cancelledBy: 'SYSTEM',
    cancelledAt: new Date('2026-08-03T12:00:00.000Z'),
    scheduledAt: new Date('2026-08-03T12:00:00.000Z'),
    bookingStatus: 'assigned',
    taskStatus: 'assigned',
    taskExecutionPhase: 'arrived',
  });
  assert.strictEqual(result.reasonCode, 'CUSTOMER_NO_SHOW');
  assert.strictEqual(result.settlement.refundAmountPaise, 0);
  assert.strictEqual(result.settlement.workerCompensationPaise, 9900);
  assert.strictEqual(result.refundRequired, false);
}

testLateSettlementShape();
testFeeOnlyNoShowSettlement();
console.log('hourlyCancellationSettlement.test.ts: all tests passed');
