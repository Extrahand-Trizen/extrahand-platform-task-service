/**
 * Run: npx ts-node src/tests/projectCancellationPolicy.test.ts
 */
import assert from 'assert';
import {
  evaluateProjectCancellation,
  resolveProjectWorkDaysCounted,
  PROJECT_CANCELLATION_POLICY,
} from '../services/cancellation/projectCancellationPolicy';

const start = new Date('2026-08-20T10:00:00.000Z');
const paid = 100000; // ₹1000

// No partner → full refund
{
  const r = evaluateProjectCancellation({
    paidAmountPaise: paid,
    cancelledAt: new Date('2026-08-19T10:00:00.000Z'),
    projectStartDate: start,
    partnerAssigned: false,
    partnerReachedLocation: false,
    projectStatus: 'not_started',
    totalPlannedDays: 5,
    completedDayCount: 0,
    activeDayNumber: null,
    taskStatus: 'open',
  });
  assert.strictEqual(r.status, 'ALLOWED');
  assert.strictEqual(r.tier, 'no_partner');
  assert.strictEqual(r.settlement.refundAmountPaise, paid);
}

// Free window
{
  const r = evaluateProjectCancellation({
    paidAmountPaise: paid,
    cancelledAt: new Date('2026-08-18T10:00:00.000Z'),
    projectStartDate: start,
    partnerAssigned: true,
    partnerReachedLocation: false,
    projectStatus: 'not_started',
    totalPlannedDays: 5,
    completedDayCount: 0,
    activeDayNumber: null,
    taskStatus: 'assigned',
  });
  assert.strictEqual(r.status, 'ALLOWED');
  assert.strictEqual(r.tier, 'free');
  assert.strictEqual(r.settlement.refundAmountPaise, paid);
}

// Within 24h
{
  const r = evaluateProjectCancellation({
    paidAmountPaise: paid,
    cancelledAt: new Date('2026-08-20T00:00:00.000Z'),
    projectStartDate: start,
    partnerAssigned: true,
    partnerReachedLocation: false,
    projectStatus: 'not_started',
    totalPlannedDays: 5,
    completedDayCount: 0,
    activeDayNumber: null,
    taskStatus: 'assigned',
  });
  assert.strictEqual(r.status, 'ALLOWED');
  assert.strictEqual(r.tier, 'within_24h');
  assert.strictEqual(
    r.settlement.refundAmountPaise,
    paid - PROJECT_CANCELLATION_POLICY.WITHIN_24H_FEE_PAISE,
  );
}

// Mid-project 2/5 days
{
  assert.strictEqual(
    resolveProjectWorkDaysCounted({
      completedDayCount: 2,
      activeDayNumber: null,
      totalPlannedDays: 5,
    }),
    2,
  );
  const r = evaluateProjectCancellation({
    paidAmountPaise: paid,
    cancelledAt: new Date('2026-08-22T10:00:00.000Z'),
    projectStartDate: start,
    partnerAssigned: true,
    partnerReachedLocation: true,
    projectStatus: 'active',
    totalPlannedDays: 5,
    completedDayCount: 2,
    activeDayNumber: null,
    taskStatus: 'in_progress',
  });
  assert.strictEqual(r.status, 'ALLOWED');
  assert.strictEqual(r.tier, 'mid_project_proration');
  assert.strictEqual(r.workDaysCounted, 2);
  // work value = 2/5 * 100000 = 40000; admin fee min(19900, 5% of 100000=5000)=5000
  assert.strictEqual(r.settlement.workerCompensationPaise, 40000);
  assert.strictEqual(r.settlement.platformRetainedAmountPaise, 5000);
  assert.strictEqual(r.settlement.refundAmountPaise, 55000);
}

// Active day counts
{
  const r = evaluateProjectCancellation({
    paidAmountPaise: paid,
    cancelledAt: new Date('2026-08-22T10:00:00.000Z'),
    projectStartDate: start,
    partnerAssigned: true,
    partnerReachedLocation: true,
    projectStatus: 'active',
    totalPlannedDays: 5,
    completedDayCount: 1,
    activeDayNumber: 2,
    taskStatus: 'in_progress',
  });
  assert.strictEqual(r.workDaysCounted, 2);
  assert.strictEqual(r.status, 'ALLOWED');
}

// Terminal denied
{
  const r = evaluateProjectCancellation({
    paidAmountPaise: paid,
    cancelledAt: new Date('2026-08-25T10:00:00.000Z'),
    projectStartDate: start,
    partnerAssigned: true,
    partnerReachedLocation: true,
    projectStatus: 'completed',
    totalPlannedDays: 5,
    completedDayCount: 5,
    activeDayNumber: null,
    taskStatus: 'completed',
  });
  assert.strictEqual(r.status, 'DENIED');
  assert.strictEqual(r.tier, 'terminal');
}

console.log('projectCancellationPolicy.test.ts: all passed');
