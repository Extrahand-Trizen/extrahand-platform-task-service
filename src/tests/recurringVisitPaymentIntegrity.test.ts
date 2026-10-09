/**
 * Recurring visit payment integrity (no database / payment-service required):
 * refunded payments are never active, lookups are visit-scoped (no "newest payment for the
 * Work" fallback) and refunded payments are never moved by a reschedule.
 * Run: npx ts-node src/tests/recurringVisitPaymentIntegrity.test.ts
 */
import assert from 'assert';
import mongoose from 'mongoose';
import Task from '../models/Task';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import { RecurringVisitService } from '../services/RecurringVisitService';
import { PaymentClient } from '../services/PaymentClient';
import {
  evaluateVisitEscrowBinding,
  isEscrowRecordHeld,
  isEscrowRecordPaid,
} from '../services/recurringVisitPaymentBinding';
import {
  resolveRecurringVisitPaymentOwner,
  visitRowHasHeldPayment,
} from '../utils/recurringVisitPaymentOwner';
import { normalizeDateOnly } from '../utils/recurringVisitScheduleBuilder';
import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';

type StoredVisit = Record<string, unknown> & { visitId: string; updatedAt: Date };
type Escrow = Record<string, unknown> & { escrowId: string; createdAt: Date };

const parentId = new mongoose.Types.ObjectId();
const requesterProfileId = new mongoose.Types.ObjectId();
const taskerProfileId = new mongoose.Types.ObjectId();
const T0 = new Date('2026-06-01T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = normalizeDateOnly(new Date(Date.now() + 10 * DAY_MS));
const day = (offset: number) => new Date(BASE.getTime() + offset * DAY_MS);
const vid = (index: number) => `visit-uuid-${index}`;

// ── In-memory RecurringVisit store ───────────────────────────────────────────
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
repo.updateVisit = async (_parent: unknown, visitId: string, update: { $set?: Record<string, unknown> }) => {
  const d = db.get(visitId);
  if (!d) return null;
  Object.assign(d, update.$set || {}, { updatedAt: new Date(T0.getTime() + tick++ * 1000) });
  return { ...d };
};
repo.insertVisitsIfMissing = async () => undefined;
repo.listByParentAndVisitIds = async (_p: unknown, ids: string[]) =>
  ids.map((id) => db.get(id)).filter(Boolean).map((d) => ({ ...d }));
repo.upsertVisits = async () => ({ upserted: 0 });

// ── Escrows: mirrors payment-service lookups (paid escrow for the visit first, then newest) ──
let escrows = new Map<string, Escrow>();
let taskLevelEscrowId: string | null = null;
const reassignCalls: Array<Record<string, string>> = [];
const cancelCalls: Array<Record<string, unknown>> = [];
const payment = PaymentClient as unknown as Record<string, unknown>;
const copy = (e: Escrow) => ({ ...e, metadata: { ...(e.metadata as object) } });
const isServicePaid = (e: Escrow) =>
  ['held', 'released'].includes(String(e.status)) ||
  (['captured', 'authorized'].includes(String(e.paymentStatus)) &&
    !['refunded', 'cancelled'].includes(String(e.status)));
payment.getEscrowByEscrowId = async (id: string) => {
  const e = escrows.get(id);
  return e ? copy(e) : null;
};
payment.getEscrowByTaskIdAndVisitId = async (taskId: string, visitId: string) => {
  const forVisit = [...escrows.values()]
    .filter((e) => e.taskId === taskId && (e.metadata as Record<string, unknown>)?.visitId === visitId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const found = forVisit.find(isServicePaid) ?? forVisit[0];
  return found ? copy(found) : null;
};
payment.getEscrowByTaskId = async () => {
  const e = taskLevelEscrowId ? escrows.get(taskLevelEscrowId) : null;
  return e ? copy(e) : null;
};
payment.reassignRecurringVisitEscrow = async (params: Record<string, string>) => {
  reassignCalls.push(params);
  const e = escrows.get(params.escrowId);
  if (!e) return { success: false, error: 'Escrow not found' };
  e.metadata = { ...(e.metadata as object), visitId: params.toVisitId };
  return { success: true, escrow: e };
};
payment.cancelPaymentForTask = async (params: Record<string, unknown>) => {
  cancelCalls.push(params);
  const e = params.escrowId ? escrows.get(String(params.escrowId)) : null;
  if (e) e.status = 'refunded';
  return { success: true, cancelled: true };
};

// ── Task documents ───────────────────────────────────────────────────────────
function makeTaskDoc(): Record<string, unknown> {
  return {
    _id: parentId,
    requesterId: requesterProfileId,
    assigneeId: taskerProfileId,
    category: 'cleaning',
    categorySlug: 'home-cleaning',
    title: 'Weekly cleaning',
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
function query<T>(doc: T) {
  return Object.assign(Promise.resolve(doc), {
    select: () => ({ lean: async () => doc }),
    lean: async () => doc,
  });
}
(Task as unknown as Record<string, unknown>).findById = (id: unknown) =>
  query(String(id) === String(parentId) ? makeTaskDoc() : null);

const service = RecurringVisitService as unknown as Record<string, unknown>;
service.ensureMaterializedBuffer = async () => undefined;
service.resolveTaskRequesterUid = async () => 'poster-uid';
service.notifyTaskerRecurringVisitRescheduled = async () => undefined;
service.ensureChildTaskForVisit = async (_task: unknown, v: ScheduleVisitRow) => {
  if (!v.childTaskId) v.childTaskId = new mongoose.Types.ObjectId();
  return { _id: v.childTaskId };
};
service.deleteRecurringVisitChildTask = async () => undefined;

// ── Fixtures ─────────────────────────────────────────────────────────────────
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
const paidVisit = (index: number, date: Date, escrowId: string, overrides: Partial<StoredVisit> = {}) =>
  visit(index, date, {
    status: 'confirmed',
    paymentStatus: 'held',
    escrowId,
    paidAt: T0,
    ...overrides,
  });

function escrow(id: string, visitId: string, overrides: Partial<Escrow> = {}): Escrow {
  return {
    escrowId: id,
    taskId: String(parentId),
    posterUid: 'poster-uid',
    status: 'held',
    paymentStatus: 'captured',
    taskAmount: '500',
    createdAt: T0,
    metadata: { visitId, parentTaskId: String(parentId), recurringPlan: true, visitBudgetRupees: 500 },
    ...overrides,
  };
}
const refunded = (id: string, visitId: string, overrides: Partial<Escrow> = {}) =>
  escrow(id, visitId, { status: 'refunded', paymentStatus: 'captured', ...overrides });

function reset(visits: StoredVisit[], escrowList: Escrow[]): void {
  db = new Map(visits.map((v) => [v.visitId, { ...v }]));
  escrows = new Map(escrowList.map((e) => [e.escrowId, { ...e }]));
  taskLevelEscrowId = null;
  reassignCalls.length = 0;
  cancelCalls.length = 0;
}

const reschedule = (visitId: string, newDate: Date) =>
  RecurringVisitService.rescheduleVisit({
    taskId: String(parentId),
    visitId,
    requesterProfileId,
    newDate,
  });

const cancelRefund = (visitId: string) =>
  RecurringVisitService.refundVisitPaymentOnCancel({
    planTask: makeTaskDoc() as never,
    visit: { ...db.get(visitId)! } as unknown as ScheduleVisitRow,
    cancelledBy: 'poster',
    requesterUid: 'poster-uid',
  });

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

// ── A: refunded payments are never active ────────────────────────────────────
test('A: refunded escrow (status refunded, paymentStatus captured) is not paid, held or bindable', () => {
  const e = refunded('E1', vid(1));
  assert.strictEqual(isEscrowRecordPaid(e), false);
  assert.strictEqual(isEscrowRecordHeld(e), false);
  assert.strictEqual(isEscrowRecordPaid({ status: 'cancelled', paymentStatus: 'captured' }), false);
  assert.strictEqual(isEscrowRecordPaid({ status: 'cancelled', paymentStatus: 'failed' }), false);
  assert.strictEqual(isEscrowRecordPaid({ status: 'held', paymentStatus: 'captured' }), true);
  assert.strictEqual(isEscrowRecordHeld({ status: 'released', paymentStatus: 'captured' }), false);
  const binding = evaluateVisitEscrowBinding({
    escrow: e,
    parentTaskId: String(parentId),
    visitId: vid(1),
    rows: [],
  });
  assert.ok(!binding.ok && binding.reason === 'not_paid');
});

test('A: visit row with a refunded payment does not hold a payment and is a valid owner target', () => {
  const refundedRow = paidVisit(2, day(3), 'E2', { paymentStatus: 'refunded' }) as unknown as ScheduleVisitRow;
  assert.strictEqual(visitRowHasHeldPayment(refundedRow), false);
  const heldRow = paidVisit(1, day(0), 'E1') as unknown as ScheduleVisitRow;
  assert.strictEqual(visitRowHasHeldPayment(heldRow), true);
});

// ── B: refunded payment is never re-tagged on reschedule ─────────────────────
test('B: visit row says held but escrow is refunded → reschedule does not move it', async () => {
  reset([paidVisit(1, day(0), 'E1'), visit(2, day(3))], [refunded('E1', vid(1))]);
  await reschedule(vid(1), day(5));
  assert.strictEqual(reassignCalls.length, 0, 'no re-tag of a refunded payment');
  assert.ok(!db.get(vid(2))?.escrowId, 'Visit 2 does not receive the refunded payment');
  assert.strictEqual((escrows.get('E1')!.metadata as Record<string, unknown>).visitId, vid(1));
});

test('B: visit row already marked refunded → reschedule does not move the payment', async () => {
  reset(
    [paidVisit(1, day(0), 'E1', { paymentStatus: 'refunded' }), visit(2, day(3))],
    [refunded('E1', vid(1))],
  );
  await reschedule(vid(1), day(5));
  assert.strictEqual(reassignCalls.length, 0);
  assert.ok(!db.get(vid(2))?.escrowId);
});

test('B: released payment is never moved to another visit', async () => {
  reset(
    [paidVisit(1, day(0), 'E1'), visit(2, day(3))],
    [escrow('E1', vid(1), { status: 'released' })],
  );
  await reschedule(vid(1), day(5));
  assert.strictEqual(reassignCalls.length, 0);
  assert.ok(!db.get(vid(2))?.escrowId);
});

// ── G/H/I: visit-scoped lookup ───────────────────────────────────────────────
test('G: operation on Visit 2 selects E2, never Visit 1 payment E1', async () => {
  reset(
    [paidVisit(1, day(0), 'E1'), paidVisit(2, day(3), 'E2')],
    [escrow('E1', vid(1)), escrow('E2', vid(2), { createdAt: new Date(T0.getTime() - 1000) })],
  );
  taskLevelEscrowId = 'E1';
  const result = await cancelRefund(vid(2));
  assert.strictEqual(result.refunded, true);
  assert.deepStrictEqual(cancelCalls.map((c) => c.escrowId), ['E2']);
  assert.strictEqual(cancelCalls[0].taskId, undefined, 'never cancelled by Work id');
  assert.strictEqual(escrows.get('E1')!.status, 'held', 'Visit 1 payment untouched');
});

test('H: no visit-tagged payment → no fallback to the newest Work payment', async () => {
  // Visit 2 row claims a held payment but has no escrow id; the Work's newest payment is E1 (Visit 1).
  reset(
    [paidVisit(1, day(0), 'E1'), visit(2, day(3), { status: 'confirmed', paymentStatus: 'held' })],
    [escrow('E1', vid(1))],
  );
  taskLevelEscrowId = 'E1';
  const result = await cancelRefund(vid(2));
  assert.strictEqual(result.refunded, false);
  assert.ok(result.error, 'reports the missing visit payment instead of refunding another visit');
  assert.strictEqual(cancelCalls.length, 0, 'E1 is never refunded for Visit 2');
  assert.notStrictEqual(db.get(vid(2))?.paymentStatus, 'refunded');

  // Untagged legacy payment on the Work is not attributed to an unpaid visit either.
  reset([visit(2, day(3))], [escrow('E9', '', { metadata: {} })]);
  taskLevelEscrowId = 'E9';
  const skipped = await cancelRefund(vid(2));
  assert.strictEqual(skipped.refunded, false);
  assert.strictEqual(cancelCalls.length, 0);
});

test('I: refunded E1 (newer) and active E2 both on Visit 1 → E2 is selected', async () => {
  reset(
    [paidVisit(1, day(0), 'E2')],
    [
      refunded('E1', vid(1), { createdAt: new Date(T0.getTime() + 60_000) }),
      escrow('E2', vid(1)),
    ],
  );
  const result = await cancelRefund(vid(1));
  assert.strictEqual(result.refunded, true);
  assert.deepStrictEqual(cancelCalls.map((c) => c.escrowId), ['E2']);
});

test('Refund failure does not mark the visit refunded', async () => {
  reset([paidVisit(1, day(0), 'E1')], [escrow('E1', vid(1))]);
  const original = payment.cancelPaymentForTask;
  payment.cancelPaymentForTask = async () => ({ success: false, error: 'Razorpay unavailable' });
  try {
    const result = await cancelRefund(vid(1));
    assert.strictEqual(result.refunded, false);
    assert.strictEqual(db.get(vid(1))?.paymentStatus, 'held');
  } finally {
    payment.cancelPaymentForTask = original;
  }
});

test('Owner rule ignores refunded rows as payment holders but never selects closed visits', () => {
  const rows = [
    paidVisit(1, day(0), 'E1'),
    paidVisit(2, day(3), 'E2', { status: 'cancelled', paymentStatus: 'refunded' }),
    visit(3, day(7)),
  ] as unknown as ScheduleVisitRow[];
  assert.strictEqual(resolveRecurringVisitPaymentOwner(rows, { visitId: vid(1), date: day(10) })?.visitId, vid(3));
});

// ── Refund sync from payment-service ─────────────────────────────────────────
service.notifyTaskerRecurringVisitPaymentConfirmed = async () => undefined;
const refundSync = (visitId: string, escrowId: string, parentTaskId = String(parentId)) =>
  RecurringVisitService.markVisitPaymentRefundedFromPaymentService({
    parentTaskId,
    visitId,
    escrowId,
    eventId: `recurring_visit_refund_sync_${escrowId}`,
  });

test('Refund sync F: refund of E1 marks only Visit 1 refunded; Visit 2 keeps its payment', async () => {
  reset(
    [paidVisit(1, day(0), 'E1'), paidVisit(2, day(3), 'E2')],
    [refunded('E1', vid(1)), escrow('E2', vid(2))],
  );
  const v2Before = { ...db.get(vid(2))! };
  const result = await refundSync(vid(1), 'E1');
  assert.strictEqual(result.updated, true);
  assert.strictEqual(db.get(vid(1))?.paymentStatus, 'refunded');
  assert.strictEqual(visitRowHasHeldPayment(db.get(vid(1)) as unknown as ScheduleVisitRow), false);
  assert.deepStrictEqual(db.get(vid(2)), v2Before, 'Visit 2 untouched');
  assert.strictEqual(cancelCalls.length, 0, 'no refund is issued from task-service');
});

test('Refund sync C/N: repeated and concurrent callbacks change the visit once', async () => {
  reset([paidVisit(1, day(0), 'E1')], [refunded('E1', vid(1))]);
  const results = await Promise.all([refundSync(vid(1), 'E1'), refundSync(vid(1), 'E1'), refundSync(vid(1), 'E1')]);
  assert.strictEqual(results.filter((r) => r.updated).length, 1);
  assert.strictEqual(db.get(vid(1))?.paymentStatus, 'refunded');
  const updatedAt = db.get(vid(1))!.updatedAt.getTime();
  const again = await refundSync(vid(1), 'E1');
  assert.strictEqual(again.updated, false);
  assert.strictEqual(again.reason, 'already_refunded');
  assert.strictEqual(db.get(vid(1))!.updatedAt.getTime(), updatedAt, 'no further writes');
});

test('Refund sync H: refund of a duplicate payment never bound to the visit changes nothing', async () => {
  reset([paidVisit(1, day(0), 'EA')], [escrow('EA', vid(1)), refunded('EB', vid(1))]);
  const before = { ...db.get(vid(1))! };
  for (let i = 0; i < 2; i += 1) {
    const result = await refundSync(vid(1), 'EB');
    assert.strictEqual(result.updated, false);
    assert.strictEqual(result.reason, 'payment_not_bound_to_visit');
  }
  assert.deepStrictEqual(db.get(vid(1)), before, 'Payment A stays the visit payment');
});

test('Refund sync G: a refunded visit becomes payable again and a replacement payment is bound', async () => {
  reset([paidVisit(1, day(0), 'E1')], [refunded('E1', vid(1))]);
  const quote = () =>
    RecurringVisitService.quoteVisitPayment({ parentTaskId: String(parentId), visitId: vid(1), posterUid: 'poster-uid' });
  await refundSync(vid(1), 'E1');
  assert.strictEqual((await quote()).amount, 500, 'visit can be paid again');

  // Replacement already captured and held for the same visit (its capture callback was lost).
  reset(
    [paidVisit(1, day(0), 'E1')],
    [refunded('E1', vid(1)), escrow('E2', vid(1), { createdAt: new Date(T0.getTime() + 60_000) })],
  );
  const result = await refundSync(vid(1), 'E1');
  assert.strictEqual(result.replacementEscrowId, 'E2');
  assert.strictEqual(db.get(vid(1))?.escrowId, 'E2');
  assert.strictEqual(db.get(vid(1))?.paymentStatus, 'held');
  assert.strictEqual(db.get(vid(1))?.status, 'confirmed');
  await assert.rejects(quote(), /already been paid/);

  // The late refund event for E1 is now a no-op.
  const late = await refundSync(vid(1), 'E1');
  assert.strictEqual(late.reason, 'payment_not_bound_to_visit');
  assert.strictEqual(db.get(vid(1))?.escrowId, 'E2');
});

test('Refund sync: unverifiable, foreign or unrefunded payments are rejected; paid-out visits untouched', async () => {
  reset([paidVisit(1, day(0), 'E1'), paidVisit(2, day(3), 'E2')], [escrow('E1', vid(1)), refunded('E2', vid(2))]);
  await assert.rejects(refundSync(vid(1), 'E1'), /not refunded/);
  await assert.rejects(refundSync(vid(1), 'E2'), /does not belong/);
  await assert.rejects(refundSync(vid(1), 'missing-escrow'), /could not be verified/);
  await assert.rejects(refundSync(vid(1), 'E1', 'not-an-object-id'), /Task not found/);
  assert.strictEqual(db.get(vid(1))?.paymentStatus, 'held');
  assert.strictEqual(db.get(vid(2))?.paymentStatus, 'held');

  reset([paidVisit(1, day(0), 'E1', { paymentStatus: 'released' })], [refunded('E1', vid(1))]);
  const paidOut = await refundSync(vid(1), 'E1');
  assert.strictEqual(paidOut.updated, false);
  assert.strictEqual(paidOut.reason, 'visit_already_paid_out');
  assert.strictEqual(db.get(vid(1))?.paymentStatus, 'released');
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      await new Promise((resolve) => setTimeout(resolve, 20));
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
