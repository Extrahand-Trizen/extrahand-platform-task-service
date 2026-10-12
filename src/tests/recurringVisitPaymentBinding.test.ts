/**
 * Visit ↔ payment identity tests for recurring plans (no database / payment-service required).
 * RecurringVisit repository statics use an in-memory store that enforces the same `updatedAt`
 * precondition as updateVisitIfUnchanged, so concurrent confirms exercise the real conflict path.
 * Run: npx ts-node src/tests/recurringVisitPaymentBinding.test.ts
 */
import assert from 'assert';
import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import { RecurringVisitService } from '../services/RecurringVisitService';
import { PaymentClient } from '../services/PaymentClient';
import {
  evaluateVisitEscrowBinding,
  resolveRecurringAcceptedOfferAmount,
} from '../services/recurringVisitPaymentBinding';
import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';

type StoredVisit = Record<string, unknown> & { visitId: string; updatedAt: Date };
type Escrow = Record<string, unknown> & { escrowId: string };

const parentId = new mongoose.Types.ObjectId();
const requesterProfileId = new mongoose.Types.ObjectId();
const taskerProfileId = new mongoose.Types.ObjectId();
const POSTER_UID = 'poster-uid';
const T0 = new Date('2026-06-01T08:00:00.000Z');

// ── In-memory RecurringVisit store ───────────────────────────────────────────
let db = new Map<string, StoredVisit>();
let tick = 1;
const writes: Array<{ visitId: string; set: Record<string, unknown> }> = [];
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
  // Yield so concurrent requests interleave between read and write, like a real round trip.
  await new Promise((resolve) => setImmediate(resolve));
  const d = db.get(visitId);
  if (!d) return false;
  if ((expected?.getTime() ?? null) !== d.updatedAt.getTime()) return false;
  writes.push({ visitId, set });
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

// ── Task documents (one fresh doc per request, like Mongo) ───────────────────
let taskOverrides: Record<string, unknown> = {};
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
    ...taskOverrides,
  };
}
(Task as unknown as Record<string, unknown>).findById = async (id: unknown) =>
  String(id) === String(parentId) ? makeTaskDoc() : null;

let applications = new Map<string, Record<string, unknown>>();
(TaskApplication as unknown as Record<string, unknown>).findOne = async (query: {
  _id: string;
  taskId: unknown;
}) => {
  const app = applications.get(String(query._id));
  return app && String(app.taskId) === String(query.taskId) ? app : null;
};

const service = RecurringVisitService as unknown as Record<string, unknown>;
service.resolveTaskRequesterUid = async () => POSTER_UID;
let childTasksCreated = 0;
service.ensureChildTaskForVisit = async (_task: unknown, visit: ScheduleVisitRow) => {
  if (!visit.childTaskId) {
    childTasksCreated += 1;
    visit.childTaskId = new mongoose.Types.ObjectId();
  }
  return { _id: visit.childTaskId };
};
let notifications: string[] = [];
service.notifyTaskerRecurringVisitPaymentConfirmed = async (
  _task: unknown,
  visit: ScheduleVisitRow,
) => {
  notifications.push(visit.visitId);
};

// ── Fixtures ─────────────────────────────────────────────────────────────────
function visit(index: number, overrides: Partial<StoredVisit> = {}): StoredVisit {
  return {
    parentTaskId: parentId,
    visitId: `visit-uuid-${index}`,
    visitIndex: index,
    date: new Date(`2026-06-0${index}T00:00:00.000Z`),
    status: 'payment_pending',
    paymentStatus: 'pending',
    amount: 500,
    assigneeId: taskerProfileId,
    assigneeUid: 'tasker-uid',
    childTaskId: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function heldVisit(index: number, escrowId: string): StoredVisit {
  return visit(index, { status: 'confirmed', paymentStatus: 'held', escrowId, paidAt: T0 });
}

function escrow(id: string, visitId: string | null, overrides: Partial<Escrow> = {}): Escrow {
  return {
    escrowId: id,
    taskId: String(parentId),
    posterUid: POSTER_UID,
    status: 'held',
    paymentStatus: 'captured',
    taskAmount: '500',
    metadata: {
      ...(visitId ? { visitId, parentTaskId: String(parentId), recurringPlan: true } : {}),
      visitBudgetRupees: 500,
    },
    ...overrides,
  };
}

function reset(visits: StoredVisit[], escrowList: Escrow[]): void {
  db = new Map(visits.map((v) => [v.visitId, { ...v }]));
  escrows = new Map(escrowList.map((e) => [e.escrowId, { ...e }]));
  writes.length = 0;
  reassignCalls.length = 0;
  notifications = [];
  childTasksCreated = 0;
  taskOverrides = {};
  applications = new Map();
}

const V1 = 'visit-uuid-1';
const V2 = 'visit-uuid-2';
const confirm = (visitId: string, escrowId: string, extra: Record<string, unknown> = {}) =>
  RecurringVisitService.confirmVisitPayment({
    parentTaskId: String(parentId),
    visitId,
    escrowId,
    requesterProfileId,
    ...extra,
  });
const capture = (visitId: string, escrowId: string) =>
  RecurringVisitService.confirmVisitPaymentFromCapture({
    parentTaskId: String(parentId),
    visitId,
    escrowId,
  });
const flushBackground = () => new Promise((resolve) => setTimeout(resolve, 20));

function isPaid(visitId: string, escrowId: string): boolean {
  const v = db.get(visitId);
  return v?.status === 'confirmed' && v?.paymentStatus === 'held' && v?.escrowId === escrowId;
}
function isUnpaid(visitId: string): boolean {
  const v = db.get(visitId);
  return v?.status === 'payment_pending' && v?.paymentStatus === 'pending' && !v?.escrowId;
}
const rejectsWith = (pattern: RegExp, status?: number) => (err: unknown) => {
  const e = err as { message?: string; statusCode?: number };
  assert.match(String(e.message), pattern);
  if (status != null) assert.strictEqual(e.statusCode, status);
  return true;
};

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

// 1. First visit payment
test('1. Visit 1 payment marks exactly Visit 1 paid', async () => {
  reset([visit(1), visit(2)], [escrow('E1', V1)]);
  await confirm(V1, 'E1');
  await flushBackground();
  assert.ok(isPaid(V1, 'E1'), 'Visit 1 should be paid with E1');
  assert.ok(isUnpaid(V2), 'Visit 2 must stay unpaid');
  assert.deepStrictEqual(notifications, [V1]);
  assert.strictEqual(reassignCalls.length, 0, 'scoped escrow must not be re-tagged');
});

// 2. Second visit payment
test('2. Visit 2 payment marks Visit 2 paid and leaves Visit 1 binding intact', async () => {
  reset(
    [heldVisit(1, 'E1'), visit(2)],
    [escrow('E1', V1), escrow('E2', V2)],
  );
  await confirm(V2, 'E2');
  assert.ok(isPaid(V2, 'E2'));
  assert.ok(isPaid(V1, 'E1'));
});

// 3/4. Refresh / reopen — a fresh read reflects the stored visit, not client state
test('3/4. Refresh and reopen: a fresh read shows Visit 1 = Paid, Visit 2 = pending', async () => {
  reset([visit(1), visit(2)], [escrow('E1', V1)]);
  await confirm(V1, 'E1');
  const listed = await RecurringVisitRepository.listByParent(parentId);
  const byId = new Map(listed.map((v) => [String(v.visitId), v]));
  assert.strictEqual(byId.get(V1)?.paymentStatus, 'held');
  assert.strictEqual(byId.get(V1)?.escrowId, 'E1');
  assert.strictEqual(byId.get(V2)?.paymentStatus, 'pending');
});

// 5. Duplicate callback
test('5. Duplicate callback is idempotent (one write, one notification)', async () => {
  reset([visit(1), visit(2)], [escrow('E1', V1)]);
  await confirm(V1, 'E1');
  const writesAfterFirst = writes.length;
  const second = await confirm(V1, 'E1');
  await capture(V1, 'E1');
  await flushBackground();
  assert.strictEqual(second.alreadyConfirmed, true);
  assert.strictEqual(writes.length, writesAfterFirst, 'no extra writes');
  assert.deepStrictEqual(notifications, [V1]);
  assert.strictEqual(childTasksCreated, 1);
});

// 6. Verification + webhook race
test('6. Customer verification racing the capture webhook confirms once', async () => {
  reset([visit(1), visit(2)], [escrow('E1', V1)]);
  const [a, b] = await Promise.all([confirm(V1, 'E1'), capture(V1, 'E1')]);
  await flushBackground();
  assert.ok(isPaid(V1, 'E1'));
  assert.ok(isUnpaid(V2));
  assert.strictEqual(notifications.length, 1, 'tasker notified exactly once');
  assert.strictEqual([a.alreadyConfirmed, b.alreadyConfirmed].filter(Boolean).length, 1);
});

// 7. Two visits paid concurrently
test('7. Two visits paid concurrently each get their own payment', async () => {
  reset([visit(1), visit(2)], [escrow('E1', V1), escrow('E2', V2)]);
  await Promise.all([confirm(V1, 'E1'), confirm(V2, 'E2')]);
  assert.ok(isPaid(V1, 'E1'));
  assert.ok(isPaid(V2, 'E2'));
});

// 9. Wrong visit / wrong customer
test('9a. Payment for Visit 1 cannot confirm Visit 2', async () => {
  reset([visit(1), visit(2)], [escrow('E1', V1)]);
  await assert.rejects(() => confirm(V2, 'E1'), rejectsWith(/different visit/, 400));
  assert.ok(isUnpaid(V2));
  assert.ok(isUnpaid(V1));
});

test('9b. Unknown visit id is rejected', async () => {
  reset([visit(1)], [escrow('E1', V1)]);
  await assert.rejects(() => confirm('visit-uuid-404', 'E1'), rejectsWith(/Visit not found/, 404));
});

test('9c. Another customer cannot confirm the visit', async () => {
  reset([visit(1)], [escrow('E1', V1)]);
  await assert.rejects(
    () =>
      RecurringVisitService.confirmVisitPayment({
        parentTaskId: String(parentId),
        visitId: V1,
        escrowId: 'E1',
        requesterProfileId: new mongoose.Types.ObjectId(),
      }),
    rejectsWith(/Not authorized/, 403),
  );
  assert.ok(isUnpaid(V1));
});

test('9d. Escrow paid by a different customer is rejected', async () => {
  reset([visit(1)], [escrow('E1', V1, { posterUid: 'someone-else' })]);
  await assert.rejects(() => confirm(V1, 'E1'), rejectsWith(/different customer/, 400));
  assert.ok(isUnpaid(V1));
});

test('9e. Escrow from another task is rejected', async () => {
  reset([visit(1)], [escrow('E1', V1, { taskId: String(new mongoose.Types.ObjectId()) })]);
  await assert.rejects(() => confirm(V1, 'E1'), rejectsWith(/different work/, 400));
});

test('9f. One payment cannot be applied to a second visit (unscoped legacy escrow)', async () => {
  reset(
    [heldVisit(1, 'E0'), visit(2)],
    [escrow('E0', null)],
  );
  await assert.rejects(() => confirm(V2, 'E0'), rejectsWith(/another visit/, 400));
  assert.ok(isUnpaid(V2));
});

// 10. Amount manipulation
test('10. Escrow created for a lower amount is rejected', async () => {
  reset(
    [visit(1)],
    [escrow('E1', V1, { metadata: { visitId: V1, parentTaskId: String(parentId), visitBudgetRupees: 1 } })],
  );
  await assert.rejects(() => confirm(V1, 'E1'), rejectsWith(/does not match the visit amount/, 400));
  assert.ok(isUnpaid(V1));
});

// Payment state + background paths
test('Uncaptured escrow returns 409 so the capture callback retries', async () => {
  reset([visit(1)], [escrow('E1', V1, { status: 'pending', paymentStatus: 'pending' })]);
  await assert.rejects(() => confirm(V1, 'E1'), rejectsWith(/not been captured/, 409));
  assert.ok(isUnpaid(V1));
});

test('Visit already held by a different paid escrow → 409, binding unchanged', async () => {
  reset(
    [heldVisit(1, 'E1')],
    [escrow('E1', V1), escrow('E1b', V1)],
  );
  await assert.rejects(() => confirm(V1, 'E1b'), rejectsWith(/already been paid/, 409));
  assert.ok(isPaid(V1, 'E1'));
});

test('Background sync never applies an unscoped escrow to a pending visit', async () => {
  reset([visit(1)], [escrow('E0', null)]);
  await assert.rejects(
    () => confirm(V1, 'E0', { requireVisitScopedEscrow: true }),
    rejectsWith(/not linked to a visit/, 400),
  );
  assert.ok(isUnpaid(V1));
});

test('Customer confirm of an unscoped legacy escrow fills only the missing visit tag', async () => {
  reset([visit(1)], [escrow('E0', null)]);
  await confirm(V1, 'E0');
  assert.ok(isPaid(V1, 'E0'));
  assert.strictEqual(reassignCalls.length, 1);
  assert.strictEqual(reassignCalls[0].toVisitId, V1);
  assert.strictEqual((escrows.get('E0')?.metadata as Record<string, unknown>).visitId, V1);
});

test('Cancelled/skipped visit cannot be marked paid', async () => {
  reset([visit(1, { status: 'skipped' })], [escrow('E1', V1)]);
  await assert.rejects(() => confirm(V1, 'E1'), rejectsWith(/not awaiting payment/, 400));
});

// Quote (payment-service calls this before creating the Razorpay order)
test('Quote returns the visit amount for an assigned plan', async () => {
  reset([visit(1), visit(2, { amount: 650 })], []);
  const quote = await RecurringVisitService.quoteVisitPayment({
    parentTaskId: String(parentId),
    visitId: V2,
    posterUid: POSTER_UID,
  });
  assert.strictEqual(quote.amount, 650);
  assert.strictEqual(quote.visitId, V2);
  assert.strictEqual(quote.assignment, false);
});

test('Quote rejects another customer, unknown visit and already-paid visit', async () => {
  reset([heldVisit(1, 'E1'), visit(2)], []);
  const base = { parentTaskId: String(parentId), posterUid: POSTER_UID };
  await assert.rejects(
    () => RecurringVisitService.quoteVisitPayment({ ...base, visitId: V2, posterUid: 'intruder' }),
    rejectsWith(/Not authorized/, 403),
  );
  await assert.rejects(
    () => RecurringVisitService.quoteVisitPayment({ ...base, visitId: 'visit-uuid-404' }),
    rejectsWith(/Visit not found/, 404),
  );
  await assert.rejects(
    () => RecurringVisitService.quoteVisitPayment({ ...base, visitId: V1 }),
    rejectsWith(/already been paid/, 409),
  );
});

test('Quote before assignment uses the pending offer amount for that application', async () => {
  reset([visit(1, { status: 'scheduled', assigneeId: null })], []);
  taskOverrides = {
    assigneeId: undefined,
    recurringPlan: { visitStorage: 'collection', status: 'pending', budgetPerVisit: 500 },
  };
  const appId = new mongoose.Types.ObjectId();
  applications.set(String(appId), {
    _id: appId,
    taskId: parentId,
    status: 'pending',
    proposedBudget: { amount: 450 },
    negotiation: { currentAmount: 450, history: [] },
  });
  const quote = await RecurringVisitService.quoteVisitPayment({
    parentTaskId: String(parentId),
    visitId: V1,
    posterUid: POSTER_UID,
    applicationId: String(appId),
  });
  assert.strictEqual(quote.amount, 450);
  assert.strictEqual(quote.assignment, true);
  await assert.rejects(
    () =>
      RecurringVisitService.quoteVisitPayment({
        parentTaskId: String(parentId),
        visitId: V1,
        posterUid: POSTER_UID,
      }),
    rejectsWith(/applicationId is required/, 400),
  );
});

// Assignment (accept-and-pay) binding rules
test('Accept-and-pay binding rejects an escrow for the wrong visit or amount', () => {
  const rows = [visit(1), visit(2)] as unknown as ScheduleVisitRow[];
  const wrongVisit = evaluateVisitEscrowBinding({
    escrow: escrow('E2', V2),
    parentTaskId: String(parentId),
    visitId: V1,
    rows,
    expectedAmount: 500,
    allowUnscoped: true,
  });
  assert.strictEqual(wrongVisit.ok, false);
  assert.strictEqual(!wrongVisit.ok && wrongVisit.reason, 'wrong_visit');

  const wrongAmount = evaluateVisitEscrowBinding({
    escrow: escrow('E1', V1),
    parentTaskId: String(parentId),
    visitId: V1,
    rows,
    expectedAmount: 450,
    allowUnscoped: true,
  });
  assert.strictEqual(!wrongAmount.ok && wrongAmount.reason, 'amount_mismatch');
});

test('Accepted offer amount: newer budget-revision response beats a stale negotiation amount', () => {
  assert.strictEqual(
    resolveRecurringAcceptedOfferAmount({
      proposedBudget: { amount: 600 },
      negotiation: { currentAmount: 500, history: [] },
      quotationRevisions: [{ revisedAt: '2026-06-02T00:00:00Z' }],
    }),
    600,
  );
  assert.strictEqual(
    resolveRecurringAcceptedOfferAmount({
      proposedBudget: { amount: 600 },
      negotiation: { currentAmount: 550, history: [{ at: '2026-06-03T00:00:00Z' }] },
      quotationRevisions: [{ revisedAt: '2026-06-02T00:00:00Z' }],
    }),
    550,
  );
  assert.strictEqual(
    resolveRecurringAcceptedOfferAmount({ proposedBudget: { amount: 700 }, negotiation: null }),
    700,
  );
});

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
