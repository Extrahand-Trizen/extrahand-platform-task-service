/**
 * Book Now recurring core: patterns, lead time, horizon, pause, no auto-reactivation.
 * Run: npx ts-node src/tests/bookNowRecurringCore.test.ts
 */
import assert from 'assert';
import { BookNowEligibilityChecker } from '../book-now-adapter/BookNowEligibilityChecker';
import {
  BookNowRecurringErrors,
  computeSafePaymentDeadline,
  generateBookNowVisitSlots,
  nextPlanStateAfterUnpaid,
  canTransitionPlan,
  toVisitState,
} from '../recurring-core';

const checker = new BookNowEligibilityChecker();
const start = new Date('2026-06-01T03:30:00.000Z'); // 09:00 IST

const weeklyRule = {
  pattern: 'weekly' as const,
  startDateKey: '2026-06-08',
  scheduledTimeStart: '10:00 AM',
};

{
  const slots = generateBookNowVisitSlots(weeklyRule, start);
  assert.ok(slots.length >= 2, 'weekly should produce multiple future visits');
  assert.equal(slots[0].dateKey, '2026-06-08');
  const weekMs = slots[1].scheduledAt.getTime() - slots[0].scheduledAt.getTime();
  assert.equal(weekMs, 7 * 24 * 60 * 60 * 1000, 'weekly gap is 7 days');
}

{
  const slots = generateBookNowVisitSlots(
    {
      pattern: 'selected_weekdays',
      selectedWeekdays: [1, 3],
      startDateKey: '2026-06-08',
      scheduledTimeStart: '10:00 AM',
    },
    start,
  );
  assert.ok(slots.length > 2);
  const days = slots.slice(0, 4).map((s) => new Date(s.date).getUTCDay());
  assert.ok(days.every((d) => d === 1 || d === 3), 'selected weekdays only Mon/Wed');
}

{
  const slots = generateBookNowVisitSlots(
    { pattern: 'biweekly', startDateKey: '2026-06-08', scheduledTimeStart: '10:00 AM' },
    start,
  );
  const gap = slots[1].scheduledAt.getTime() - slots[0].scheduledAt.getTime();
  assert.equal(gap, 14 * 24 * 60 * 60 * 1000);
}

{
  let threw = false;
  try {
    generateBookNowVisitSlots(
      {
        pattern: 'weekly',
        startDateKey: '2026-06-01',
        endDateKey: '2026-06-01',
        scheduledTimeStart: '10:00 AM',
      },
      new Date('2026-06-01T03:30:00.000Z'),
    );
  } catch (error) {
    threw = error instanceof Error && error.message === BookNowRecurringErrors.FIRST_VISIT_LEAD;
  }
  assert.equal(threw, true, 'a single visit inside the 6h lead window is rejected');
}

{
  const tooSoon = new Date('2026-06-08T03:00:00.000Z');
  const slots = generateBookNowVisitSlots(
    { pattern: 'weekly', startDateKey: '2026-06-08', scheduledTimeStart: '9:00 AM', endDateKey: '2026-09-01' },
    tooSoon,
  );
  assert.ok(slots[0].dateKey > '2026-06-08' || slots[0].scheduledAt.getTime() >= tooSoon.getTime() + 6 * 60 * 60 * 1000);
}

{
  let threw = false;
  try {
    generateBookNowVisitSlots(
      { pattern: 'weekly', startDateKey: '2026-06-08', endDateKey: '2027-02-08', scheduledTimeStart: '10:00 AM' },
      start,
    );
  } catch (error) {
    threw = error instanceof Error && error.message === BookNowRecurringErrors.HORIZON;
  }
  assert.equal(threw, true, 'plans longer than 6 months are rejected');
}

{
  let threw = false;
  try {
    generateBookNowVisitSlots(
      { pattern: 'daily' as any, startDateKey: '2026-06-08', scheduledTimeStart: '10:00 AM' },
      start,
    );
  } catch (error) {
    threw = error instanceof Error && error.message === BookNowRecurringErrors.PATTERN_NOT_ALLOWED;
  }
  assert.equal(threw, true);
}

{
  let threw = false;
  try {
    checker.assertEligible({
      items: [{ skuSlug: 'hourly-helper', categorySlug: 'hourly-helper', name: 'Hourly', unitPrice: 199 }],
      fulfillmentType: 'scheduled',
      rule: weeklyRule,
      now: start,
    });
  } catch (error) {
    threw = error instanceof Error && error.message === BookNowRecurringErrors.HOURLY_NOT_ALLOWED;
  }
  assert.equal(threw, true);
}

{
  let threw = false;
  try {
    checker.assertEligible({
      items: [{ skuSlug: 'home-cleaning', categorySlug: 'cleaning', name: 'Clean', unitPrice: 499 }],
      fulfillmentType: 'instant',
      rule: weeklyRule,
      now: start,
    });
  } catch (error) {
    threw = error instanceof Error && error.message === BookNowRecurringErrors.INSTANT_NOT_ALLOWED;
  }
  assert.equal(threw, true);
}

assert.equal(canTransitionPlan('CANCELLED', 'ACTIVE'), false);
assert.equal(canTransitionPlan('ENDED', 'PAUSED'), false);
assert.equal(canTransitionPlan('ACTIVE', 'PAUSED'), true);
assert.equal(
  nextPlanStateAfterUnpaid({ planState: 'ACTIVE', consecutiveUnpaidCount: 2, pauseThreshold: 2 }),
  'PAUSED',
);
assert.equal(
  nextPlanStateAfterUnpaid({ planState: 'ENDED', consecutiveUnpaidCount: 2, pauseThreshold: 2 }),
  'ENDED',
);
assert.equal(
  nextPlanStateAfterUnpaid({ planState: 'CANCELLED', consecutiveUnpaidCount: 99, pauseThreshold: 2 }),
  'CANCELLED',
);

{
  const visitStart = new Date('2026-06-08T04:30:00.000Z');
  const now = new Date('2026-06-08T02:00:00.000Z');
  const deadline = computeSafePaymentDeadline(visitStart, now, {
    cutoffMinutes: 6 * 60,
    minWindowMinutes: 60,
  });
  assert.ok(deadline);
  assert.ok(deadline.getTime() <= visitStart.getTime());
  assert.ok(deadline.getTime() >= now.getTime() + 60 * 60 * 1000);
}

assert.equal(toVisitState('payment_pending'), 'PAYMENT_OPEN');
assert.equal(toVisitState('confirmed'), 'PAID');
assert.equal(toVisitState('skipped_unpaid'), 'UNPAID');

console.log('✅ bookNowRecurringCore.test.ts passed');
