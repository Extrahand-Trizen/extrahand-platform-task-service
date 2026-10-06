/**
 * Unit tests for recurring visit write safety (no database required).
 * Repository statics are replaced with an in-memory store that enforces the same
 * `updatedAt` precondition MongoDB applies in updateVisitIfUnchanged.
 * Run: npx ts-node src/tests/recurringVisitConcurrency.test.ts
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import {
  getVisitsForPlan,
  persistSingleVisitUpdate,
  RecurringVisitConflictError,
} from '../services/RecurringVisitPlanStore';
import { isDuplicateKeyError, RecurringVisitService } from '../services/RecurringVisitService';
import type { ITask } from '../models/Task';
import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';

type StoredVisit = Record<string, unknown> & { visitId: string; updatedAt: Date };

const repo = RecurringVisitRepository as unknown as Record<string, unknown>;
const calls = {
  conditional: [] as Array<{ visitId: string; expected: Date | null; set: Record<string, unknown>; unset: string[] }>,
  inserts: 0,
  legacyUpserts: 0,
};
let db = new Map<string, StoredVisit>();

function resetStore(docs: StoredVisit[]): void {
  db = new Map(docs.map((d) => [d.visitId, { ...d }]));
  calls.conditional = [];
  calls.inserts = 0;
  calls.legacyUpserts = 0;
}

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
  updatedAt: Date,
) => {
  calls.conditional.push({ visitId, expected, set, unset });
  const d = db.get(visitId);
  if (!d) return false;
  if ((expected?.getTime() ?? null) !== d.updatedAt.getTime()) return false;
  Object.assign(d, set, { updatedAt });
  for (const key of unset) delete d[key];
  return true;
};
repo.insertVisitsIfMissing = async (inputs: StoredVisit[]) => {
  calls.inserts += inputs.length;
  for (const input of inputs) {
    if (!db.has(input.visitId)) db.set(input.visitId, { ...input, updatedAt: new Date() });
  }
};
repo.listByParentAndVisitIds = async (_p: unknown, ids: string[]) =>
  ids.map((id) => db.get(id)).filter(Boolean).map((d) => ({ ...d }));
repo.upsertVisits = async (inputs: unknown[]) => {
  calls.legacyUpserts += inputs.length;
  return { upserted: inputs.length };
};

const parentId = new mongoose.Types.ObjectId();
const T0 = new Date('2026-06-01T08:00:00.000Z');

function storedVisit(index: number, overrides: Partial<StoredVisit> = {}): StoredVisit {
  return {
    parentTaskId: parentId,
    visitId: `v${index}`,
    visitIndex: index,
    date: new Date(`2026-06-0${index}T00:00:00.000Z`),
    status: 'scheduled',
    paymentStatus: 'pending',
    amount: 500,
    assigneeId: null,
    assigneeUid: null,
    childTaskId: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function fakePlanTask(recurringPlan: Record<string, unknown> = {}): ITask {
  return {
    _id: parentId,
    recurringPlan: { visitStorage: 'collection', ...recurringPlan },
    schedule: [],
    markModified() {},
  } as unknown as ITask;
}

async function readVisit(task: ITask, visitId: string): Promise<ScheduleVisitRow> {
  const rows = await getVisitsForPlan(task);
  const row = rows.find((r) => r.visitId === visitId);
  assert.ok(row, `visit ${visitId} should load`);
  return { ...row };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test('unchanged visit is not written and plan updatedAt is untouched', async () => {
  resetStore([storedVisit(1)]);
  const task = fakePlanTask();
  const visit = await readVisit(task, 'v1');
  await persistSingleVisitUpdate(task, visit);
  assert.strictEqual(calls.conditional.length, 0);
  assert.strictEqual((task as { updatedAt?: Date }).updatedAt, undefined);
});

test('changed field is written alone, conditioned on the read updatedAt; plan updatedAt bumps', async () => {
  resetStore([storedVisit(1)]);
  const task = fakePlanTask();
  const visit = await readVisit(task, 'v1');
  visit.status = 'skipped';
  await persistSingleVisitUpdate(task, visit);
  assert.strictEqual(calls.conditional.length, 1);
  assert.deepStrictEqual(Object.keys(calls.conditional[0].set), ['status']);
  assert.strictEqual(calls.conditional[0].expected?.getTime(), T0.getTime());
  assert.ok((task as { updatedAt?: Date }).updatedAt instanceof Date);
  assert.strictEqual(db.get('v1')?.status, 'skipped');
});

test('sequential writes on the same request chain off the new baseline', async () => {
  resetStore([storedVisit(1)]);
  const task = fakePlanTask();
  const visit = await readVisit(task, 'v1');
  visit.status = 'payment_pending';
  await persistSingleVisitUpdate(task, visit);
  visit.paymentStatus = 'held' as ScheduleVisitRow['paymentStatus'];
  await persistSingleVisitUpdate(task, visit);
  assert.strictEqual(calls.conditional.length, 2);
  assert.deepStrictEqual(Object.keys(calls.conditional[1].set), ['paymentStatus']);
  assert.strictEqual(db.get('v1')?.status, 'payment_pending');
  assert.strictEqual(db.get('v1')?.paymentStatus, 'held');
});

test('conflicting transitions: second writer gets RecurringVisitConflictError, first write survives', async () => {
  resetStore([storedVisit(1)]);
  const requestA = fakePlanTask();
  const requestB = fakePlanTask();
  const visitA = await readVisit(requestA, 'v1');
  const visitB = await readVisit(requestB, 'v1');

  visitA.status = 'skipped';
  await persistSingleVisitUpdate(requestA, visitA);

  visitB.status = 'in_progress';
  await assert.rejects(
    () => persistSingleVisitUpdate(requestB, visitB),
    (err: unknown) => err instanceof RecurringVisitConflictError && (err as { statusCode?: number }).statusCode === 409,
  );
  assert.strictEqual(db.get('v1')?.status, 'skipped');
});

test('concurrent writers to different visits both succeed (no false conflicts)', async () => {
  resetStore([storedVisit(1), storedVisit(2)]);
  const requestA = fakePlanTask();
  const requestB = fakePlanTask();
  const v1 = await readVisit(requestA, 'v1');
  const v2 = await readVisit(requestB, 'v2');
  v1.status = 'completed';
  v2.status = 'payment_pending';
  await Promise.all([persistSingleVisitUpdate(requestA, v1), persistSingleVisitUpdate(requestB, v2)]);
  assert.strictEqual(db.get('v1')?.status, 'completed');
  assert.strictEqual(db.get('v2')?.status, 'payment_pending');
});

test('clearing a field is sent as $unset', async () => {
  resetStore([
    storedVisit(1, {
      rescheduleRequest: {
        requestedBy: 'tasker',
        newDate: new Date('2026-06-05T00:00:00.000Z'),
        requestedAt: T0,
        status: 'pending',
      },
    }),
  ]);
  const task = fakePlanTask();
  const visit = await readVisit(task, 'v1');
  visit.rescheduleRequest = undefined;
  await persistSingleVisitUpdate(task, visit);
  assert.deepStrictEqual(calls.conditional[0].unset, ['rescheduleRequest']);
  assert.strictEqual(db.get('v1')?.rescheduleRequest, undefined);
});

test('visit created during the request is insert-only (never overwrites)', async () => {
  resetStore([storedVisit(1)]);
  const task = fakePlanTask();
  await readVisit(task, 'v1');
  const fresh = { ...(await readVisit(task, 'v1')), visitId: 'v9', visitIndex: 9 };
  await persistSingleVisitUpdate(task, fresh);
  assert.strictEqual(calls.inserts, 1);
  assert.strictEqual(calls.conditional.length, 0);
});

test('task never read through the store falls back to legacy upsert', async () => {
  resetStore([storedVisit(1)]);
  const task = fakePlanTask();
  const row = { ...(storedVisit(1) as unknown as ScheduleVisitRow), status: 'skipped' };
  await persistSingleVisitUpdate(task, row);
  assert.strictEqual(calls.legacyUpserts, 1);
});

function rows(statuses: string[]): ScheduleVisitRow[] {
  return statuses.map((status, i) => ({
    ...(storedVisit(i + 1) as unknown as ScheduleVisitRow),
    status,
  }));
}

const finitePlan = (extra: Record<string, unknown> = {}) =>
  fakePlanTask({ endType: 'end_on_date', totalPlanned: 3, ...extra });

test('finite plan: all planned visits completed → exhausted', () => {
  assert.strictEqual(
    RecurringVisitService.recurringPlanVisitsExhausted(finitePlan(), rows(['completed', 'completed', 'completed'])),
    true,
  );
});

test('finite plan: final visit still scheduled → not exhausted', () => {
  assert.strictEqual(
    RecurringVisitService.recurringPlanVisitsExhausted(finitePlan(), rows(['completed', 'completed', 'scheduled'])),
    false,
  );
});

test('finite plan: fewer visits materialized than planned → not exhausted', () => {
  assert.strictEqual(
    RecurringVisitService.recurringPlanVisitsExhausted(finitePlan(), rows(['completed', 'completed'])),
    false,
  );
});

test('finite plan: final visit skipped or cancelled → exhausted', () => {
  assert.strictEqual(
    RecurringVisitService.recurringPlanVisitsExhausted(finitePlan(), rows(['completed', 'completed', 'skipped'])),
    true,
  );
  assert.strictEqual(
    RecurringVisitService.recurringPlanVisitsExhausted(finitePlan(), rows(['completed', 'completed', 'cancelled'])),
    true,
  );
});

test('ongoing (until_cancelled) plan never auto-completes from a closed buffer', () => {
  assert.strictEqual(
    RecurringVisitService.recurringPlanVisitsExhausted(
      fakePlanTask({ endType: 'until_cancelled' }),
      rows(['completed', 'completed', 'completed']),
    ),
    false,
  );
});

test('finite plan without stored totalPlanned derives it from the schedule', () => {
  const task = fakePlanTask({
    endType: 'end_on_date',
    pattern: 'daily',
    endDate: new Date('2026-06-03T00:00:00.000Z'),
  });
  (task as unknown as { scheduledDate: Date }).scheduledDate = new Date('2026-06-01T00:00:00.000Z');
  assert.strictEqual(
    RecurringVisitService.recurringPlanVisitsExhausted(task, rows(['completed', 'completed', 'completed'])),
    true,
  );
  assert.strictEqual(
    RecurringVisitService.recurringPlanVisitsExhausted(task, rows(['completed', 'completed'])),
    false,
  );
});

test('isDuplicateKeyError only matches E11000 (single or all bulk write errors)', () => {
  assert.strictEqual(isDuplicateKeyError({ code: 11000 }), true);
  assert.strictEqual(isDuplicateKeyError({ writeErrors: [{ code: 11000 }, { err: { code: 11000 } }] }), true);
  assert.strictEqual(isDuplicateKeyError({ writeErrors: [{ code: 11000 }, { code: 121 }] }), false);
  assert.strictEqual(isDuplicateKeyError(new Error('network')), false);
  assert.strictEqual(isDuplicateKeyError(null), false);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
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
