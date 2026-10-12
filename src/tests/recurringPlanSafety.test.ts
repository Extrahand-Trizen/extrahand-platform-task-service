/**
 * Recurring plan safety (no database): payment deadlines are never in the past, started unpaid
 * visits are skipped instead of opened, and ended/cancelled plans are never reopened or paused.
 * Run: npx ts-node src/tests/recurringPlanSafety.test.ts
 */
import assert from 'assert';
import mongoose from 'mongoose';
import Task from '../models/Task';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import {
  expireStartedUnopenedVisits,
  getPaymentDeadline,
  RecurringVisitService,
  VISIT_EXPIRED_BEFORE_PAYMENT_REASON,
} from '../services/RecurringVisitService';
import {
  computeSafePaymentDeadline,
  istDateKey,
  parseClockLabelToMinutes,
  resolveVisitStartInstant,
  storedDateFromKey,
} from '../recurring-core/time';
import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';

const HOUR = 60 * 60 * 1000;
const parentId = new mongoose.Types.ObjectId();
const requesterProfileId = new mongoose.Types.ObjectId();
const taskerProfileId = new mongoose.Types.ObjectId();
const T0 = new Date('2026-06-01T08:00:00.000Z');

type StoredVisit = Record<string, unknown> & { visitId: string; updatedAt: Date };
let db = new Map<string, StoredVisit>();
let tick = 1;
const repo = RecurringVisitRepository as unknown as Record<string, unknown>;
repo.listByParent = async () => [...db.values()].map((d) => ({ ...d }));
repo.findByParentAndVisitId = async (_p: unknown, visitId: string) => {
  const d = db.get(visitId);
  return d ? { ...d } : null;
};
repo.updateVisitIfUnchanged = async (
  _parent: unknown,
  visitId: string,
  expected: Date | null,
  set: Record<string, unknown>,
  unset: string[],
) => {
  const d = db.get(visitId);
  if (!d) return false;
  if ((expected?.getTime() ?? null) !== d.updatedAt.getTime()) return false;
  Object.assign(d, set, { updatedAt: new Date(T0.getTime() + tick++ * 1000) });
  for (const key of unset) delete d[key];
  return true;
};
repo.updateVisit = async (_p: unknown, visitId: string, update: { $set?: Record<string, unknown> }) => {
  const d = db.get(visitId);
  if (!d) return null;
  Object.assign(d, update.$set || {}, { updatedAt: new Date(T0.getTime() + tick++ * 1000) });
  return { ...d };
};
repo.insertVisitsIfMissing = async () => undefined;
repo.listByParentAndVisitIds = async (_p: unknown, ids: string[]) =>
  ids.map((id) => db.get(id)).filter(Boolean).map((d) => ({ ...d }));
repo.upsertVisits = async () => ({ upserted: 0 });

let planDoc: Record<string, unknown>;
function makeTaskDoc(plan: Record<string, unknown>, taskStatus = 'assigned'): Record<string, unknown> {
  return {
    _id: parentId,
    requesterId: requesterProfileId,
    assigneeId: taskerProfileId,
    status: taskStatus,
    title: 'Daily cleaning',
    recurring: { enabled: true },
    recurringPlan: {
      visitStorage: 'collection',
      status: 'active',
      endType: 'end_on_date',
      budgetPerVisit: 500,
      taskerProfileId,
      taskerUid: 'tasker-uid',
      consecutiveUnpaidCount: 0,
      ...plan,
    },
    schedule: [],
    markModified() {},
    isModified() {
      return false;
    },
    async save() {},
  };
}
function query<T>(doc: T) {
  return Object.assign(Promise.resolve(doc), {
    select: () => ({ lean: async () => doc }),
    lean: async () => doc,
  });
}
const TaskModel = Task as unknown as Record<string, unknown>;
TaskModel.findById = (id: unknown) => query(String(id) === String(parentId) ? planDoc : null);
function chain<T>(result: T): unknown {
  const q = Object.assign(Promise.resolve(result), {
    lean: async () => result,
    exec: async () => result,
  });
  for (const method of ['select', 'sort', 'limit', 'skip', 'populate']) {
    (q as unknown as Record<string, unknown>)[method] = () => q;
  }
  return q;
}
TaskModel.find = () => chain([]);
TaskModel.findOne = () => chain(null);

const service = RecurringVisitService as unknown as Record<string, unknown>;
service.ensureMaterializedBuffer = async () => undefined;
service.rebalancePaymentPendingVisits = async () => undefined;
service.sanitizeOrphanedScheduleChildReferences = async () => false;
service.ensureChildTaskForVisit = async (_task: unknown, v: ScheduleVisitRow) => {
  if (!v.childTaskId) v.childTaskId = new mongoose.Types.ObjectId();
  return { _id: v.childTaskId };
};

function visitOn(index: number, dateKey: string, overrides: Partial<StoredVisit> = {}): StoredVisit {
  return {
    parentTaskId: parentId,
    visitId: `v-${index}`,
    visitIndex: index,
    date: storedDateFromKey(dateKey),
    scheduledTimeStart: '9:00 AM',
    status: 'scheduled',
    paymentStatus: 'not_required',
    amount: 500,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

const dayKey = (offsetDays: number) => istDateKey(new Date(Date.now() + offsetDays * 24 * HOUR));

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test('IST start: "9:00 AM" on 2026-10-10 is 03:30 UTC regardless of server TZ', () => {
  const start = resolveVisitStartInstant(storedDateFromKey('2026-10-10'), '9:00 AM');
  assert.strictEqual(start?.toISOString(), '2026-10-10T03:30:00.000Z');
  assert.strictEqual(parseClockLabelToMinutes('12:00 AM'), 0);
  assert.strictEqual(parseClockLabelToMinutes('12:30 PM'), 750);
  assert.strictEqual(parseClockLabelToMinutes('18:45'), 1125);
  assert.strictEqual(parseClockLabelToMinutes('25:00'), null);
});

test('Safe deadline: cutoff applies when far away; minimum window when close; never after start', () => {
  const now = new Date('2026-10-01T06:00:00.000Z');
  const far = new Date(now.getTime() + 72 * HOUR);
  assert.strictEqual(
    computeSafePaymentDeadline(far, now, { cutoffMinutes: 6 * 60, minWindowMinutes: 60 })?.toISOString(),
    new Date(far.getTime() - 6 * HOUR).toISOString(),
  );
  const close = new Date(now.getTime() + 5 * HOUR);
  assert.strictEqual(
    computeSafePaymentDeadline(close, now, { cutoffMinutes: 6 * 60, minWindowMinutes: 60 })?.toISOString(),
    new Date(now.getTime() + HOUR).toISOString(),
  );
  const veryClose = new Date(now.getTime() + 30 * 60 * 1000);
  assert.strictEqual(
    computeSafePaymentDeadline(veryClose, now, { cutoffMinutes: 6 * 60, minWindowMinutes: 60 })?.toISOString(),
    veryClose.toISOString(),
  );
  assert.strictEqual(computeSafePaymentDeadline(new Date(now.getTime() - 1), now, { cutoffMinutes: 0, minWindowMinutes: 60 }), null);
});

test('Post Work deadline for a daily plan is never in the past', () => {
  const now = new Date();
  for (const offset of [0, 1, 2, 5]) {
    const deadline = getPaymentDeadline({ date: storedDateFromKey(dayKey(offset)), scheduledTimeStart: '9:00 AM' }, null, now);
    assert.ok(deadline.getTime() > now.getTime(), `day +${offset}: deadline must be in the future`);
  }
  const start = resolveVisitStartInstant(storedDateFromKey(dayKey(5)), '9:00 AM')!;
  const deadline = getPaymentDeadline({ date: storedDateFromKey(dayKey(5)), scheduledTimeStart: '9:00 AM' }, null, now);
  assert.strictEqual(deadline.getTime(), start.getTime() - 24 * HOUR, 'far visits keep the 24h cutoff');
});

test('Started unpaid visits are skipped (not unpaid); paid and future visits are untouched', () => {
  const now = new Date();
  const rows = [
    visitOn(1, dayKey(-1)),
    visitOn(2, dayKey(-1), { status: 'confirmed', paymentStatus: 'held', escrowId: 'E1', paidAt: T0 }),
    visitOn(3, dayKey(2)),
  ] as unknown as ScheduleVisitRow[];
  assert.strictEqual(expireStartedUnopenedVisits(rows, null, now), 1);
  assert.strictEqual(rows[0].status, 'skipped');
  assert.strictEqual(rows[0].skipReason, VISIT_EXPIRED_BEFORE_PAYMENT_REASON);
  assert.strictEqual(rows[1].status, 'confirmed');
  assert.strictEqual(rows[2].status, 'scheduled');
});

test('Daily plan: open next payment skips yesterday and opens a future visit with a future deadline', async () => {
  planDoc = makeTaskDoc({});
  db = new Map(
    [visitOn(1, dayKey(-1)), visitOn(2, dayKey(2)), visitOn(3, dayKey(3))].map((v) => [v.visitId, v]),
  );
  const opened = await RecurringVisitService.openNextVisitForPayment(String(parentId), { skipReconcile: true });
  assert.ok(opened, 'a visit must be opened');
  assert.strictEqual(opened!.visitId, 'v-2');
  assert.ok(new Date(opened!.paymentDeadline).getTime() > Date.now());
  assert.strictEqual(db.get('v-1')!.status, 'skipped');
  assert.strictEqual(db.get('v-2')!.status, 'payment_pending');
  assert.strictEqual((planDoc.recurringPlan as Record<string, unknown>).consecutiveUnpaidCount, 0);
});

test('Unpaid visit on an ended plan never pauses (or reactivates) the plan', async () => {
  planDoc = makeTaskDoc({ status: 'ended', pausedReason: 'Customer cancelled recurring plan', consecutiveUnpaidCount: 1 }, 'cancelled');
  db = new Map([visitOn(1, dayKey(1), { status: 'payment_pending', paymentStatus: 'pending', paymentDeadline: new Date(Date.now() - 1000) })].map((v) => [v.visitId, v]));
  await RecurringVisitService.markVisitUnpaid(String(parentId), 'v-1');
  const plan = planDoc.recurringPlan as Record<string, unknown>;
  assert.strictEqual(plan.status, 'ended');
  assert.strictEqual(plan.consecutiveUnpaidCount, 1);
  assert.strictEqual(db.get('v-1')!.status, 'skipped_unpaid');
});

test('Two unpaid visits on an active plan still pause it', async () => {
  planDoc = makeTaskDoc({ consecutiveUnpaidCount: 1 });
  db = new Map([visitOn(1, dayKey(1), { status: 'payment_pending', paymentStatus: 'pending' })].map((v) => [v.visitId, v]));
  await RecurringVisitService.markVisitUnpaid(String(parentId), 'v-1');
  const plan = planDoc.recurringPlan as Record<string, unknown>;
  assert.strictEqual(plan.status, 'paused');
  assert.strictEqual(plan.pausedReason, 'consecutive_unpaid');
});

const reconcileOnce = (id: string) =>
  (service.reconcilePlanStateOnce as (taskId: string) => Promise<void>).call(RecurringVisitService, id);

test('Reconcile never reopens a plan the customer ended', async () => {
  planDoc = makeTaskDoc({ status: 'ended', endType: 'until_cancelled', pausedReason: 'Customer cancelled recurring plan' }, 'cancelled');
  db = new Map(
    [visitOn(1, dayKey(3), { status: 'cancelled' }), visitOn(2, dayKey(4), { status: 'cancelled' })].map((v) => [v.visitId, v]),
  );
  await reconcileOnce(String(parentId));
  assert.strictEqual((planDoc.recurringPlan as Record<string, unknown>).status, 'ended');
  assert.strictEqual(planDoc.status, 'cancelled');
  assert.strictEqual(db.get('v-1')!.status, 'cancelled');
  assert.strictEqual(db.get('v-2')!.status, 'cancelled');
});

test('Reconcile never reopens an ended plan whose work was cancelled, even if closed automatically', async () => {
  planDoc = makeTaskDoc({ status: 'ended', endType: 'until_cancelled', pausedReason: 'all_visits_closed' }, 'cancelled');
  db = new Map([visitOn(1, dayKey(3), { status: 'cancelled' })].map((v) => [v.visitId, v]));
  await reconcileOnce(String(parentId));
  assert.strictEqual((planDoc.recurringPlan as Record<string, unknown>).status, 'ended');
});

test('Reconcile still repairs an automatically closed plan with visits left', async () => {
  planDoc = makeTaskDoc({ status: 'ended', endType: 'until_cancelled', pausedReason: 'all_visits_closed' }, 'completed');
  db = new Map([visitOn(1, dayKey(3))].map((v) => [v.visitId, v]));
  await reconcileOnce(String(parentId));
  assert.strictEqual((planDoc.recurringPlan as Record<string, unknown>).status, 'active');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(error);
    }
  }
  if (failed > 0) {
    console.error(`${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`recurringPlanSafety: ${tests.length} tests passed`);
  process.exit(0);
})();
