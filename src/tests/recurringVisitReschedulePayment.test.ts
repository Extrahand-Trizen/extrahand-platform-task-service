/**
 * Recurring visit reschedule ↔ payment ownership (no database / payment-service required).
 * Rule: a held payment belongs to the first eligible visit in the resulting chronological
 * schedule (date, then start time; visitIndex only breaks ties).
 * Run: npx ts-node src/tests/recurringVisitReschedulePayment.test.ts
 */
import assert from 'assert';
import mongoose from 'mongoose';
import Task from '../models/Task';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import { RecurringVisitService } from '../services/RecurringVisitService';
import { PaymentClient } from '../services/PaymentClient';
import {
  compareRecurringVisitsBySchedule,
  resolveRecurringVisitPaymentOwner,
} from '../utils/recurringVisitPaymentOwner';
import { normalizeDateOnly } from '../utils/recurringVisitScheduleBuilder';
import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';

type StoredVisit = Record<string, unknown> & { visitId: string; updatedAt: Date };
type Escrow = Record<string, unknown> & { escrowId: string };

const parentId = new mongoose.Types.ObjectId();
const requesterProfileId = new mongoose.Types.ObjectId();
const taskerProfileId = new mongoose.Types.ObjectId();
const T0 = new Date('2026-06-01T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
// Reschedule validation is relative to "today", so fixtures sit a little in the future.
const BASE = normalizeDateOnly(new Date(Date.now() + 10 * DAY_MS));
const day = (offset: number) => new Date(BASE.getTime() + offset * DAY_MS);

// ── In-memory RecurringVisit store ───────────────────────────────────────────
let db = new Map<string, StoredVisit>();
let tick = 1;
let conflictOnce = new Set<string>();
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
  await new Promise((resolve) => setImmediate(resolve));
  const d = db.get(visitId);
  if (!d) return false;
  if (conflictOnce.delete(visitId)) return false;
  if ((expected?.getTime() ?? null) !== d.updatedAt.getTime()) return false;
  Object.assign(d, set, { updatedAt: new Date(T0.getTime() + tick++ * 1000) });
  for (const key of unset) delete d[key];
  return true;
};
repo.insertVisitsIfMissing = async () => undefined;
repo.listByParentAndVisitIds = async (_p: unknown, ids: string[]) =>
  ids.map((id) => db.get(id)).filter(Boolean).map((d) => ({ ...d }));
repo.upsertVisits = async () => ({ upserted: 0 });

// ── Escrows (payment-service) ────────────────────────────────────────────────
let escrows = new Map<string, Escrow>();
const reassignCalls: Array<Record<string, string>> = [];
const payment = PaymentClient as unknown as Record<string, unknown>;
payment.getEscrowByEscrowId = async (id: string) => {
  const e = escrows.get(id);
  return e ? { ...e, metadata: { ...(e.metadata as object) } } : null;
};
payment.getEscrowByTaskIdAndVisitId = async (taskId: string, visitId: string) => {
  const forVisit = [...escrows.values()].filter(
    (e) => e.taskId === taskId && (e.metadata as Record<string, unknown>)?.visitId === visitId,
  );
  return forVisit.find((e) => e.status === 'held') ?? forVisit[0] ?? null;
};
payment.getEscrowByTaskId = async () => null;
payment.reassignRecurringVisitEscrow = async (params: Record<string, string>) => {
  reassignCalls.push(params);
  const e = escrows.get(params.escrowId);
  if (!e) return { success: false, error: 'Escrow not found' };
  const meta = (e.metadata || {}) as Record<string, unknown>;
  if (meta.visitId && meta.visitId !== params.fromVisitId && meta.visitId !== params.toVisitId) {
    return { success: false, error: 'Escrow belongs to a different visit' };
  }
  e.metadata = { ...meta, visitId: params.toVisitId };
  return { success: true, escrow: e };
};

// ── Task documents ───────────────────────────────────────────────────────────
function makeTaskDoc(): Record<string, unknown> {
  return {
    _id: parentId,
    requesterId: requesterProfileId,
    assigneeId: taskerProfileId,
    category: 'cleaning',
    categorySlug: 'home-cleaning',
    recurringPlan: {
      visitStorage: 'collection',
      status: 'active',
      endType: 'end_on_date',
      budgetPerVisit: 500,
      taskerProfileId,
      taskerUid: 'tasker-uid',
    },
    schedule: [],
    markModified() {},
    isModified() {
      return false;
    },
    async save() {},
  };
}

type ChildDoc = Record<string, unknown> & { saves: number };
let childDocs = new Map<string, ChildDoc>();
function makeChild(id: mongoose.Types.ObjectId, date: Date): ChildDoc {
  const child: ChildDoc = {
    _id: id,
    status: 'assigned',
    scheduledDate: date,
    scheduledTimeStart: '09:00 AM',
    saves: 0,
  };
  child.save = async () => {
    child.saves += 1;
  };
  return child;
}

/** Mongoose-like query: awaitable, with select().lean() chains. */
function query<T>(doc: T) {
  return Object.assign(Promise.resolve(doc), {
    select: () => ({ lean: async () => doc }),
    lean: async () => doc,
  });
}
(Task as unknown as Record<string, unknown>).findById = (id: unknown) => {
  if (String(id) === String(parentId)) return query(makeTaskDoc());
  return query(childDocs.get(String(id)) ?? null);
};

// ── Service side effects ─────────────────────────────────────────────────────
const service = RecurringVisitService as unknown as Record<string, unknown>;
service.ensureMaterializedBuffer = async () => undefined;
service.resolveTaskRequesterUid = async () => 'poster-uid';
service.notifyTaskerRecurringVisitRescheduled = async () => undefined;
let childTasksCreated = 0;
service.ensureChildTaskForVisit = async (_task: unknown, v: ScheduleVisitRow) => {
  if (!v.childTaskId) {
    childTasksCreated += 1;
    v.childTaskId = new mongoose.Types.ObjectId();
  }
  return { _id: v.childTaskId };
};
let deletedChildIds: string[] = [];
service.deleteRecurringVisitChildTask = async (id: unknown) => {
  if (id) deletedChildIds.push(String(id));
};
let refundCalls = 0;
service.refundVisitPaymentOnCancel = async () => {
  refundCalls += 1;
};

// ── Fixtures ─────────────────────────────────────────────────────────────────
const vid = (index: number) => `visit-uuid-${index}`;
const C1 = new mongoose.Types.ObjectId();

function visit(index: number, date: Date, overrides: Partial<StoredVisit> = {}): StoredVisit {
  return {
    parentTaskId: parentId,
    visitId: vid(index),
    visitIndex: index,
    date,
    scheduledTimeStart: '09:00 AM',
    scheduledTimeEnd: '11:00 AM',
    status: 'scheduled',
    paymentStatus: 'not_required',
    amount: 500,
    assigneeId: taskerProfileId,
    assigneeUid: 'tasker-uid',
    childTaskId: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** Visit 1 paid with escrow E1 and an assigned child task. */
function paidFirstVisit(date = day(0), overrides: Partial<StoredVisit> = {}): StoredVisit {
  return visit(1, date, {
    status: 'confirmed',
    paymentStatus: 'held',
    escrowId: 'E1',
    paidAt: T0,
    childTaskId: C1,
    ...overrides,
  });
}

function escrow(id: string, visitId: string): Escrow {
  return {
    escrowId: id,
    taskId: String(parentId),
    status: 'held',
    paymentStatus: 'captured',
    taskAmount: '500',
    metadata: { visitId, parentTaskId: String(parentId), recurringPlan: true },
  };
}

function reset(visits: StoredVisit[]): void {
  db = new Map(visits.map((v) => [v.visitId, { ...v }]));
  escrows = new Map([['E1', escrow('E1', vid(1))]]);
  childDocs = new Map([[String(C1), makeChild(C1, day(0))]]);
  reassignCalls.length = 0;
  deletedChildIds = [];
  refundCalls = 0;
  childTasksCreated = 0;
  conflictOnce = new Set();
}

const reschedule = (visitId: string, newDate: Date, scheduledTimeStart?: string) =>
  RecurringVisitService.rescheduleVisit({
    taskId: String(parentId),
    visitId,
    requesterProfileId,
    newDate,
    scheduledTimeStart,
  });

function holdsE1(visitId: string): boolean {
  const v = db.get(visitId);
  return v?.status === 'confirmed' && v?.paymentStatus === 'held' && v?.escrowId === 'E1';
}
function isUnpaid(visitId: string): boolean {
  const v = db.get(visitId);
  return !v?.escrowId && !v?.paidAt && v?.paymentStatus !== 'held';
}
const escrowVisitId = () => (escrows.get('E1')?.metadata as Record<string, unknown>).visitId;
const sameDay = (a: unknown, b: Date) =>
  normalizeDateOnly(new Date(a as Date)).getTime() === b.getTime();

function assertTransferredFromV1To(targetIndex: number): void {
  const target = vid(targetIndex);
  assert.ok(holdsE1(target), `${target} should hold E1`);
  assert.ok(isUnpaid(vid(1)), 'Visit 1 must no longer hold the payment');
  assert.deepStrictEqual(
    reassignCalls.map((c) => [c.fromVisitId, c.toVisitId]),
    [[vid(1), target]],
  );
  assert.strictEqual(escrowVisitId(), target);
  assert.deepStrictEqual(deletedChildIds, [String(C1)], 'old child task removed once');
  assert.strictEqual(childTasksCreated, 1, 'exactly one child task for the new owner');
  assert.strictEqual(refundCalls, 0);
  const paidRows = [...db.values()].filter((v) => v.escrowId === 'E1');
  assert.strictEqual(paidRows.length, 1, 'E1 bound to exactly one visit');
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

const row = (index: number, date: Date, overrides: Partial<ScheduleVisitRow> = {}) =>
  ({ ...visit(index, date), ...overrides }) as unknown as ScheduleVisitRow;
const paidRow = (date: Date) =>
  row(1, date, { status: 'confirmed', paymentStatus: 'held', escrowId: 'E1', paidAt: T0 });

// ── Pure owner rule ──────────────────────────────────────────────────────────
test('Owner rule Ex1: V1 moved to Oct 6, V2 Oct 8 → V1 keeps payment', () => {
  const rows = [paidRow(day(0)), row(2, day(3))];
  assert.strictEqual(resolveRecurringVisitPaymentOwner(rows, { visitId: vid(1), date: day(1) })?.visitId, vid(1));
});

test('Owner rule Ex2: V1 moved after V2 → V2 owns payment', () => {
  const rows = [paidRow(day(0)), row(2, day(3))];
  assert.strictEqual(resolveRecurringVisitPaymentOwner(rows, { visitId: vid(1), date: day(4) })?.visitId, vid(2));
});

test('Owner rule Ex3: V1 moved after V2 and V3 → V2 owns payment', () => {
  const rows = [paidRow(day(0)), row(2, day(3)), row(3, day(7))];
  assert.strictEqual(resolveRecurringVisitPaymentOwner(rows, { visitId: vid(1), date: day(10) })?.visitId, vid(2));
});

test('Owner rule Ex4: date order beats visitIndex (V3 Oct 12 before V2 Oct 14)', () => {
  const rows = [paidRow(day(0)), row(2, day(9)), row(3, day(7))];
  assert.strictEqual(resolveRecurringVisitPaymentOwner(rows, { visitId: vid(1), date: day(8) })?.visitId, vid(3));
});

test('Owner rule: same date ordered by start time, then visitIndex', () => {
  const rows = [paidRow(day(0)), row(2, day(5), { scheduledTimeStart: '02:00 PM' })];
  assert.strictEqual(
    resolveRecurringVisitPaymentOwner(rows, { visitId: vid(1), date: day(5), scheduledTimeStart: '10:00 AM' })?.visitId,
    vid(1),
  );
  assert.strictEqual(
    resolveRecurringVisitPaymentOwner(rows, { visitId: vid(1), date: day(5), scheduledTimeStart: '04:00 PM' })?.visitId,
    vid(2),
  );
  const a = row(3, day(5), { scheduledTimeStart: '09:00 AM' });
  const b = row(2, day(5), { scheduledTimeStart: '09:00 AM' });
  assert.ok(compareRecurringVisitsBySchedule(b, a) < 0, 'visitIndex breaks exact ties');
});

test('Owner rule (Test 7): completed / cancelled / skipped / held visits are never selected', () => {
  const rows = [
    paidRow(day(0)),
    row(2, day(1), { status: 'completed' }),
    row(3, day(2), { status: 'cancelled' }),
    row(4, day(3), { status: 'skipped' }),
    row(5, day(4), { status: 'skipped_unpaid' }),
    row(6, day(5), { status: 'cancelled_late' }),
    row(7, day(6), { status: 'in_progress' }),
    row(8, day(7), { status: 'confirmed', paymentStatus: 'held', escrowId: 'E8', paidAt: T0 }),
    row(9, day(9)),
  ];
  assert.strictEqual(resolveRecurringVisitPaymentOwner(rows, { visitId: vid(1), date: day(10) })?.visitId, vid(9));
  const onlyClosed = rows.slice(0, 8);
  assert.strictEqual(
    resolveRecurringVisitPaymentOwner(onlyClosed, { visitId: vid(1), date: day(10) })?.visitId,
    vid(1),
    'with no eligible later visit, the rescheduled visit keeps its payment',
  );
});

// ── Service: rescheduleVisit end to end ──────────────────────────────────────
test('Test 1/5/6: rescheduled visit stays first → keeps payment, child task, no transfer/refund', async () => {
  reset([paidFirstVisit(), visit(2, day(3))]);
  await reschedule(vid(1), day(1), '10:00 AM');

  assert.ok(holdsE1(vid(1)), 'Visit 1 keeps E1');
  assert.ok(sameDay(db.get(vid(1))?.date, day(1)), 'Visit 1 moved to the new date');
  assert.strictEqual(db.get(vid(1))?.scheduledTimeStart, '10:00 AM');
  assert.strictEqual(String(db.get(vid(1))?.childTaskId), String(C1), 'same child task kept');
  assert.ok(isUnpaid(vid(2)), 'Visit 2 stays unpaid');
  assert.strictEqual(reassignCalls.length, 0, 'no payment transfer');
  assert.strictEqual(escrowVisitId(), vid(1));
  assert.strictEqual(refundCalls, 0, 'no refund');
  assert.deepStrictEqual(deletedChildIds, [], 'child task not deleted');
  assert.strictEqual(childTasksCreated, 0, 'no duplicate child task');
  assert.strictEqual(escrows.size, 1, 'no new payment');

  const child = childDocs.get(String(C1))!;
  assert.ok(sameDay(child.scheduledDate, day(1)), 'child task date updated');
  assert.strictEqual(child.scheduledTimeStart, '10:00 AM');
  assert.strictEqual(child.saves, 1);
});

test('Test 2: rescheduled visit becomes second → payment moves to Visit 2', async () => {
  reset([paidFirstVisit(), visit(2, day(3))]);
  await reschedule(vid(1), day(4));
  assertTransferredFromV1To(2);
  assert.ok(sameDay(db.get(vid(1))?.date, day(4)));
  assert.strictEqual(db.get(vid(1))?.status, 'scheduled');
});

test('Test 3: rescheduled visit becomes third → payment moves to Visit 2', async () => {
  reset([paidFirstVisit(), visit(2, day(3)), visit(3, day(7))]);
  await reschedule(vid(1), day(10));
  assertTransferredFromV1To(2);
  assert.ok(isUnpaid(vid(3)), 'Visit 3 stays unpaid');
});

test('Test 4: chronological order beats visitIndex → payment moves to Visit 3', async () => {
  reset([paidFirstVisit(), visit(2, day(9)), visit(3, day(7))]);
  await reschedule(vid(1), day(8));
  assertTransferredFromV1To(3);
  assert.ok(isUnpaid(vid(2)), 'Visit 2 (later by date) stays unpaid');
});

test('Test 5: last eligible visit rescheduled → keeps payment, no refund or reopen', async () => {
  reset([
    visit(0, day(-5), { status: 'completed', paymentStatus: 'released' }),
    paidFirstVisit(),
  ]);
  await reschedule(vid(1), day(6));
  assert.ok(holdsE1(vid(1)), 'Visit 1 keeps E1');
  assert.strictEqual(refundCalls, 0, 'no refund');
  assert.strictEqual(reassignCalls.length, 0);
  assert.deepStrictEqual(deletedChildIds, []);
  assert.strictEqual(db.get(vid(1))?.paymentStatus, 'held', 'not reopened for payment');
});

test('Test 7: terminal and completed visits are never selected as the new owner', async () => {
  reset([
    paidFirstVisit(),
    visit(2, day(1), { status: 'completed', paymentStatus: 'released' }),
    visit(3, day(2), { status: 'cancelled' }),
    visit(4, day(3), { status: 'skipped_unpaid' }),
    visit(5, day(5)),
  ]);
  await reschedule(vid(1), day(6));
  assertTransferredFromV1To(5);
  for (const i of [2, 3, 4]) {
    assert.ok(!db.get(vid(i))?.escrowId, `terminal visit ${i} must not receive the payment`);
  }
});

test('Another visit already holding its own payment is not a target', async () => {
  reset([
    paidFirstVisit(),
    visit(2, day(3), { status: 'confirmed', paymentStatus: 'held', escrowId: 'E2', paidAt: T0 }),
    visit(3, day(7)),
  ]);
  escrows.set('E2', escrow('E2', vid(2)));
  await reschedule(vid(1), day(5));
  assert.ok(holdsE1(vid(1)), 'Visit 1 is the first unpaid eligible visit and keeps E1');
  assert.strictEqual(db.get(vid(2))?.escrowId, 'E2');
  assert.ok(isUnpaid(vid(3)));
  assert.strictEqual(reassignCalls.length, 0);
});

test('Approved tasker reschedule request uses the same ownership rule', async () => {
  const request = { status: 'pending', newDate: day(4), requestedAt: T0 };
  reset([paidFirstVisit(day(0), { rescheduleRequest: request }), visit(2, day(3))]);
  await RecurringVisitService.respondVisitRescheduleRequest({
    taskId: String(parentId),
    visitId: vid(1),
    requesterProfileId,
    approved: true,
  });
  assertTransferredFromV1To(2);

  reset([paidFirstVisit(day(0), { rescheduleRequest: { ...request, newDate: day(1) } }), visit(2, day(3))]);
  await RecurringVisitService.respondVisitRescheduleRequest({
    taskId: String(parentId),
    visitId: vid(1),
    requesterProfileId,
    approved: true,
  });
  assert.ok(holdsE1(vid(1)), 'approved move that stays first keeps the payment');
  assert.strictEqual(reassignCalls.length, 0);
});

test('Write conflict after escrow re-tag: re-tag reverted, retry transfers exactly once', async () => {
  reset([paidFirstVisit(), visit(2, day(3))]);
  conflictOnce = new Set([vid(1), vid(2)]);
  await reschedule(vid(1), day(4));
  assert.ok(holdsE1(vid(2)), 'Visit 2 holds E1 after retry');
  assert.ok(isUnpaid(vid(1)));
  assert.strictEqual(escrowVisitId(), vid(2));
  assert.deepStrictEqual(
    reassignCalls.map((c) => [c.fromVisitId, c.toVisitId]),
    [
      [vid(1), vid(2)],
      [vid(2), vid(1)],
      [vid(1), vid(2)],
    ],
  );
  assert.strictEqual(childTasksCreated, 1);
  assert.strictEqual(refundCalls, 0);
});

const flushBackground = () => new Promise((resolve) => setTimeout(resolve, 20));

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      await flushBackground();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.error(`  ✗ ${name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(process.exitCode ?? 0);
})();
