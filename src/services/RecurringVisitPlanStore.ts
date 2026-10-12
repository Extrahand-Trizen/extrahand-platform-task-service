/**
 * Unified read/write layer for recurring visit data (collection vs embedded schedule[]).
 */
import mongoose from 'mongoose';
import Task, { type ITask } from '../models/Task';
import type { IRecurringVisit } from '../models/RecurringVisit';
import {
  recurringVisitConfig,
  DEFAULT_RECURRING_VISIT_BUFFER_SIZE,
} from '../config/recurringVisitConfig';
import {
  RecurringVisitRepository,
  type RecurringVisitLean,
} from '../repositories/RecurringVisitRepository';
import { ConflictError } from '../errors/AppError';
import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';
import type { VisitPaymentStatus } from '../types/recurringVisitSchedule';

export type VisitStorageMode = 'embedded' | 'collection';

export const RECURRING_VISIT_CONFLICT_CODE = 'RECURRING_VISIT_CONFLICT';

export class RecurringVisitConflictError extends ConflictError {
  constructor(message = 'This visit was just updated. Please refresh and try again.') {
    super(message, RECURRING_VISIT_CONFLICT_CODE);
  }
}

/**
 * Per-task snapshot of each collection visit as it was read (updatedAt + per-field canonical JSON).
 * Writes diff against it so only changed visits/fields are sent, conditioned on the read updatedAt.
 */
type VisitBaseline = { updatedAt: Date | null; fields: Record<string, string> };
const visitBaselines = new WeakMap<object, Map<string, VisitBaseline>>();
const hydratedTasks = new WeakSet<object>();

const BASELINE_EXCLUDED_KEYS = new Set(['parentTaskId', 'createdAt', 'updatedAt']);

function isObjectIdLike(value: unknown): boolean {
  const t = (value as { _bsontype?: string })?._bsontype;
  return t === 'ObjectId' || t === 'ObjectID';
}

function toPlainValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !isObjectIdLike(value) && !(value instanceof Date)) {
    const withToObject = value as { toObject?: () => unknown };
    if (typeof withToObject.toObject === 'function') return withToObject.toObject();
  }
  return value;
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (isObjectIdLike(value)) return String(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    // Cleared Mongoose nested paths (e.g. rescheduleRequest = undefined) still return a wrapper whose toObject() is null.
    const plain = toPlainValue(value);
    if (plain === null || plain === undefined) return undefined;
    if (plain !== value) return canonicalize(plain);
    const record = plain as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (key === '_id') continue;
      const v = canonicalize(record[key]);
      if (v !== undefined) out[key] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value;
}

function canonicalVisitFields(
  parentId: mongoose.Types.ObjectId,
  row: ScheduleVisitRow,
): Record<string, string> {
  const upsert = mapScheduleRowToUpsert(parentId, row) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(upsert)) {
    if (BASELINE_EXCLUDED_KEYS.has(key)) continue;
    const c = canonicalize(value);
    if (c !== undefined) fields[key] = JSON.stringify(c);
  }
  return fields;
}

function recordVisitBaselines(task: ITask, docs: RecurringVisitLean[]): void {
  if (docs.length === 0) return;
  let map = visitBaselines.get(task);
  if (!map) {
    map = new Map();
    visitBaselines.set(task, map);
  }
  for (const doc of docs) {
    const row = mapDocToScheduleRow(doc);
    const raw = (doc as { updatedAt?: Date | string }).updatedAt;
    map.set(row.visitId, {
      updatedAt: raw ? new Date(raw) : null,
      fields: canonicalVisitFields(task._id, row),
    });
  }
}

/**
 * Re-baseline after a direct repository write on this task doc. With `onlyFields`, only those
 * fields and updatedAt move forward, so in-memory edits to other fields are still diffed against
 * what this request originally read (a concurrent writer's other fields are not overwritten).
 */
export function refreshVisitBaseline(
  task: ITask,
  doc: RecurringVisitLean | null | undefined,
  onlyFields?: string[],
): void {
  const map = visitBaselines.get(task);
  if (!doc || !map) return;
  const visitId = String(doc.visitId);
  const previous = map.get(visitId);
  if (!onlyFields || !previous) {
    recordVisitBaselines(task, [doc]);
    return;
  }
  const latest = canonicalVisitFields(task._id, mapDocToScheduleRow(doc));
  const fields = { ...previous.fields };
  for (const key of onlyFields) {
    if (latest[key] === undefined) delete fields[key];
    else fields[key] = latest[key];
  }
  const raw = (doc as { updatedAt?: Date | string }).updatedAt;
  map.set(visitId, { updatedAt: raw ? new Date(raw) : null, fields });
}

export function getPlanVisitStorage(task: ITask | Record<string, unknown>): VisitStorageMode {
  const plan = (task as { recurringPlan?: { visitStorage?: string } }).recurringPlan;
  if (plan?.visitStorage === 'collection') return 'collection';
  if (plan?.visitStorage === 'embedded') return 'embedded';
  return 'embedded';
}

export function usesCollectionStorage(task: ITask | Record<string, unknown>): boolean {
  if (getPlanVisitStorage(task) === 'collection') {
    return recurringVisitConfig.collectionReads || recurringVisitConfig.collectionWrites;
  }
  return false;
}

export function shouldWriteCollection(task: ITask | Record<string, unknown>): boolean {
  return getPlanVisitStorage(task) === 'collection' && recurringVisitConfig.collectionWrites;
}

export function mapDocToScheduleRow(doc: IRecurringVisit | Record<string, unknown>): ScheduleVisitRow {
  const d = doc as IRecurringVisit;
  return {
    visitId: String(d.visitId),
    visitIndex: Number(d.visitIndex),
    date: new Date(d.date),
    scheduledTimeStart: d.scheduledTimeStart,
    scheduledTimeEnd: d.scheduledTimeEnd,
    expectedDurationMinutes: d.expectedDurationMinutes,
    status: String(d.status),
    paymentStatus: (d.paymentStatus || 'not_required') as VisitPaymentStatus,
    escrowId: d.escrowId,
    paymentDeadline: d.paymentDeadline ? new Date(d.paymentDeadline) : undefined,
    paidAt: d.paidAt ? new Date(d.paidAt) : undefined,
    amount: d.amount,
    assigneeId: d.assigneeId ?? null,
    assigneeUid: d.assigneeUid ?? null,
    childTaskId: d.childTaskId ?? null,
    skippedAt: d.skippedAt ? new Date(d.skippedAt) : undefined,
    skippedBy: d.skippedBy,
    skipReason: d.skipReason,
    paymentReminderSentAt: d.paymentReminderSentAt
      ? new Date(d.paymentReminderSentAt)
      : undefined,
    cancellationChargeAmount: d.cancellationChargeAmount,
    rescheduleRequest: d.rescheduleRequest
      ? {
          ...d.rescheduleRequest,
          newDate: new Date(d.rescheduleRequest.newDate),
          requestedAt: new Date(d.rescheduleRequest.requestedAt),
          respondedAt: d.rescheduleRequest.respondedAt
            ? new Date(d.rescheduleRequest.respondedAt)
            : undefined,
        }
      : undefined,
    cancelRequest: d.cancelRequest
      ? {
          ...d.cancelRequest,
          requestedAt: new Date(d.cancelRequest.requestedAt),
          respondedAt: d.cancelRequest.respondedAt
            ? new Date(d.cancelRequest.respondedAt)
            : undefined,
        }
      : undefined,
    createdAt: d.createdAt ? new Date(d.createdAt) : new Date(),
    updatedAt: d.updatedAt ? new Date(d.updatedAt) : new Date(),
  };
}

export function mapScheduleRowToUpsert(
  parentTaskId: mongoose.Types.ObjectId,
  row: ScheduleVisitRow,
): Parameters<typeof RecurringVisitRepository.upsertVisits>[0][number] {
  return {
    parentTaskId,
    visitId: row.visitId,
    visitIndex: row.visitIndex,
    date: new Date(row.date),
    scheduledTimeStart: row.scheduledTimeStart,
    scheduledTimeEnd: row.scheduledTimeEnd,
    expectedDurationMinutes: row.expectedDurationMinutes,
    status: row.status as IRecurringVisit['status'],
    paymentStatus: row.paymentStatus,
    escrowId: row.escrowId,
    paymentDeadline: row.paymentDeadline,
    paidAt: row.paidAt,
    amount: row.amount,
    assigneeId: row.assigneeId ?? null,
    assigneeUid: row.assigneeUid ?? null,
    childTaskId: row.childTaskId ?? null,
    skippedAt: row.skippedAt,
    skippedBy: row.skippedBy,
    skipReason: row.skipReason,
    paymentReminderSentAt: row.paymentReminderSentAt,
    cancellationChargeAmount: (row as { cancellationChargeAmount?: number })
      .cancellationChargeAmount,
    rescheduleRequest: row.rescheduleRequest,
    cancelRequest: row.cancelRequest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? new Date(),
  };
}

function mapEmbeddedScheduleToRows(task: ITask): ScheduleVisitRow[] {
  const schedule = Array.isArray(task.schedule) ? task.schedule : [];
  return schedule.map((entry, index) => {
    const e = entry as Record<string, unknown>;
    const visitId =
      typeof e.visitId === 'string' && e.visitId.trim()
        ? e.visitId.trim()
        : `legacy_${String(task._id)}_${index}`;
    return {
      visitId,
      visitIndex: typeof e.visitIndex === 'number' ? e.visitIndex : index + 1,
      date: new Date(e.date as Date),
      scheduledTimeStart: e.scheduledTimeStart as string | undefined,
      scheduledTimeEnd: e.scheduledTimeEnd as string | undefined,
      expectedDurationMinutes: e.expectedDurationMinutes as number | undefined,
      status: String(e.status || 'open'),
      paymentStatus: (e.paymentStatus || 'not_required') as VisitPaymentStatus,
      escrowId: e.escrowId as string | undefined,
      paymentDeadline: e.paymentDeadline ? new Date(e.paymentDeadline as Date) : undefined,
      paidAt: e.paidAt ? new Date(e.paidAt as Date) : undefined,
      amount: e.amount as number | undefined,
      assigneeId: (e.assigneeId as mongoose.Types.ObjectId) ?? null,
      assigneeUid: (e.assigneeUid as string) ?? null,
      childTaskId: (e.childTaskId as mongoose.Types.ObjectId) ?? null,
      skippedAt: e.skippedAt ? new Date(e.skippedAt as Date) : undefined,
      skippedBy: e.skippedBy as string | undefined,
      skipReason: e.skipReason as string | undefined,
      paymentReminderSentAt: e.paymentReminderSentAt
        ? new Date(e.paymentReminderSentAt as Date)
        : undefined,
      rescheduleRequest: e.rescheduleRequest as ScheduleVisitRow['rescheduleRequest'],
      cancelRequest: e.cancelRequest as ScheduleVisitRow['cancelRequest'],
      createdAt: e.createdAt ? new Date(e.createdAt as Date) : new Date(),
      updatedAt: e.updatedAt ? new Date(e.updatedAt as Date) : new Date(),
    };
  });
}

async function loadEmbeddedScheduleFromDb(
  parentId: mongoose.Types.ObjectId,
): Promise<ScheduleVisitRow[]> {
  const full = await Task.findById(parentId).select('schedule').lean();
  if (!full) return [];
  return mapEmbeddedScheduleToRows(full as unknown as ITask);
}

/**
 * Load visits for a plan — collection first, legacy embedded fallback.
 */
export async function getVisitsForPlan(
  task: ITask,
  options?: { forceReload?: boolean },
): Promise<ScheduleVisitRow[]> {
  const parentId = task._id;
  const storage = getPlanVisitStorage(task);

  if (storage === 'collection' && recurringVisitConfig.collectionReads) {
    const fromDb = await RecurringVisitRepository.listByParent(parentId);
    if (fromDb.length > 0) {
      recordVisitBaselines(task, fromDb);
      return fromDb.map(mapDocToScheduleRow);
    }
    if (!recurringVisitConfig.legacyFallback) {
      return [];
    }
  } else if (storage === 'embedded' && recurringVisitConfig.collectionReads) {
    const hasCollection = await RecurringVisitRepository.hasCollectionVisits(parentId);
    if (hasCollection) {
      const fromDb = await RecurringVisitRepository.listByParent(parentId);
      recordVisitBaselines(task, fromDb);
      return fromDb.map(mapDocToScheduleRow);
    }
  }

  if (recurringVisitConfig.legacyFallback) {
    const embedded = mapEmbeddedScheduleToRows(task);
    if (embedded.length > 0) return embedded;
    const fromDb = await loadEmbeddedScheduleFromDb(parentId);
    if (fromDb.length > 0) return fromDb;
  }

  if (options?.forceReload && storage === 'collection') {
    const fromDb = await RecurringVisitRepository.listByParent(parentId);
    recordVisitBaselines(task, fromDb);
    return fromDb.map(mapDocToScheduleRow);
  }

  return [];
}

/**
 * Hydrate task.schedule in memory from collection for legacy service code paths.
 * The in-memory copy is a working set only: for collection plans it is unmarked so a plain
 * task.save() never writes it back to the deprecated embedded array.
 */
export async function hydrateTaskVisitsOntoSchedule(task: ITask): Promise<ScheduleVisitRow[]> {
  const visits: ScheduleVisitRow[] = await getVisitsForPlan(task);
  (task as ITask).schedule = visits as unknown as ITask['schedule'];
  hydratedTasks.add(task);
  if (shouldWriteCollection(task) && !recurringVisitConfig.dualWrite) {
    (task as { unmarkModified?: (path: string) => void }).unmarkModified?.('schedule');
  }
  return visits;
}

/** Hydrate once per task document; later calls reuse the in-memory working set. */
export async function ensureVisitsLoaded(task: ITask): Promise<void> {
  if (hydratedTasks.has(task)) return;
  if (getPlanVisitStorage(task) !== 'collection' && Array.isArray(task.schedule) && task.schedule.length > 0) {
    hydratedTasks.add(task);
    return;
  }
  await hydrateTaskVisitsOntoSchedule(task);
}

export async function findVisitForPlan(
  task: ITask,
  visitId: string,
): Promise<ScheduleVisitRow | undefined> {
  if (shouldWriteCollection(task) || usesCollectionStorage(task)) {
    const doc = await RecurringVisitRepository.findByParentAndVisitId(task._id, visitId);
    if (doc) {
      recordVisitBaselines(task, [doc as RecurringVisitLean]);
      return mapDocToScheduleRow(doc);
    }
  }
  const rows = Array.isArray(task.schedule) ? task.schedule : [];
  const hit = rows.find(
    (v) => String((v as { visitId?: string }).visitId) === visitId.trim(),
  );
  if (hit) return mapDocToScheduleRow(hit as unknown as IRecurringVisit);
  if (recurringVisitConfig.legacyFallback) {
    const all = await getVisitsForPlan(task);
    return all.find((v) => v.visitId === visitId.trim());
  }
  return undefined;
}

export async function persistVisitsFromTask(
  task: mongoose.Document & ITask,
  rows: ScheduleVisitRow[],
): Promise<void> {
  const writeCollection = shouldWriteCollection(task);

  if (writeCollection) {
    const written = await writeChangedVisits(task, rows);
    // Plan updatedAt doubles as the "visits changed" signal for list caches.
    if (written > 0) (task as { updatedAt?: Date }).updatedAt = new Date();
  }

  if (recurringVisitConfig.dualWrite || !writeCollection) {
    (task as { schedule: unknown }).schedule = rows as unknown as ITask['schedule'];
    task.markModified('schedule');
  } else if (rows.length > 0) {
    // In-memory working set only; the Task pre-save hook keeps it out of the stored document.
    (task as { schedule: unknown }).schedule = rows as unknown as ITask['schedule'];
    hydratedTasks.add(task);
  } else {
    (task as { schedule?: unknown[] }).schedule = [];
    hydratedTasks.delete(task);
  }

  await updatePlanSummaryFromVisits(task, rows.length > 0 ? rows : undefined);
}

/**
 * Collection write path. Visits read on this task doc are diffed against their baseline:
 * unchanged visits are skipped, changed ones get a field-level update conditioned on the
 * updatedAt they were read with (lost-update / double-transition guard). Visits created
 * during this operation are insert-only. Docs never read via the store keep the legacy upsert.
 */
async function writeChangedVisits(task: ITask, rows: ScheduleVisitRow[]): Promise<number> {
  const parentId = task._id;
  const baselines = visitBaselines.get(task);
  const conditional: Array<{
    visitId: string;
    expectedUpdatedAt: Date | null;
    set: Record<string, unknown>;
    unset: string[];
    fields: Record<string, string>;
  }> = [];
  const inserts: ScheduleVisitRow[] = [];
  const legacy: ScheduleVisitRow[] = [];

  for (const row of rows) {
    const visitId = String(row.visitId || '').trim();
    if (!visitId) continue;
    if (!baselines) {
      legacy.push(row);
      continue;
    }
    const baseline = baselines.get(visitId);
    if (!baseline) {
      inserts.push(row);
      continue;
    }
    const current = canonicalVisitFields(parentId, row);
    const upsert = mapScheduleRowToUpsert(parentId, row) as Record<string, unknown>;
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    const keys = new Set([...Object.keys(current), ...Object.keys(baseline.fields)]);
    for (const key of keys) {
      if (current[key] === baseline.fields[key]) continue;
      if (current[key] === undefined) unset.push(key);
      else set[key] = toPlainValue(upsert[key]);
    }
    if (Object.keys(set).length === 0 && unset.length === 0) continue;
    conditional.push({ visitId, expectedUpdatedAt: baseline.updatedAt, set, unset, fields: current });
  }

  if (conditional.length > 0) {
    const updatedAt = new Date();
    const results = await Promise.all(
      conditional.map(async (op) => ({
        op,
        ok: await RecurringVisitRepository.updateVisitIfUnchanged(
          parentId,
          op.visitId,
          op.expectedUpdatedAt,
          op.set,
          op.unset,
          updatedAt,
        ),
      })),
    );
    let conflicted = false;
    for (const { op, ok } of results) {
      if (ok) baselines?.set(op.visitId, { updatedAt, fields: op.fields });
      else {
        baselines?.delete(op.visitId);
        conflicted = true;
      }
    }
    if (conflicted) throw new RecurringVisitConflictError();
  }

  if (inserts.length > 0) {
    await RecurringVisitRepository.insertVisitsIfMissing(
      inserts.map((row) => mapScheduleRowToUpsert(parentId, row)),
    );
    const fresh = await RecurringVisitRepository.listByParentAndVisitIds(
      parentId,
      inserts.map((r) => String(r.visitId).trim()),
    );
    recordVisitBaselines(task, fresh);
  }

  if (legacy.length > 0) {
    await RecurringVisitRepository.upsertVisits(
      legacy.map((row) => mapScheduleRowToUpsert(parentId, row)),
    );
  }

  return conditional.length + inserts.length + legacy.length;
}

export async function updatePlanSummaryFromVisits(
  task: ITask,
  rows?: ScheduleVisitRow[],
): Promise<void> {
  const plan = (task as { recurringPlan?: Record<string, unknown> }).recurringPlan;
  if (!plan) return;

  let visitRows: ScheduleVisitRow[] = rows ?? (await getVisitsForPlan(task));

  const completed = visitRows.filter((v) => v.status === 'completed').length;
  plan.completedVisitCount = completed;

  const sorted = [...visitRows].sort((a, b) => a.visitIndex - b.visitIndex);
  const maxIndex = sorted.reduce((m, v) => Math.max(m, v.visitIndex || 0), 0);
  plan.nextVisitIndex = maxIndex > 0 ? maxIndex + 1 : 1;

  const last = sorted[sorted.length - 1];
  if (last) {
    plan.lastMaterializedDate = new Date(last.date);
  }

  const upcoming = sorted
    .filter((v) =>
      ['open', 'reserved', 'assigned', 'scheduled', 'payment_pending', 'confirmed'].includes(
        String(v.status),
      ),
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  plan.nextVisitDate = upcoming[0] ? new Date(upcoming[0].date) : undefined;

  const pending = sorted.find((v) => v.status === 'payment_pending');
  plan.pendingPaymentVisitId = pending?.visitId;

  if (!plan.materializedBufferSize) {
    plan.materializedBufferSize = DEFAULT_RECURRING_VISIT_BUFFER_SIZE;
  }
}

export function markPlanCollectionStorage(plan: Record<string, unknown>): void {
  plan.visitStorage = 'collection';
  if (!plan.materializedBufferSize) {
    plan.materializedBufferSize = DEFAULT_RECURRING_VISIT_BUFFER_SIZE;
  }
  if (!plan.planVersion) {
    plan.planVersion = 2;
  }
}

export async function persistSingleVisitUpdate(
  task: ITask,
  visit: ScheduleVisitRow,
): Promise<void> {
  if (shouldWriteCollection(task)) {
    if ((await writeChangedVisits(task, [visit])) > 0) {
      (task as { updatedAt?: Date }).updatedAt = new Date();
    }
    if (recurringVisitConfig.dualWrite) {
      const rows = await hydrateTaskVisitsOntoSchedule(task);
      const idx = rows.findIndex((r) => r.visitId === visit.visitId);
      if (idx >= 0) rows[idx] = visit;
      (task as { schedule: unknown }).schedule = rows as unknown as ITask['schedule'];
      task.markModified?.('schedule');
    }
  } else {
    const rows = (task.schedule || []) as unknown as ScheduleVisitRow[];
    const idx = rows.findIndex((r) => r.visitId === visit.visitId);
    if (idx >= 0) {
      rows[idx] = visit;
    }
    (task as { schedule: unknown }).schedule = rows as unknown as ITask['schedule'];
    if (task.markModified) task.markModified('schedule');
  }
}
