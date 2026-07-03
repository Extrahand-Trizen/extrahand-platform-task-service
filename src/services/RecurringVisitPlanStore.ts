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
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import type { ScheduleVisitRow } from '../types/recurringVisitSchedule';
import type { VisitPaymentStatus } from '../types/recurringVisitSchedule';

export type VisitStorageMode = 'embedded' | 'collection';

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
      return fromDb.map(mapDocToScheduleRow);
    }
    if (!recurringVisitConfig.legacyFallback) {
      return [];
    }
  } else if (storage === 'embedded' && recurringVisitConfig.collectionReads) {
    const hasCollection = await RecurringVisitRepository.hasCollectionVisits(parentId);
    if (hasCollection) {
      const fromDb = await RecurringVisitRepository.listByParent(parentId);
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
    return fromDb.map(mapDocToScheduleRow);
  }

  return [];
}

/** Hydrate task.schedule in memory from collection for legacy service code paths. */
export async function hydrateTaskVisitsOntoSchedule(task: ITask): Promise<ScheduleVisitRow[]> {
  const visits: ScheduleVisitRow[] = await getVisitsForPlan(task);
  (task as ITask).schedule = visits as unknown as ITask['schedule'];
  return visits;
}

export async function findVisitForPlan(
  task: ITask,
  visitId: string,
): Promise<ScheduleVisitRow | undefined> {
  if (shouldWriteCollection(task) || usesCollectionStorage(task)) {
    const doc = await RecurringVisitRepository.findByParentAndVisitId(task._id, visitId);
    if (doc) return mapDocToScheduleRow(doc);
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
  const parentId = task._id;
  const writeCollection = shouldWriteCollection(task);

  if (writeCollection) {
    const upserts = rows.map((row) => mapScheduleRowToUpsert(parentId, row));
    await RecurringVisitRepository.upsertVisits(upserts);
  }

  if (recurringVisitConfig.dualWrite || !writeCollection) {
    (task as { schedule: unknown }).schedule = rows as unknown as ITask['schedule'];
    task.markModified('schedule');
  } else {
    (task as { schedule?: unknown[] }).schedule = [];
  }

  await updatePlanSummaryFromVisits(task, rows);
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
    await RecurringVisitRepository.upsertVisits([mapScheduleRowToUpsert(task._id, visit)]);
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
