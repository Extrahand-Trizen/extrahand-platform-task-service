/**
 * PUT /tasks/:id field allowlist (no database).
 * Run: npx ts-node src/tests/taskUpdateAllowlist.test.ts
 */
import assert from 'assert';
import { sanitizeRequesterTaskUpdate } from '../utils/taskUpdateAllowlist';

const openTask = { status: 'open', bookingSource: 'marketplace', budget: { amount: 500, type: 'fixed' } };

function testServerOwnedFieldsDropped() {
  const { update, dropped } = sanitizeRequesterTaskUpdate(openTask, {
    title: 'New title',
    status: 'completed',
    requesterId: 'x',
    assigneeId: 'y',
    assigneeUid: 'z',
    bookingSource: 'book_now',
    recurringPlan: { status: 'active', budgetPerVisit: 1 },
    'recurringPlan.budgetPerVisit': 1,
    schedule: [{ paymentStatus: 'held' }],
    parentTaskId: 'p',
    posterBudgetEditedViaFormOnce: false,
    $set: { status: 'completed' },
  });
  assert.deepStrictEqual(Object.keys(update), ['title']);
  for (const key of ['status', 'requesterId', 'assigneeId', 'recurringPlan', 'schedule', '$set', 'recurringPlan.budgetPerVisit']) {
    assert.ok(dropped.includes(key), `${key} must be dropped`);
  }
}

function testOperatorInjectionRejected() {
  assert.throws(
    () => sanitizeRequesterTaskUpdate(openTask, { location: { $set: { city: 'x' } } }),
    /Invalid value for location/,
  );
  assert.throws(
    () => sanitizeRequesterTaskUpdate(openTask, { pickDropDetails: { 'a.b': 1 } }),
    /Invalid value for pickDropDetails/,
  );
}

function testBudgetEditableWhileOpen() {
  const { update } = sanitizeRequesterTaskUpdate(openTask, { budget: { amount: 700, type: 'hourly', currency: 'USD', extra: 1 } });
  assert.deepStrictEqual(update.budget, { amount: 700, currency: 'INR', type: 'hourly' });
  const numeric = sanitizeRequesterTaskUpdate(openTask, { budget: '650' });
  assert.deepStrictEqual(numeric.update.budget, { amount: 650, currency: 'INR', type: 'fixed' });
  assert.throws(() => sanitizeRequesterTaskUpdate(openTask, { budget: { amount: -5 } }), /non-negative/);
}

function testBudgetLockedAfterAssignment() {
  const assigned = { ...openTask, status: 'assigned' };
  assert.throws(
    () => sanitizeRequesterTaskUpdate(assigned, { budget: { amount: 100 } }),
    /only be changed while the task is open/,
  );
  const unchanged = sanitizeRequesterTaskUpdate(assigned, { budget: { amount: 500 }, isNegotiable: true, title: 't' });
  assert.strictEqual(unchanged.update.budget, undefined);
  assert.strictEqual(unchanged.update.isNegotiable, undefined);
  assert.strictEqual(unchanged.update.title, 't');
}

function testBudgetLockedOnActiveRecurringPlan() {
  const plan = { ...openTask, recurringPlanStatus: 'active' };
  assert.throws(() => sanitizeRequesterTaskUpdate(plan, { budget: { amount: 1 } }), /only be changed/);
  const { update, dropped } = sanitizeRequesterTaskUpdate(plan, { recurring: { enabled: false } });
  assert.strictEqual(update.recurring, undefined);
  assert.ok(dropped.includes('recurring'));
}

function testBookNowPriceAndScheduleLocked() {
  const bookNow = {
    status: 'assigned',
    bookingSource: 'book_now',
    budget: { amount: 1499, type: 'fixed' },
    scheduledDate: new Date('2026-10-10T00:00:00.000Z'),
    scheduledTimeStart: '9:00 AM',
  };
  assert.throws(() => sanitizeRequesterTaskUpdate(bookNow, { budget: { amount: 1 } }), /Book Now prices/);
  assert.throws(
    () => sanitizeRequesterTaskUpdate(bookNow, { scheduledTimeStart: '6:00 PM' }),
    /Use Reschedule/,
  );
  const same = sanitizeRequesterTaskUpdate(bookNow, {
    budget: { amount: 1499 },
    scheduledDate: '2026-10-10',
    scheduledTimeStart: '9:00 AM',
    description: 'Gate code 1234',
  });
  assert.deepStrictEqual(Object.keys(same.update), ['description']);
}

function testRecurringSanitizedBeforeActivation() {
  const draft = { ...openTask, recurringPlanStatus: 'draft' };
  const { update } = sanitizeRequesterTaskUpdate(draft, {
    recurring: { enabled: true, frequency: 'weekly', startDate: '2026-10-10', endDate: '2026-12-10', occurrences: 999 },
  });
  assert.deepStrictEqual(update.recurring, {
    enabled: true,
    frequency: 'weekly',
    startDate: '2026-10-10',
    endDate: '2026-12-10',
  });
}

function testEditScreenPayloadsSurvive() {
  const payload = {
    title: 'Fix sink',
    description: 'Leaking',
    category: 'Plumbing',
    categoryLabel: 'Plumbing',
    categorySlug: 'plumbing',
    requirements: ['tools'],
    tags: ['urgent'],
    images: [],
    priority: 'normal',
    urgency: 'medium',
    location: { type: 'Point', coordinates: [78.3, 17.4], address: 'A', city: 'Hyderabad' },
    remotely: false,
    dateOption: 'on_date',
    scheduledDate: '2026-10-12',
    scheduledTimeStart: '10:00 AM',
    flexibility: 'flexible',
    budgetType: 'fixed',
    isNegotiable: false,
    budget: { amount: 600, currency: 'INR', type: 'fixed' },
  };
  const { update, dropped } = sanitizeRequesterTaskUpdate(openTask, payload);
  assert.deepStrictEqual(dropped, []);
  assert.strictEqual(Object.keys(update).length, Object.keys(payload).length);
}

testServerOwnedFieldsDropped();
testOperatorInjectionRejected();
testBudgetEditableWhileOpen();
testBudgetLockedAfterAssignment();
testBudgetLockedOnActiveRecurringPlan();
testBookNowPriceAndScheduleLocked();
testRecurringSanitizedBeforeActivation();
testEditScreenPayloadsSurvive();
console.log('taskUpdateAllowlist tests passed');
