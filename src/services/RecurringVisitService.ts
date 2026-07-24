import crypto from 'crypto';
import mongoose from 'mongoose';
import Task, { ITask } from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import {
  decodeRecurringMetaFromTask,
  isRecurringVisitPlanTask,
  type RecurringMetaPayload,
} from '../utils/recurringVisitMeta';
import {
  addMinutesToTimeLabel,
  countPlannedRecurringOccurrences,
  normalizeDateOnly,
  parseIncomingCalendarDate,
  resolveMaterializationMissingCount,
  resolveNextMaterializedVisitDate,
  validateRecurringPlanOccurrences,
  type RecurringScheduleBuildConfig,
} from '../utils/recurringVisitScheduleBuilder';
import { selectWorkDetailsPreviewVisits } from '../utils/recurringWorkDetailsPreview';
import {
  canTaskerStartVisit,
  DEFAULT_CONSECUTIVE_UNPAID_PAUSE_THRESHOLD,
  DEFAULT_MATERIALIZED_BUFFER_SIZE,
  DEFAULT_PAYMENT_CUTOFF_HOURS_BEFORE_VISIT,
  DEFAULT_SKIP_FREE_HOURS_BEFORE_VISIT,
  VISIT_TERMINAL_STATUSES,
  type ScheduleVisitRow,
  type VisitPaymentStatus,
  type VisitStatus,
} from '../types/recurringVisitSchedule';
import { DEFAULT_RECURRING_VISIT_BUFFER_SIZE, recurringVisitConfig } from '../config/recurringVisitConfig';
import {
  getVisitsForPlan,
  hydrateTaskVisitsOntoSchedule,
  markPlanCollectionStorage,
  mapDocToScheduleRow,
  mapScheduleRowToUpsert,
  persistVisitsFromTask,
  shouldWriteCollection,
  updatePlanSummaryFromVisits,
} from './RecurringVisitPlanStore';
import { RecurringVisitRepository } from '../repositories/RecurringVisitRepository';
import { getRedisClient } from '../config/redis';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';
import { fireDialogWhatsAppForUser } from '../clients/fireDialogWhatsAppForUser';
import { taskOpenAppButton } from '../utils/whatsappTaskButtons';
import { NotificationClient } from './NotificationClient';
import { PaymentClient } from './PaymentClient';

function invalidateTaskDetailCache(taskId: string): void {
  const cacheKey = `task:detail:${taskId}`;
  getRedisClient()?.del(cacheKey).catch((err: unknown) => {
    logger.warn('Task detail cache invalidate error', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

function isOptimisticConcurrencyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = String((error as { name?: string }).name || '');
  if (name === 'VersionError') return true;
  const message = String((error as { message?: string }).message || '');
  return (
    message.includes('No matching document found for id') && message.includes('version')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveRecurringPlanDocument(
  task: mongoose.Document & ITask,
  taskId: string,
  rows?: ScheduleVisitRow[],
): Promise<void> {
  const visitRows = rows ?? getScheduleRows(task);
  if (shouldWriteCollection(task)) {
    await persistVisitsFromTask(task, visitRows);
  } else {
    task.markModified('schedule');
  }
  if (task.isModified('recurringPlan')) {
    task.markModified('recurringPlan');
  }
  if (task.isModified('activeVisitId')) {
    task.markModified('activeVisitId');
  }
  await task.save();
  invalidateTaskDetailCache(taskId);
}

const reconcilePlanStateInFlight = new Map<string, Promise<void>>();
const openNextVisitForPaymentInFlight = new Set<string>();

type OpenNextVisitForPaymentOptions = {
  skipReconcile?: boolean;
};

function resolvePendingPaymentPayload(
  visit: ScheduleVisitRow,
  plan: Record<string, unknown>,
): { visitId: string; amount: number; paymentDeadline: Date } {
  return {
    visitId: visit.visitId,
    amount: Number(visit.amount ?? plan.budgetPerVisit ?? 0),
    paymentDeadline: visit.paymentDeadline ?? getPaymentDeadline(new Date(visit.date)),
  };
}

export type { ScheduleVisitRow } from '../types/recurringVisitSchedule';

function newVisitId(): string {
  return crypto.randomUUID();
}

/** Mongoose schedule subdocs ignore `undefined` — use null so cleared fields persist. */
function clearScheduleVisitHeldPaymentBinding(
  visit: ScheduleVisitRow,
  options?: { paymentStatus?: VisitPaymentStatus },
): void {
  (visit as { childTaskId: mongoose.Types.ObjectId | null }).childTaskId = null;
  (visit as { escrowId: string | null }).escrowId = null;
  (visit as { paidAt: Date | null }).paidAt = null;
  visit.paymentStatus = options?.paymentStatus ?? 'pending';
}

async function safeGetTaskEscrowRecord(
  taskId: string,
  visitId?: string,
): Promise<Record<string, unknown> | null> {
  try {
    if (visitId) {
      const byVisit = (await PaymentClient.getEscrowByTaskIdAndVisitId(taskId, visitId)) as
        | Record<string, unknown>
        | null;
      if (byVisit) return byVisit;
    }
    return (await PaymentClient.getEscrowByTaskId(taskId)) as Record<string, unknown> | null;
  } catch (error) {
    logger.warn('[RecurringVisitService] Escrow lookup failed during visit reschedule', {
      taskId,
      visitId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function buildScheduleConfigFromMeta(
  meta: RecurringMetaPayload,
  startDate: Date,
  recurringEndDate?: Date,
): RecurringScheduleBuildConfig {
  return {
    pattern: meta.pattern,
    selectedWeekdays: meta.selectedWeekdays || [],
    startDate: normalizeDateOnly(startDate),
    endType: meta.endType,
    endDate: meta.endType === 'end_on_date' && recurringEndDate ? recurringEndDate : undefined,
  };
}

function createVisitRow(
  date: Date,
  visitIndex: number,
  meta: RecurringMetaPayload,
  status: VisitStatus = 'scheduled',
): ScheduleVisitRow {
  const now = new Date();
  const visitTime = meta.visitTime || '';
  const duration = meta.expectedDurationMinutes || 60;
  return {
    visitId: newVisitId(),
    visitIndex,
    date: normalizeDateOnly(date),
    scheduledTimeStart: visitTime || undefined,
    scheduledTimeEnd: visitTime ? addMinutesToTimeLabel(visitTime, duration) : undefined,
    expectedDurationMinutes: duration,
    status,
    paymentStatus: 'not_required',
    createdAt: now,
    updatedAt: now,
  };
}

function getPaymentDeadline(visitDate: Date): Date {
  const deadline = new Date(visitDate);
  deadline.setHours(deadline.getHours() - DEFAULT_PAYMENT_CUTOFF_HOURS_BEFORE_VISIT);
  return deadline;
}

function getScheduleRows(task: ITask): ScheduleVisitRow[] {
  return (task.schedule || []) as unknown as ScheduleVisitRow[];
}

/** Collection-backed plans store visits outside `task.schedule[]`. */
async function loadPlanScheduleRows(task: ITask): Promise<ScheduleVisitRow[]> {
  if (isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
    return getVisitsForPlan(task);
  }
  return getScheduleRows(task);
}

function findVisit(task: ITask, visitId: string): ScheduleVisitRow | undefined {
  return getScheduleRows(task).find((v) => v.visitId === visitId);
}

async function requireHydratedVisit(
  task: mongoose.Document & ITask,
  visitId: string,
): Promise<ScheduleVisitRow> {
  await hydrateTaskVisitsOntoSchedule(task);
  const visit = findVisit(task, visitId);
  if (!visit) throw new NotFoundError('Visit not found');
  return visit;
}

function replaceVisitRowInSchedule(
  task: mongoose.Document & ITask,
  visit: ScheduleVisitRow,
): ScheduleVisitRow[] {
  const rows = getScheduleRows(task);
  const rowIdx = rows.findIndex((row) => row.visitId === visit.visitId);
  if (rowIdx >= 0) {
    rows[rowIdx] = visit;
  }
  task.schedule = rows as unknown as ITask['schedule'];
  return rows;
}

function sortScheduleRows(rows: ScheduleVisitRow[]): ScheduleVisitRow[] {
  return [...rows].sort(
    (a, b) =>
      (a.visitIndex ?? 0) - (b.visitIndex ?? 0) ||
      normalizeDateOnly(new Date(a.date)).getTime() -
        normalizeDateOnly(new Date(b.date)).getTime(),
  );
}

function sortScheduleRowsByDate(rows: ScheduleVisitRow[]): ScheduleVisitRow[] {
  return [...rows].sort(
    (a, b) =>
      normalizeDateOnly(new Date(a.date)).getTime() -
        normalizeDateOnly(new Date(b.date)).getTime() ||
      (a.visitIndex ?? 0) - (b.visitIndex ?? 0),
  );
}

function stripRecurringPlanTitleSuffix(title: string): string {
  return String(title || '')
    .replace(/\s*[·•]\s*Visit\s+\d+\s*$/i, '')
    .trim();
}

function isVisitPassed(visit: ScheduleVisitRow): boolean {
  const status = String(visit.status || '') as VisitStatus;
  return status === 'completed' || VISIT_TERMINAL_STATUSES.has(status);
}

function findNextPayableVisit(sorted: ScheduleVisitRow[]): ScheduleVisitRow | undefined {
  const lastPassedIdx = sorted.reduce(
    (max, visit, index) => (isVisitPassed(visit) ? index : max),
    -1,
  );
  const afterLastPassed = sorted.find(
    (visit, index) =>
      index > lastPassedIdx &&
      ['scheduled', 'payment_pending'].includes(String(visit.status)),
  );
  if (afterLastPassed) return afterLastPassed;
  return sorted.find((visit) =>
    ['scheduled', 'payment_pending'].includes(String(visit.status)),
  );
}

function isVisitRowDoneForChronology(visit: ScheduleVisitRow): boolean {
  if (visit.status === 'completed') return true;
  return VISIT_TERMINAL_STATUSES.has(visit.status as VisitStatus);
}

function isVisitWorkFinishedByCompletedCount(
  planTask: ITask,
  visit: ScheduleVisitRow,
  sortedRows: ScheduleVisitRow[],
): boolean {
  const plan = (planTask as { recurringPlan?: { completedVisitCount?: number } }).recurringPlan;
  const completedCount = Number(plan?.completedVisitCount || 0);
  if (completedCount <= 0) return false;
  const idx = sortedRows.findIndex((row) => row.visitId === visit.visitId);
  return idx >= 0 && idx < completedCount;
}

/** Past/completed visits must not receive assignment payment again. */
async function isVisitWorkFinishedForAssignment(
  planTask: ITask,
  visit: ScheduleVisitRow,
  sortedRows: ScheduleVisitRow[],
): Promise<boolean> {
  const status = String(visit.status || '');
  if (status === 'completed') return true;
  if (VISIT_TERMINAL_STATUSES.has(status as VisitStatus)) return true;
  if (isVisitWorkFinishedByCompletedCount(planTask, visit, sortedRows)) return true;
  if (visit.childTaskId) {
    const child = await Task.findById(visit.childTaskId).select('status').lean();
    if (child?.status === 'completed') return true;
  }
  return false;
}

/** Earliest visit by calendar date that still needs work or payment. */
function resolveChronologicalCurrentVisitRow(
  rows: ScheduleVisitRow[],
): ScheduleVisitRow | undefined {
  const dateSorted = sortScheduleRowsByDate(rows);

  for (const visit of dateSorted) {
    if (isVisitRowDoneForChronology(visit)) continue;
    if (visit.status === 'in_progress') return visit;
  }

  for (const visit of dateSorted) {
    if (isVisitRowDoneForChronology(visit)) continue;
    return visit;
  }

  return undefined;
}

function isVisitDeferredByEarlierChronologicalVisit(
  visit: ScheduleVisitRow,
  rows: ScheduleVisitRow[],
): boolean {
  const chronologicalCurrent = resolveChronologicalCurrentVisitRow(rows);
  if (!chronologicalCurrent?.visitId || !visit.visitId) return false;
  if (chronologicalCurrent.visitId === visit.visitId) return false;
  if (isVisitRowDoneForChronology(visit)) return false;
  return (
    normalizeDateOnly(new Date(visit.date)).getTime() >
    normalizeDateOnly(new Date(chronologicalCurrent.date)).getTime()
  );
}

/** Next visit that should accept customer payment (calendar-first, skips deferred series slots). */
function findNextChronologicalPayableVisit(rows: ScheduleVisitRow[]): ScheduleVisitRow | undefined {
  const dateSorted = sortScheduleRowsByDate(rows);

  for (const visit of dateSorted) {
    if (isVisitRowDoneForChronology(visit)) continue;
    if (visitRowHasHeldPayment(visit)) continue;
    if (['confirmed', 'in_progress'].includes(String(visit.status))) continue;
    if (isVisitDeferredByEarlierChronologicalVisit(visit, rows)) continue;

    const status = String(visit.status);
    if (status === 'payment_pending' || status === 'scheduled') {
      return visit;
    }
  }

  return undefined;
}

function resolvePendingPaymentVisitRow(rows: ScheduleVisitRow[]): ScheduleVisitRow | undefined {
  const chronoPayable = findNextChronologicalPayableVisit(rows);
  if (chronoPayable?.status === 'payment_pending') {
    return chronoPayable;
  }
  return rows.find((visit) => {
    if (visit.status !== 'payment_pending') return false;
    if (visitRowHasHeldPayment(visit)) return false;
    return !isVisitDeferredByEarlierChronologicalVisit(visit, rows);
  });
}

function resolveEscrowRecordId(escrow: Record<string, unknown> | null | undefined): string {
  if (!escrow) return '';
  return String(escrow.escrowId || escrow.id || '').trim();
}

function readEscrowMetadataVisitId(
  escrow: Record<string, unknown> | null | undefined,
): string {
  if (!escrow) return '';
  const metadata = (escrow.metadata || escrow.meta || {}) as Record<string, unknown>;
  return String(metadata.visitId || '').trim();
}

function isEscrowPaid(escrow: Record<string, unknown> | null | undefined): boolean {
  if (!escrow) return false;
  const paymentStatus = String(escrow.paymentStatus || '').toLowerCase();
  const status = String(escrow.status || '').toLowerCase();
  return (
    paymentStatus === 'captured' ||
    paymentStatus === 'authorized' ||
    status === 'held' ||
    status === 'released'
  );
}

async function alignEscrowVisitMetadataIfNeeded(params: {
  taskId: string;
  visitId: string;
  escrowId: string;
  escrow?: Record<string, unknown> | null;
}): Promise<void> {
  const metaVisitId = readEscrowMetadataVisitId(params.escrow);
  if (metaVisitId === params.visitId) return;

  const reassign = await PaymentClient.reassignRecurringVisitEscrow({
    escrowId: params.escrowId,
    taskId: params.taskId,
    fromVisitId: metaVisitId || params.visitId,
    toVisitId: params.visitId,
  });
  if (!reassign.success) {
    logger.warn('[RecurringVisitService] Failed to align escrow visit metadata', {
      taskId: params.taskId,
      visitId: params.visitId,
      escrowId: params.escrowId,
      error: reassign.error,
    });
  }
}

async function resolvePaidEscrowForVisit(
  taskId: string,
  visitId: string,
  options?: { rowEscrowId?: string; alignMissingVisitMetadata?: boolean },
): Promise<{ escrowId: string; escrow: Record<string, unknown> } | null> {
  const byVisit = (await PaymentClient.getEscrowByTaskIdAndVisitId(taskId, visitId)) as
    | Record<string, unknown>
    | null;
  if (isEscrowPaid(byVisit)) {
    const escrowId = resolveEscrowRecordId(byVisit);
    if (escrowId) return { escrowId, escrow: byVisit! };
  }

  const rowEscrowId = String(options?.rowEscrowId || '').trim();
  if (rowEscrowId) {
    const byRowEscrowId = (await PaymentClient.getEscrowByEscrowId(rowEscrowId)) as
      | Record<string, unknown>
      | null;
    if (isEscrowPaid(byRowEscrowId)) {
      const escrowRecord = byRowEscrowId as Record<string, unknown>;
      const escrowTaskId = String(escrowRecord.taskId || '').trim();
      if (!escrowTaskId || escrowTaskId === taskId) {
        const metaVisitId = readEscrowMetadataVisitId(escrowRecord);
        if (!metaVisitId || metaVisitId === visitId) {
          const escrowId = resolveEscrowRecordId(escrowRecord);
          if (escrowId) {
            if (!metaVisitId && options?.alignMissingVisitMetadata) {
              await alignEscrowVisitMetadataIfNeeded({
                taskId,
                visitId,
                escrowId,
                escrow: escrowRecord,
              });
            }
            return { escrowId, escrow: escrowRecord };
          }
        }
      }
    }
  }

  // Assignment payment may be stored against taskId before visit metadata is indexed.
  const byTask = (await PaymentClient.getEscrowByTaskId(taskId)) as
    | Record<string, unknown>
    | null;
  if (!isEscrowPaid(byTask)) return null;

  const metaVisitId = readEscrowMetadataVisitId(byTask);
  if (metaVisitId && metaVisitId !== visitId) return null;

  const escrowId = resolveEscrowRecordId(byTask);
  if (!escrowId) return null;

  if (rowEscrowId && rowEscrowId !== escrowId) return null;

  if (!metaVisitId && options?.alignMissingVisitMetadata) {
    await alignEscrowVisitMetadataIfNeeded({
      taskId,
      visitId,
      escrowId,
      escrow: byTask as Record<string, unknown>,
    });
  }

  return { escrowId, escrow: byTask as Record<string, unknown> };
}

/** Resolve held escrow for a visit before reschedule payment transfer (row + payment service). */
async function resolveVisitHeldEscrowForRescheduleTransfer(
  taskId: string,
  visit: ScheduleVisitRow,
): Promise<{ escrowId: string; paidAt: Date; amount?: number } | null> {
  const escrowFromRow = String(visit.escrowId || '').trim();
  if (visitRowHasHeldPayment(visit) && escrowFromRow) {
    return {
      escrowId: escrowFromRow,
      paidAt: visit.paidAt ? new Date(visit.paidAt) : new Date(),
      amount: visit.amount,
    };
  }

  const paidEscrow = await resolvePaidEscrowForVisit(taskId, visit.visitId, {
    rowEscrowId: String(visit.escrowId || ''),
    alignMissingVisitMetadata: true,
  });
  if (paidEscrow) {
    return {
      escrowId: paidEscrow.escrowId,
      paidAt: visit.paidAt ? new Date(visit.paidAt) : new Date(),
      amount: visit.amount,
    };
  }

  const status = String(visit.status || '');
  const hasAssignmentPaymentIntent =
    ['confirmed', 'in_progress', 'payment_pending'].includes(status) &&
    Boolean(visit.childTaskId || visit.assigneeId);
  if (!hasAssignmentPaymentIntent) return null;

  const byTask = await safeGetTaskEscrowRecord(taskId);
  if (!byTask || !isEscrowPaid(byTask)) return null;

  const metaVisitId = readEscrowMetadataVisitId(byTask);
  if (metaVisitId && metaVisitId !== visit.visitId) return null;

  const escrowId = resolveEscrowRecordId(byTask);
  if (!escrowId) return null;

  return {
    escrowId,
    paidAt: visit.paidAt ? new Date(visit.paidAt) : new Date(),
    amount: visit.amount,
  };
}

function visitRowHasHeldPayment(visit: ScheduleVisitRow): boolean {
  const paymentStatus = String(visit.paymentStatus || '');
  const hasPaidAt = Boolean(visit.paidAt);
  const hasEscrow = Boolean(String(visit.escrowId || '').trim());
  if (paymentStatus === 'held' || paymentStatus === 'released') {
    return hasPaidAt && hasEscrow;
  }
  return hasPaidAt && hasEscrow;
}

/** Visits that have not started work and can reopen when the tasker leaves the plan. */
function isVisitReopenedOnTaskerLeave(status: string): boolean {
  return ['scheduled', 'payment_pending', 'confirmed'].includes(status);
}

/**
 * Cancelled child tasks from tasker-leave are kept for history. Only infer visit
 * cancellation when the cancelled child is still the visit's linked child.
 */
function shouldInferVisitCancelledFromChildTask(
  visit: ScheduleVisitRow,
  cancelledChildId: string,
): boolean {
  const visitStatus = String(visit.status || '');
  if (visitStatus === 'scheduled') return false;

  const linkedChildId = visit.childTaskId ? String(visit.childTaskId) : '';
  if (linkedChildId && linkedChildId !== cancelledChildId) {
    return false;
  }

  if (['confirmed', 'payment_pending', 'in_progress'].includes(visitStatus)) {
    if (visitRowHasHeldPayment(visit)) return false;
    if (visit.assigneeId) return false;
  }

  return true;
}

function mapTaskProgressToVisitStatus(taskStatus: string): VisitStatus | null {
  const status = String(taskStatus || '').toLowerCase();
  if (status === 'started' || status === 'in_progress' || status === 'review') {
    return 'in_progress';
  }
  return null;
}

export class RecurringVisitService {
  /** 1-based visit number for notifications (position in plan schedule, not stale visitIndex). */
  static resolveVisitDisplayNumber(parent: ITask, visit: ScheduleVisitRow): number {
    const rows = sortScheduleRows(getScheduleRows(parent));
    const idx = rows.findIndex((row) => row.visitId === visit.visitId);
    if (idx >= 0) return idx + 1;
    return typeof visit.visitIndex === 'number' && visit.visitIndex >= 1 ? visit.visitIndex : 1;
  }

  static resolveVisitWorkTitle(parent: ITask, visit: ScheduleVisitRow): string {
    const base = stripRecurringPlanTitleSuffix(String(parent.title || 'Work')) || 'Work';
    const visitNumber = RecurringVisitService.resolveVisitDisplayNumber(parent, visit);
    return `${base} · Visit ${visitNumber}`;
  }

  static async resolveStartOtpWorkTitle(
    task: ITask,
  ): Promise<{ workTitle: string; visitNumber?: number }> {
    const fallback = String(task.title || 'Work');
    if (!task.parentTaskId || !task.recurringVisitId) {
      return { workTitle: fallback };
    }

    const parent = await Task.findById(task.parentTaskId);
    if (!parent || !isRecurringVisitPlanTask(parent as unknown as Record<string, unknown>)) {
      return { workTitle: fallback };
    }

    const visit = findVisit(parent, String(task.recurringVisitId));
    if (!visit) {
      return { workTitle: fallback };
    }

    const visitNumber = RecurringVisitService.resolveVisitDisplayNumber(parent, visit);
    return {
      workTitle: RecurringVisitService.resolveVisitWorkTitle(parent, visit),
      visitNumber,
    };
  }

  static applyPlanOnCreate(
    taskPayload: Record<string, unknown>,
    taskData: Record<string, unknown>,
    meta: RecurringMetaPayload,
  ): void {
    const rawStart = (taskData.recurring as { startDate?: Date })?.startDate || taskData.scheduledDate;
    if (!rawStart) {
      throw new BadRequestError('Recurring tasks require a start date');
    }
    const startDate = parseIncomingCalendarDate(rawStart);
    const rawEnd = (taskData.recurring as { endDate?: Date })?.endDate;
    const endDate = rawEnd ? parseIncomingCalendarDate(rawEnd) : undefined;

    const budgetAmount =
      typeof (taskData.budget as { amount?: number })?.amount === 'number'
        ? (taskData.budget as { amount: number }).amount
        : 0;

    const bufferSize = DEFAULT_RECURRING_VISIT_BUFFER_SIZE;

    const scheduleConfig = buildScheduleConfigFromMeta(meta, startDate, endDate);
    let totalPlanned: number | undefined;
    if (meta.endType === 'end_on_date') {
      try {
        totalPlanned = validateRecurringPlanOccurrences(scheduleConfig);
      } catch (error) {
        throw new BadRequestError(
          error instanceof Error ? error.message : 'Invalid recurring schedule',
        );
      }
    }

    const recurringPlan: Record<string, unknown> = {
      planVersion: 2,
      status: 'draft',
      pattern: meta.pattern,
      selectedWeekdays: meta.selectedWeekdays || [],
      endType: meta.endType,
      endDate: meta.endType === 'end_on_date' ? endDate : undefined,
      visitTime: meta.visitTime,
      expectedDurationMinutes: meta.expectedDurationMinutes,
      budgetPerVisit: budgetAmount,
      materializedBufferSize: bufferSize,
      totalPlanned,
      completedVisitCount: 0,
      consecutiveUnpaidCount: 0,
      nextVisitIndex: 1,
    };
    markPlanCollectionStorage(recurringPlan);

    taskPayload.recurringPlan = recurringPlan;
    taskPayload.schedule = [];
    taskPayload.scheduledDate = startDate;
    if (meta.visitTime) {
      taskPayload.scheduledTimeStart = meta.visitTime;
      taskPayload.scheduledTimeEnd = addMinutesToTimeLabel(
        meta.visitTime,
        meta.expectedDurationMinutes || 60,
      );
    }
    taskPayload.estimatedDuration = meta.expectedDurationMinutes;

    (taskPayload as { _pendingVisitMeta?: RecurringMetaPayload })._pendingVisitMeta = meta;
    (taskPayload as { _pendingVisitStartDate?: Date })._pendingVisitStartDate = startDate;
    (taskPayload as { _pendingVisitEndDate?: Date | undefined })._pendingVisitEndDate = endDate;
  }

  /** Materialize initial visit buffer into RecurringVisit collection after parent Task is created. */
  static async materializeInitialVisitBuffer(
    task: ITask,
    meta: RecurringMetaPayload,
    startDate: Date,
    endDate?: Date,
  ): Promise<void> {
    if (!shouldWriteCollection(task)) return;
    await RecurringVisitService.ensureMaterializedBuffer(String(task._id), {
      allowPaused: true,
      initialMeta: meta,
      initialStartDate: startDate,
      initialEndDate: endDate,
    });
  }

  static isVisitPlanTask(task: Record<string, unknown> | ITask | null | undefined): boolean {
    return isRecurringVisitPlanTask(task as Record<string, unknown>);
  }

  static async activatePlanOnApplicationAccept(params: {
    task: ITask;
    applicationId: string;
    applicantProfileId: mongoose.Types.ObjectId;
    applicantUid: string;
    acceptedAmount: number;
    /** Visit the poster paid for before accept (assignment payment = Visit 1). */
    preferredVisitId?: string;
    /** Escrow captured during accept-and-pay (assignment payment = Visit 1). */
    assignmentEscrowId?: string;
  }): Promise<{
    visitId: string;
    amount: number;
    paymentDeadline?: Date;
    childTaskId?: string;
    paymentConfirmed?: boolean;
  }> {
    const {
      task,
      applicationId,
      applicantProfileId,
      applicantUid,
      acceptedAmount,
      preferredVisitId,
      assignmentEscrowId,
    } = params;

    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Task is not a recurring visit plan');
    }

    await hydrateTaskVisitsOntoSchedule(task);
    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (plan.status !== 'draft' && plan.status !== 'active') {
      throw new BadRequestError('Recurring plan is not available for assignment');
    }

    const rows = getScheduleRows(task);
    const now = new Date();
    const taskId = task._id.toString();

    let firstVisit: ScheduleVisitRow | undefined;
    let paidEscrowForVisit: { escrowId: string; escrow: Record<string, unknown> } | null =
      null;

    const assignmentEscrowIdTrimmed = String(assignmentEscrowId || '').trim();
    if (assignmentEscrowIdTrimmed) {
      const byAssignmentEscrow = (await PaymentClient.getEscrowByEscrowId(
        assignmentEscrowIdTrimmed,
      )) as Record<string, unknown> | null;
      if (isEscrowPaid(byAssignmentEscrow)) {
        paidEscrowForVisit = {
          escrowId: assignmentEscrowIdTrimmed,
          escrow: byAssignmentEscrow as Record<string, unknown>,
        };
      }
    }

    const preferredVisit = preferredVisitId
      ? rows.find((visit) => visit.visitId === preferredVisitId)
      : undefined;
    if (
      preferredVisit &&
      !VISIT_TERMINAL_STATUSES.has(preferredVisit.status as VisitStatus)
    ) {
      firstVisit = preferredVisit;
      if (paidEscrowForVisit) {
        const metaVisitId = readEscrowMetadataVisitId(paidEscrowForVisit.escrow);
        if (metaVisitId && metaVisitId !== preferredVisit.visitId) {
          await alignEscrowVisitMetadataIfNeeded({
            taskId,
            visitId: preferredVisit.visitId,
            escrowId: paidEscrowForVisit.escrowId,
            escrow: paidEscrowForVisit.escrow,
          });
        } else if (!metaVisitId) {
          await alignEscrowVisitMetadataIfNeeded({
            taskId,
            visitId: preferredVisit.visitId,
            escrowId: paidEscrowForVisit.escrowId,
            escrow: paidEscrowForVisit.escrow,
          });
        }
      } else {
        const paidEscrow = await resolvePaidEscrowForVisit(taskId, preferredVisit.visitId, {
          alignMissingVisitMetadata: true,
        });
        if (paidEscrow) {
          paidEscrowForVisit = paidEscrow;
        }
      }
    }

    if (!firstVisit) {
      const sortedRows = sortScheduleRowsByDate(rows);
      for (const visit of sortedRows) {
        if (VISIT_TERMINAL_STATUSES.has(visit.status as VisitStatus)) continue;
        if (await isVisitWorkFinishedForAssignment(task, visit, sortedRows)) continue;
        if (isVisitDeferredByEarlierChronologicalVisit(visit, rows)) continue;
        if (!visitRowHasHeldPayment(visit)) continue;
        const paidEscrow = await resolvePaidEscrowForVisit(taskId, visit.visitId);
        if (paidEscrow) {
          firstVisit = visit;
          paidEscrowForVisit = paidEscrow;
          break;
        }
      }
    }

    if (!firstVisit && preferredVisit) {
      const sortedRows = sortScheduleRowsByDate(rows);
      const workFinished = await isVisitWorkFinishedForAssignment(
        task,
        preferredVisit,
        sortedRows,
      );
      if (
        !workFinished &&
        !VISIT_TERMINAL_STATUSES.has(preferredVisit.status as VisitStatus)
      ) {
        firstVisit = preferredVisit;
      }
    }

    if (!firstVisit) {
      firstVisit = findNextChronologicalPayableVisit(rows);
    }
    if (!firstVisit) {
      const sortedRows = sortScheduleRowsByDate(rows);
      for (const visit of sortedRows) {
        if (VISIT_TERMINAL_STATUSES.has(visit.status as VisitStatus)) continue;
        if (await isVisitWorkFinishedForAssignment(task, visit, sortedRows)) continue;
        firstVisit = visit;
        break;
      }
    }
    if (!firstVisit) {
      throw new BadRequestError('No upcoming visits available in the recurring plan');
    }

    if (!paidEscrowForVisit) {
      paidEscrowForVisit = await resolvePaidEscrowForVisit(taskId, firstVisit.visitId, {
        rowEscrowId: String(firstVisit.escrowId || ''),
        alignMissingVisitMetadata: true,
      });
    }

    firstVisit.amount = acceptedAmount;
    firstVisit.assigneeId = applicantProfileId;
    firstVisit.assigneeUid = applicantUid;
    firstVisit.updatedAt = now;

    if (paidEscrowForVisit) {
      firstVisit.status = 'confirmed';
      firstVisit.paymentStatus = 'held';
      firstVisit.escrowId = paidEscrowForVisit.escrowId;
      firstVisit.paidAt = firstVisit.paidAt ?? now;

      const metaVisitId = readEscrowMetadataVisitId(paidEscrowForVisit.escrow);
      if (!metaVisitId || metaVisitId !== firstVisit.visitId) {
        const reassign = await PaymentClient.reassignRecurringVisitEscrow({
          escrowId: paidEscrowForVisit.escrowId,
          taskId,
          fromVisitId: metaVisitId || firstVisit.visitId,
          toVisitId: firstVisit.visitId,
        });
        if (!reassign.success) {
          logger.warn('Failed to align assignment escrow to first visit', {
            taskId,
            fromVisitId: metaVisitId,
            toVisitId: firstVisit.visitId,
            error: reassign.error,
          });
        }
      }
    } else {
      firstVisit.status = 'payment_pending';
      firstVisit.paymentStatus = 'pending';
      firstVisit.escrowId = undefined;
      firstVisit.paidAt = undefined;
      firstVisit.paymentDeadline = getPaymentDeadline(new Date(firstVisit.date));
    }

    plan.status = 'active';
    plan.taskerProfileId = applicantProfileId;
    plan.taskerUid = applicantUid;
    plan.acceptedApplicationId = new mongoose.Types.ObjectId(applicationId);
    plan.budgetPerVisit = acceptedAmount;

    (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
    task.assigneeId = applicantProfileId;
    (task as unknown as { assigneeUid?: string }).assigneeUid = applicantUid;
    task.status = 'assigned';
    task.assignedAt = now;
    task.updatedAt = now;

    await RecurringVisitService.ensureChildTaskForVisit(task, firstVisit);
    (task as unknown as { activeVisitId?: string }).activeVisitId = firstVisit.visitId;

    await saveRecurringPlanDocument(task, task._id.toString(), rows);
    await RecurringVisitService.ensureMaterializedBuffer(task._id.toString());

    await TaskApplication.updateMany(
      {
        taskId: task._id,
        _id: { $ne: applicationId },
        status: 'pending',
      },
      { status: 'rejected' },
    );

    const paymentConfirmed = Boolean(paidEscrowForVisit);

    logger.info('Recurring visit plan activated on accept', {
      taskId: task._id.toString(),
      visitId: firstVisit.visitId,
      applicationId,
      paymentConfirmed,
    });

    return {
      visitId: firstVisit.visitId,
      amount: acceptedAmount,
      paymentDeadline: firstVisit.paymentDeadline,
      childTaskId: firstVisit.childTaskId?.toString() || '',
      paymentConfirmed,
    };
  }

  static async confirmVisitPayment(params: {
    parentTaskId: string;
    visitId: string;
    escrowId: string;
    requesterProfileId: mongoose.Types.ObjectId;
  }): Promise<{ childTaskId: string }> {
    const task = await Task.findById(params.parentTaskId);
    if (!task) throw new NotFoundError('Task not found');

    await hydrateTaskVisitsOntoSchedule(task);

    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized to confirm this visit payment');
    }

    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan task');
    }

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (String(plan?.status || '').toLowerCase() === 'paused') {
      throw new BadRequestError('Recurring plan is paused');
    }

    const visit = findVisit(task, params.visitId);
    if (!visit) throw new NotFoundError('Visit not found');

    if (visit.status === 'completed') {
      throw new BadRequestError('Visit already completed');
    }

    let paidEscrow = await resolvePaidEscrowForVisit(params.parentTaskId, params.visitId, {
      rowEscrowId: String(visit.escrowId || params.escrowId || ''),
      alignMissingVisitMetadata: true,
    });
    let resolvedEscrowId = String(
      paidEscrow?.escrowId || params.escrowId || '',
    ).trim();

    if (!paidEscrow && resolvedEscrowId) {
      const byEscrowId = (await PaymentClient.getEscrowByEscrowId(resolvedEscrowId)) as
        | Record<string, unknown>
        | null;
      if (isEscrowPaid(byEscrowId)) {
        const metaVisitId = readEscrowMetadataVisitId(byEscrowId);
        if (!metaVisitId || metaVisitId === params.visitId) {
          if (!metaVisitId) {
            await alignEscrowVisitMetadataIfNeeded({
              taskId: params.parentTaskId,
              visitId: params.visitId,
              escrowId: resolvedEscrowId,
              escrow: byEscrowId,
            });
          }
          paidEscrow = {
            escrowId: resolvedEscrowId,
            escrow: byEscrowId as Record<string, unknown>,
          };
        }
      }
    }

    if (!resolvedEscrowId) {
      throw new BadRequestError('Valid escrow payment is required for this visit');
    }

    const hasMatchingPaidEscrow = Boolean(
      paidEscrow && paidEscrow.escrowId === resolvedEscrowId,
    );

    const alreadyConfirmed =
      (visitRowHasHeldPayment(visit) || hasMatchingPaidEscrow) &&
      ['confirmed', 'in_progress'].includes(String(visit.status)) &&
      (!resolvedEscrowId ||
        !String(visit.escrowId || '').trim() ||
        String(visit.escrowId || '') === resolvedEscrowId ||
        hasMatchingPaidEscrow);
    if (alreadyConfirmed) {
      invalidateTaskDetailCache(params.parentTaskId);
      return { childTaskId: visit.childTaskId?.toString() || '' };
    }

    const staleHeldDifferentEscrow =
      visitRowHasHeldPayment(visit) &&
      String(visit.escrowId || '').trim() !== resolvedEscrowId;
    const visitStatus = String(visit.status || '');

    const canConfirm =
      visitStatus === 'payment_pending' ||
      (hasMatchingPaidEscrow &&
        (staleHeldDifferentEscrow ||
          !visitRowHasHeldPayment(visit) ||
          ['scheduled', 'payment_pending'].includes(visitStatus)));

    if (!canConfirm) {
      throw new BadRequestError('Visit is not awaiting payment');
    }

    const now = new Date();
    visit.status = 'confirmed';
    visit.paymentStatus = 'held';
    visit.escrowId = resolvedEscrowId;
    visit.paidAt = visit.paidAt ?? now;
    visit.updatedAt = now;

    const child = await RecurringVisitService.ensureChildTaskForVisit(task, visit);

    visit.childTaskId = child._id;
    (task as unknown as { activeVisitId?: string }).activeVisitId = visit.visitId;
    const rows = getScheduleRows(task);
    const rowIdx = rows.findIndex((r) => r.visitId === visit.visitId);
    if (rowIdx >= 0) rows[rowIdx] = visit;
    await saveRecurringPlanDocument(task, params.parentTaskId, rows);

    await RecurringVisitService.notifyTaskerRecurringVisitPaymentConfirmed(
      task,
      visit,
      child._id.toString(),
    );

    return { childTaskId: child._id.toString() };
  }

  /** Notify assigned helper when customer payment for a specific visit is confirmed. */
  private static async notifyTaskerRecurringVisitPaymentConfirmed(
    task: ITask,
    visit: ScheduleVisitRow,
    childTaskId: string,
  ): Promise<void> {
    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const taskerUid = String(
      visit.assigneeUid ||
        plan?.taskerUid ||
        (task as unknown as { assigneeUid?: string }).assigneeUid ||
        '',
    ).trim();
    if (!taskerUid) return;

    const parentTaskId = task._id.toString();
    const visitNumber = RecurringVisitService.resolveVisitDisplayNumber(task, visit);
    const visitLabel = `Visit ${visitNumber}`;
    const title = 'Visit payment received';
    const body = `The customer has paid for ${visitLabel}. You can start when it's scheduled.`;
    const notificationData = {
      taskId: childTaskId || parentTaskId,
      parentTaskId,
      visitId: visit.visitId,
      visitNumber: String(visitNumber),
      type: 'recurring_visit_payment_confirmed',
      status: 'confirmed',
    };

    try {
      await NotificationClient.send({
        eventKey: 'TASK_UPDATED',
        category: 'taskUpdates',
        actorId: String(task.requesterUid || ''),
        recipients: [taskerUid],
        entity: { type: 'task', id: parentTaskId },
        title,
        body,
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit payment push notification to tasker', {
        parentTaskId,
        visitId: visit.visitId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await InAppNotificationClient.send({
        userId: taskerUid,
        title,
        body,
        type: 'success',
        category: 'payments',
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit payment in-app notification to tasker', {
        parentTaskId,
        visitId: visit.visitId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private static formatRecurringVisitDateLabel(
    date: Date,
    scheduledTimeStart?: string,
  ): string {
    const dateLabel = normalizeDateOnly(date).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const time = String(scheduledTimeStart || '').trim();
    return time ? `${dateLabel} · ${time}` : dateLabel;
  }

  /** Notify customer when assigned helper requests to reschedule a visit. */
  private static async notifyCustomerRecurringVisitRescheduleRequested(
    task: ITask,
    visit: ScheduleVisitRow,
    params: { newDate: Date; scheduledTimeStart?: string },
  ): Promise<void> {
    const customerUid = String(task.requesterUid || '').trim();
    if (!customerUid) return;

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const parentTaskId = task._id.toString();
    const visitNumber = RecurringVisitService.resolveVisitDisplayNumber(task, visit);
    const visitLabel = `Visit ${visitNumber}`;
    const newDateLabel = RecurringVisitService.formatRecurringVisitDateLabel(
      params.newDate,
      params.scheduledTimeStart,
    );
    const title = 'Reschedule request';
    const body = `Your helper requested to move ${visitLabel} to ${newDateLabel}. Open the task to approve, reject, or cancel the visit.`;
    const notificationData = {
      taskId: parentTaskId,
      parentTaskId,
      visitId: visit.visitId,
      visitNumber: String(visitNumber),
      type: 'recurring_visit_reschedule_request',
      status: 'pending',
    };

    try {
      await NotificationClient.send({
        eventKey: 'TASK_UPDATED',
        category: 'taskUpdates',
        actorId: String(plan?.taskerUid || task.assigneeUid || ''),
        recipients: [customerUid],
        entity: { type: 'task', id: parentTaskId },
        title,
        body,
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit reschedule request push notification', {
        parentTaskId,
        visitId: visit.visitId,
        customerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await InAppNotificationClient.send({
        userId: customerUid,
        title,
        body,
        type: 'info',
        category: 'taskUpdates',
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit reschedule request in-app notification', {
        parentTaskId,
        visitId: visit.visitId,
        customerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Notify customer when assigned helper requests to cancel a visit (until-cancelled plans). */
  private static async notifyCustomerRecurringVisitCancelRequested(
    task: ITask,
    visit: ScheduleVisitRow,
    params?: { reason?: string },
  ): Promise<void> {
    const customerUid = await RecurringVisitService.resolveTaskRequesterUid(task);
    if (!customerUid) {
      logger.warn('Skipping recurring visit cancel request notification — customer uid missing', {
        parentTaskId: task._id.toString(),
        visitId: visit.visitId,
        requesterId: String(task.requesterId || ''),
      });
      return;
    }

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const parentTaskId = task._id.toString();
    const visitNumber = RecurringVisitService.resolveVisitDisplayNumber(task, visit);
    const visitLabel = `Visit ${visitNumber}`;
    const visitDateLabel = RecurringVisitService.formatRecurringVisitDateLabel(
      new Date(visit.date),
      visit.scheduledTimeStart,
    );
    const title = 'Cancel visit request';
    const reasonSnippet = String(params?.reason || '').trim();
    const reasonSuffix = reasonSnippet
      ? ` Reason: ${reasonSnippet.length > 140 ? `${reasonSnippet.slice(0, 140)}…` : reasonSnippet}`
      : '';
    const body = `Your helper requested to cancel ${visitLabel} (${visitDateLabel}).${reasonSuffix} Open the task to cancel the visit or keep it scheduled.`;
    const notificationData = {
      taskId: parentTaskId,
      parentTaskId,
      visitId: visit.visitId,
      visitNumber: String(visitNumber),
      entityType: 'task',
      eventKey: 'TASK_UPDATED',
      type: 'recurring_visit_cancel_request',
      status: 'pending',
      reason: reasonSnippet || undefined,
    };

    try {
      await NotificationClient.send({
        eventKey: 'TASK_UPDATED',
        category: 'taskUpdates',
        actorId: String(plan?.taskerUid || task.assigneeUid || ''),
        recipients: [customerUid],
        entity: { type: 'task', id: parentTaskId },
        title,
        body,
        data: notificationData,
      });
      logger.info('Sent recurring visit cancel request push notification to customer', {
        parentTaskId,
        visitId: visit.visitId,
        customerUid,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit cancel request push notification', {
        parentTaskId,
        visitId: visit.visitId,
        customerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await InAppNotificationClient.send({
        userId: customerUid,
        title,
        body,
        type: 'info',
        category: 'taskUpdates',
        data: notificationData,
      });
      logger.info('Sent recurring visit cancel request in-app notification to customer', {
        parentTaskId,
        visitId: visit.visitId,
        customerUid,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit cancel request in-app notification', {
        parentTaskId,
        visitId: visit.visitId,
        customerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Notify assigned helper when customer reschedules a visit (directly or by approving a request). */
  private static resolveRecurringVisitTrackingTaskId(
    task: ITask,
    visit: ScheduleVisitRow,
  ): string {
    const parentTaskId = task._id.toString();
    const childOnVisit = visit.childTaskId?.toString();
    if (childOnVisit) return childOnVisit;

    const rows = sortScheduleRows(getScheduleRows(task));
    const activeChild = rows.find((row) => {
      if (!row.childTaskId) return false;
      const status = String(row.status || '');
      if (['completed', 'cancelled', 'skipped', 'skipped_unpaid'].includes(status)) {
        return false;
      }
      if (status === 'scheduled') return false;
      return visitRowHasHeldPayment(row) || status === 'payment_pending' || status === 'in_progress';
    });
    if (activeChild?.childTaskId) {
      return activeChild.childTaskId.toString();
    }

    return parentTaskId;
  }

  private static async notifyTaskerRecurringVisitRescheduled(
    task: ITask,
    visit: ScheduleVisitRow,
    params: {
      newDate: Date;
      scheduledTimeStart?: string;
      approvedRequest?: boolean;
    },
  ): Promise<void> {
    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const taskerUid = String(
      visit.assigneeUid ||
        plan?.taskerUid ||
        (task as unknown as { assigneeUid?: string }).assigneeUid ||
        '',
    ).trim();
    if (!taskerUid) return;

    const parentTaskId = task._id.toString();
    const visitNumber = RecurringVisitService.resolveVisitDisplayNumber(task, visit);
    const visitLabel = `Visit ${visitNumber}`;
    const newDateLabel = RecurringVisitService.formatRecurringVisitDateLabel(
      params.newDate,
      params.scheduledTimeStart ?? visit.scheduledTimeStart,
    );
    const title = 'Visit rescheduled';
    const body = params.approvedRequest
      ? `The customer approved your request. ${visitLabel} is now scheduled for ${newDateLabel}.`
      : `The customer rescheduled ${visitLabel} to ${newDateLabel}. Open Track Work for the updated schedule.`;
    const trackingTaskId = RecurringVisitService.resolveRecurringVisitTrackingTaskId(
      task,
      visit,
    );
    const notificationData = {
      taskId: trackingTaskId,
      parentTaskId,
      visitId: visit.visitId,
      visitNumber: String(visitNumber),
      type: 'recurring_visit_rescheduled',
      status: 'rescheduled',
    };

    try {
      await NotificationClient.send({
        eventKey: 'TASK_UPDATED',
        category: 'taskUpdates',
        actorId: String(task.requesterUid || ''),
        recipients: [taskerUid],
        entity: { type: 'task', id: parentTaskId },
        title,
        body,
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit rescheduled push notification to tasker', {
        parentTaskId,
        visitId: visit.visitId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await InAppNotificationClient.send({
        userId: taskerUid,
        title,
        body,
        type: 'info',
        category: 'taskUpdates',
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit rescheduled in-app notification to tasker', {
        parentTaskId,
        visitId: visit.visitId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Notify helper when customer rejects their reschedule request. */
  private static async notifyTaskerRecurringVisitRescheduleRejected(
    task: ITask,
    visit: ScheduleVisitRow,
  ): Promise<void> {
    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const taskerUid = String(
      visit.assigneeUid ||
        plan?.taskerUid ||
        (task as unknown as { assigneeUid?: string }).assigneeUid ||
        '',
    ).trim();
    if (!taskerUid) return;

    const parentTaskId = task._id.toString();
    const visitNumber = RecurringVisitService.resolveVisitDisplayNumber(task, visit);
    const visitLabel = `Visit ${visitNumber}`;
    const currentDateLabel = RecurringVisitService.formatRecurringVisitDateLabel(
      new Date(visit.date),
      visit.scheduledTimeStart,
    );
    const title = 'Reschedule request declined';
    const body = `The customer kept the original date for ${visitLabel} (${currentDateLabel}).`;
    const childTaskId = visit.childTaskId?.toString() || '';
    const notificationData = {
      taskId: childTaskId || parentTaskId,
      parentTaskId,
      visitId: visit.visitId,
      visitNumber: String(visitNumber),
      type: 'recurring_visit_reschedule_rejected',
      status: 'rejected',
    };

    try {
      await NotificationClient.send({
        eventKey: 'TASK_UPDATED',
        category: 'taskUpdates',
        actorId: String(task.requesterUid || ''),
        recipients: [taskerUid],
        entity: { type: 'task', id: parentTaskId },
        title,
        body,
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit reschedule rejected push notification', {
        parentTaskId,
        visitId: visit.visitId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await InAppNotificationClient.send({
        userId: taskerUid,
        title,
        body,
        type: 'info',
        category: 'taskUpdates',
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit reschedule rejected in-app notification', {
        parentTaskId,
        visitId: visit.visitId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Notify assigned helper when the customer cancels a single visit. */
  private static async notifyTaskerRecurringVisitCancelled(
    task: ITask,
    visit: ScheduleVisitRow,
  ): Promise<void> {
    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const taskerUid = String(
      visit.assigneeUid ||
        plan?.taskerUid ||
        (task as unknown as { assigneeUid?: string }).assigneeUid ||
        '',
    ).trim();
    if (!taskerUid) return;

    const parentTaskId = task._id.toString();
    const visitNumber = RecurringVisitService.resolveVisitDisplayNumber(task, visit);
    const visitLabel = `Visit ${visitNumber}`;
    const visitDateLabel = RecurringVisitService.formatRecurringVisitDateLabel(
      new Date(visit.date),
      visit.scheduledTimeStart,
    );
    const title = 'Visit cancelled';
    const body = `The customer cancelled ${visitLabel} (${visitDateLabel}). Open the task to see your updated schedule.`;
    const notificationData = {
      taskId: parentTaskId,
      parentTaskId,
      visitId: visit.visitId,
      visitNumber: String(visitNumber),
      type: 'recurring_visit_cancelled',
      status: 'cancelled',
    };

    try {
      await NotificationClient.send({
        eventKey: 'TASK_UPDATED',
        category: 'taskUpdates',
        actorId: String(task.requesterUid || ''),
        recipients: [taskerUid],
        entity: { type: 'task', id: parentTaskId },
        title,
        body,
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit cancelled push notification to tasker', {
        parentTaskId,
        visitId: visit.visitId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await InAppNotificationClient.send({
        userId: taskerUid,
        title,
        body,
        type: 'info',
        category: 'taskUpdates',
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring visit cancelled in-app notification to tasker', {
        parentTaskId,
        visitId: visit.visitId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Notify customer when the assigned helper leaves the recurring plan. */
  private static async notifyCustomerRecurringPlanTaskerLeft(
    task: ITask,
    params?: { reason?: string },
  ): Promise<void> {
    const customerUid = await RecurringVisitService.resolveTaskRequesterUid(task);
    if (!customerUid) {
      logger.warn('Skipping recurring plan tasker-left notification — customer uid missing', {
        parentTaskId: task._id.toString(),
        requesterId: String(task.requesterId || ''),
      });
      return;
    }

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const parentTaskId = task._id.toString();
    const title = 'Helper left recurring plan';
    const reasonSnippet = String(params?.reason || '').trim();
    const reasonSuffix = reasonSnippet
      ? ` Reason: ${reasonSnippet.length > 140 ? `${reasonSnippet.slice(0, 140)}…` : reasonSnippet}`
      : '';
    const body = `Your helper left this recurring plan.${reasonSuffix} Open Work Details to review your visit schedule and assign a new helper.`;
    const notificationData = {
      taskId: parentTaskId,
      parentTaskId,
      taskTitle: String(task.title || 'your task'),
      entityType: 'task',
      eventKey: 'TASK_CANCELLED_CUSTOMER',
      type: 'recurring_tasker_left_plan',
      status: 'open',
      reason: reasonSnippet || undefined,
    };

    try {
      await NotificationClient.send({
        eventKey: 'TASK_CANCELLED_CUSTOMER',
        category: 'taskUpdates',
        actorId: String(plan?.taskerUid || task.assigneeUid || ''),
        recipients: [customerUid],
        entity: { type: 'task', id: parentTaskId },
        title,
        body,
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring plan tasker-left push notification', {
        parentTaskId,
        customerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await InAppNotificationClient.send({
        userId: customerUid,
        title,
        body,
        type: 'info',
        category: 'taskUpdates',
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring plan tasker-left in-app notification', {
        parentTaskId,
        customerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // WhatsApp → customer: extrahand_work_cancelled_customer
    const taskTitle = String(task.title || 'your task');
    const waMinute = Math.floor(Date.now() / 60000);
    fireDialogWhatsAppForUser({
      uid: customerUid,
      eventKey: 'TASK_CANCELLED_CUSTOMER',
      category: 'taskUpdates',
      payload: {
        title,
        body,
        taskTitle,
        taskId: parentTaskId,
      },
      idempotencyKey:
        `eh-push:${customerUid}:TASK_CANCELLED_CUSTOMER:${parentTaskId}:${waMinute}`.slice(0, 200),
    });
    fireWhatsAppNotify({
      uid: customerUid,
      templateKey: 'wa_work_cancelled_customer',
      category: 'taskUpdates',
      templateBody: { var_1: taskTitle },
      templateButtons: taskOpenAppButton(parentTaskId),
      idempotencyKey: `cancel:${parentTaskId}:${customerUid}:tasker_left_plan`,
      metadata: {
        workId: parentTaskId,
        recipientRole: 'customer',
        metaTemplateName: 'extrahand_work_cancelled_customer',
        triggerType: 'tasker_left_recurring_plan',
      },
    });
  }

  /** Notify assigned helper when the customer ends the entire recurring plan. */
  private static async notifyTaskerRecurringPlanEndedByCustomer(
    task: ITask,
    params?: { reason?: string },
  ): Promise<void> {
    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const taskerUid = String(
      plan?.taskerUid || (task as unknown as { assigneeUid?: string }).assigneeUid || '',
    ).trim();
    if (!taskerUid) return;

    const parentTaskId = task._id.toString();
    const title = 'Recurring plan ended';
    const body =
      'The customer ended this recurring plan. Future visits will not be scheduled. Open the task for details.';
    const notificationData = {
      taskId: parentTaskId,
      parentTaskId,
      type: 'recurring_plan_ended',
      status: 'ended',
      reason: params?.reason,
    };

    try {
      await NotificationClient.send({
        eventKey: 'TASK_UPDATED',
        category: 'taskUpdates',
        actorId: String(task.requesterUid || ''),
        recipients: [taskerUid],
        entity: { type: 'task', id: parentTaskId },
        title,
        body,
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring plan ended push notification to tasker', {
        parentTaskId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await InAppNotificationClient.send({
        userId: taskerUid,
        title,
        body,
        type: 'info',
        category: 'taskUpdates',
        data: notificationData,
      });
    } catch (error) {
      logger.warn('Failed to send recurring plan ended in-app notification to tasker', {
        parentTaskId,
        taskerUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Idempotent: payment-service callback after Razorpay capture for a recurring visit. */
  static async confirmVisitPaymentFromCapture(params: {
    parentTaskId: string;
    visitId: string;
    escrowId: string;
  }): Promise<{ childTaskId: string; alreadyConfirmed: boolean; awaitingAssignment?: boolean }> {
    const task = await Task.findById(params.parentTaskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan task');
    }

    const plan = (task as unknown as { recurringPlan?: Record<string, unknown> }).recurringPlan;
    const hasAssignee = Boolean(
      task.assigneeId ||
        plan?.taskerProfileId ||
        plan?.taskerUid,
    );
    if (!hasAssignee) {
      logger.info('Recurring visit payment captured before helper assignment; deferring confirm', {
        parentTaskId: params.parentTaskId,
        visitId: params.visitId,
        escrowId: params.escrowId,
      });
      return { childTaskId: '', alreadyConfirmed: false, awaitingAssignment: true };
    }

    const visit = findVisit(task, params.visitId);
    if (!visit) throw new NotFoundError('Visit not found');

    if (
      ['confirmed', 'in_progress'].includes(String(visit.status)) &&
      visitRowHasHeldPayment(visit)
    ) {
      return {
        childTaskId: visit.childTaskId?.toString() || '',
        alreadyConfirmed: true,
      };
    }

    const result = await RecurringVisitService.confirmVisitPayment({
      parentTaskId: params.parentTaskId,
      visitId: params.visitId,
      escrowId: params.escrowId,
      requesterProfileId: task.requesterId,
    });

    return { childTaskId: result.childTaskId, alreadyConfirmed: false };
  }

  static async createChildTaskForVisit(parent: ITask, visit: ScheduleVisitRow): Promise<ITask> {
    const plan = (parent as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const visitDate = normalizeDateOnly(new Date(visit.date));

    const childPayload: Record<string, unknown> = {
      title: RecurringVisitService.resolveVisitWorkTitle(parent, visit),
      description: parent.description,
      category: parent.category,
      categorySlug: parent.categorySlug,
      categoryLabel: parent.categoryLabel,
      subcategory: parent.subcategory,
      budget: {
        amount: visit.amount ?? plan.budgetPerVisit ?? parent.budget?.amount ?? 0,
        currency: 'INR',
        type: parent.budget?.type || 'fixed',
      },
      isNegotiable: false,
      location: parent.location,
      urgency: parent.urgency,
      priority: parent.priority,
      status: 'assigned',
      requesterId: parent.requesterId,
      assigneeId: visit.assigneeId ?? parent.assigneeId,
      assigneeUid: visit.assigneeUid ?? (parent as unknown as { assigneeUid?: string }).assigneeUid,
      assignedAt: new Date(),
      scheduledDate: visitDate,
      scheduledTimeStart: visit.scheduledTimeStart,
      scheduledTimeEnd: visit.scheduledTimeEnd,
      estimatedDuration: visit.expectedDurationMinutes,
      flexibility: parent.flexibility || 'flexible',
      dateOption: 'on-date',
      parentTaskId: parent._id,
      recurringVisitId: visit.visitId,
      recurringParentPlan: false,
      tags: [`recurring_visit:${visit.visitId}`],
      images: parent.images?.slice(0, 5) || [],
      currentRevisionRound: 0,
      negotiationStatus: 'closed',
    };

    return Task.create(childPayload);
  }

  /** Each visit is its own assigned child task; created when the visit opens for payment. */
  static async ensureChildTaskForVisit(parent: ITask, visit: ScheduleVisitRow): Promise<ITask> {
    if (visit.childTaskId) {
      const existing = await Task.findById(visit.childTaskId);
      if (existing && String(existing.status || '') !== 'cancelled') {
        return existing;
      }
      visit.childTaskId = undefined;
    }

    const child = await RecurringVisitService.createChildTaskForVisit(parent, visit);
    visit.childTaskId = child._id;
    visit.updatedAt = new Date();
    if (shouldWriteCollection(parent)) {
      await RecurringVisitRepository.linkChildTask(parent._id, visit.visitId, child._id);
    }
    return child;
  }

  /** Repair visit payment + progress when escrow is paid or work has already started. */
  static async reconcilePlanState(taskId: string): Promise<void> {
    const maxAttempts = 4;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await RecurringVisitService.reconcilePlanStateOnce(taskId);
        return;
      } catch (error) {
        lastError = error;
        if (!isOptimisticConcurrencyError(error) || attempt >= maxAttempts) {
          throw error;
        }
        logger.debug('Retrying recurring plan reconcile after version conflict', {
          taskId,
          attempt,
        });
        await delay(40 * attempt);
      }
    }
    throw lastError;
  }

  /**
   * Debounced reconcile for read paths — avoids blocking GET /tasks/:id and serializes
   * concurrent reconciles for the same plan.
   */
  static scheduleReconcilePlanState(taskId: string): Promise<void> {
    const inFlight = reconcilePlanStateInFlight.get(taskId);
    if (inFlight) return inFlight;

    const run = (async () => {
      const lockKey = `recurring:reconcile:lock:${taskId}`;
      const redis = getRedisClient();
      if (redis) {
        try {
          const acquired = await redis.set(lockKey, '1', 'EX', 12, 'NX');
          if (acquired !== 'OK') return;
        } catch {
          // Proceed without distributed lock when Redis is unavailable.
        }
      }

      try {
        await RecurringVisitService.reconcilePlanState(taskId);
      } catch (error) {
        logger.warn('Recurring plan reconcile failed', {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })().finally(() => {
      reconcilePlanStateInFlight.delete(taskId);
    });

    reconcilePlanStateInFlight.set(taskId, run);
    return run;
  }

  /** Fast path: confirm any payment_pending visit that already has captured escrow. */
  static async syncPendingVisitPaymentsFromEscrow(taskId: string): Promise<boolean> {
    const task = await Task.findById(taskId);
    if (!task || !isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      return false;
    }

    await hydrateTaskVisitsOntoSchedule(task);

    let pendingRows: ScheduleVisitRow[];
    if (shouldWriteCollection(task)) {
      const fromDb = await RecurringVisitRepository.listPaymentPending(task._id);
      pendingRows = fromDb.map((doc) => mapDocToScheduleRow(doc));
    } else {
      pendingRows = getScheduleRows(task).filter((v) => v.status === 'payment_pending');
    }

    if (pendingRows.length === 0) return false;

    let changed = false;
    const concurrency = recurringVisitConfig.paymentSyncConcurrency;
    let index = 0;

    const worker = async (): Promise<void> => {
      while (index < pendingRows.length) {
        const current = index;
        index += 1;
        const visit = pendingRows[current];
        const paidEscrow = await resolvePaidEscrowForVisit(taskId, visit.visitId);
        if (!paidEscrow) continue;
        try {
          await RecurringVisitService.confirmVisitPayment({
            parentTaskId: taskId,
            visitId: visit.visitId,
            escrowId: paidEscrow.escrowId,
            requesterProfileId: task.requesterId,
          });
          changed = true;
        } catch (error) {
          logger.warn('[RecurringVisitService] Failed to sync paid visit from escrow', {
            taskId,
            visitId: visit.visitId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, pendingRows.length) }, () => worker()),
    );

    return changed;
  }

  private static async reconcilePlanStateOnce(taskId: string): Promise<void> {
    const task = await Task.findById(taskId);
    if (!task || !isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      return;
    }

    await hydrateTaskVisitsOntoSchedule(task);

    let changed = false;
    let rows = getScheduleRows(task);
    const planForRepair = (task as unknown as { recurringPlan?: Record<string, unknown> })
      .recurringPlan;

    if (planForRepair && String(planForRepair.status || '').toLowerCase() === 'ended') {
      const rowsForEndedCheck = rows.length > 0 ? rows : await loadPlanScheduleRows(task);
      if (!RecurringVisitService.recurringPlanVisitsExhausted(task, rowsForEndedCheck)) {
        planForRepair.status = 'active';
        planForRepair.endedAt = undefined;
        planForRepair.pausedReason = undefined;
        if (String(task.status || '').toLowerCase() === 'completed') {
          task.status = 'assigned';
          task.completedAt = undefined;
        }
        changed = true;
        rows = rowsForEndedCheck;
        logger.info('[RecurringVisitService] Reopened prematurely ended recurring plan', {
          taskId,
        });
      }
    }

    if (await RecurringVisitService.sanitizeOrphanedScheduleChildReferences(task, { persist: false })) {
      changed = true;
      rows = getScheduleRows(task);
    }

    for (const visit of rows) {
      const status = String(visit.status || '');
      const paymentStatus = String(visit.paymentStatus || '');
      if (
        status === 'scheduled' &&
        paymentStatus === 'not_required' &&
        visitRowHasHeldPayment(visit)
      ) {
        clearScheduleVisitHeldPaymentBinding(visit, { paymentStatus: 'not_required' });
        visit.updatedAt = new Date();
        changed = true;
        continue;
      }
      if (status === 'payment_pending') {
        if (visit.paymentStatus !== 'held' && !visit.paidAt) {
          if (visit.escrowId || visit.paymentStatus !== 'pending') {
            visit.escrowId = undefined;
            visit.paymentStatus = 'pending';
            visit.updatedAt = new Date();
            changed = true;
          }
        }
        continue;
      }
      if (status === 'in_progress' && !visitRowHasHeldPayment(visit)) {
        visit.status = 'payment_pending';
        visit.paymentStatus = 'pending';
        visit.escrowId = undefined;
        visit.paidAt = undefined;
        visit.amount = Number(
          visit.amount ?? planForRepair?.budgetPerVisit ?? task.budget?.amount ?? 0,
        );
        visit.paymentDeadline =
          visit.paymentDeadline ?? getPaymentDeadline(new Date(visit.date));
        visit.updatedAt = new Date();
        changed = true;
        continue;
      }
      if (!['confirmed', 'in_progress'].includes(status)) continue;
      const paidEscrow = await resolvePaidEscrowForVisit(taskId, visit.visitId);
      if (paidEscrow) continue;
      if (visitRowHasHeldPayment(visit)) continue;

      visit.status = 'payment_pending';
      visit.paymentStatus = 'pending';
      visit.amount = Number(
        visit.amount ?? planForRepair?.budgetPerVisit ?? task.budget?.amount ?? 0,
      );
      visit.paymentDeadline =
        visit.paymentDeadline ?? getPaymentDeadline(new Date(visit.date));
      visit.updatedAt = new Date();

      if (visit.childTaskId) {
        try {
          await Task.findByIdAndDelete(visit.childTaskId);
        } catch {
          // Best-effort cleanup for visits confirmed without a real payment.
        }
        visit.childTaskId = undefined;
      }
      changed = true;
    }

    if (changed) {
      task.schedule = rows as unknown as ITask['schedule'];
      await saveRecurringPlanDocument(task, taskId);
      rows = getScheduleRows(task);
      changed = false;
    }

    const completedChildren = await Task.find({
      parentTaskId: task._id,
      status: 'completed',
      recurringVisitId: { $exists: true, $nin: [null, ''] },
    })
      .select('recurringVisitId')
      .lean();

    for (const child of completedChildren) {
      const visitId = String(child.recurringVisitId || '').trim();
      if (!visitId) continue;
      const visit = findVisit(task, visitId);
      if (visit && visit.status !== 'completed') {
        visit.status = 'completed';
        visit.updatedAt = new Date();
        changed = true;
      }
    }

    const cancelledChildren = await Task.find({
      parentTaskId: task._id,
      status: 'cancelled',
      recurringVisitId: { $exists: true, $nin: [null, ''] },
    })
      .select('_id recurringVisitId')
      .lean();

    const cancelledChildVisitIds = new Set(
      cancelledChildren
        .map((child) => String(child.recurringVisitId || '').trim())
        .filter(Boolean),
    );

    for (const visit of rows) {
      if (String(visit.status) !== 'cancelled') continue;
      if (visit.skippedAt || visit.skipReason) continue;
      if (!visit.visitId || !cancelledChildVisitIds.has(visit.visitId)) continue;

      visit.status = 'scheduled';
      if (!visitRowHasHeldPayment(visit)) {
        visit.paymentStatus = 'pending';
        visit.escrowId = undefined;
        visit.paidAt = undefined;
      }
      visit.childTaskId = undefined;
      visit.updatedAt = new Date();
      changed = true;
    }

    for (const child of cancelledChildren) {
      const visitId = String(child.recurringVisitId || '').trim();
      if (!visitId) continue;
      const visit = findVisit(task, visitId);
      if (
        visit &&
        visit.status !== 'completed' &&
        !VISIT_TERMINAL_STATUSES.has(visit.status as VisitStatus) &&
        shouldInferVisitCancelledFromChildTask(visit, String(child._id))
      ) {
        visit.status = 'cancelled';
        visit.updatedAt = new Date();
        changed = true;
      }
    }

    const activeVisitId = (task as unknown as { activeVisitId?: string }).activeVisitId;
    if (activeVisitId) {
      const activeVisit = findVisit(task, activeVisitId);
      if (
        activeVisit?.status === 'completed' ||
        activeVisit?.status === 'cancelled' ||
        activeVisit?.status === 'cancelled_late'
      ) {
        (task as unknown as { activeVisitId?: string }).activeVisitId = undefined;
        changed = true;
      }
    }

    if (changed) {
      task.schedule = rows as unknown as ITask['schedule'];
      await saveRecurringPlanDocument(task, taskId);
      rows = getScheduleRows(task);
      changed = false;
    }

    const planForVerify = (task as unknown as { recurringPlan?: { completedVisitCount?: number; budgetPerVisit?: number } })
      .recurringPlan;
    const sortedForVerify = [...rows].sort(
      (a, b) =>
        (a.visitIndex ?? 0) - (b.visitIndex ?? 0) ||
        normalizeDateOnly(new Date(a.date)).getTime() -
          normalizeDateOnly(new Date(b.date)).getTime(),
    );

    for (let index = 0; index < sortedForVerify.length; index += 1) {
      const visit = sortedForVerify[index];
      const status = String(visit.status || '');
      if (status === 'completed' || VISIT_TERMINAL_STATUSES.has(status as VisitStatus)) {
        continue;
      }

      const claimsPaid =
        visit.paymentStatus === 'held' ||
        visit.paymentStatus === 'released' ||
        visitRowHasHeldPayment(visit);

      if (!claimsPaid && status !== 'payment_pending') {
        continue;
      }

      const paidEscrow = await resolvePaidEscrowForVisit(taskId, visit.visitId, {
        rowEscrowId: String(visit.escrowId || ''),
        alignMissingVisitMetadata: visitRowHasHeldPayment(visit),
      });
      if (paidEscrow) {
        if (
          visitRowHasHeldPayment(visit) &&
          (visit.paymentStatus !== 'held' || String(visit.escrowId || '') !== paidEscrow.escrowId)
        ) {
          visit.paymentStatus = 'held';
          visit.escrowId = paidEscrow.escrowId;
          visit.paidAt = visit.paidAt ?? new Date();
          visit.updatedAt = new Date();
          changed = true;
        }
        if (
          visitRowHasHeldPayment(visit) &&
          ['scheduled', 'payment_pending'].includes(status)
        ) {
          visit.status = 'confirmed';
          visit.updatedAt = new Date();
          changed = true;
        }
        continue;
      }

      if (visitRowHasHeldPayment(visit) && visit.escrowId) {
        await alignEscrowVisitMetadataIfNeeded({
          taskId,
          visitId: visit.visitId,
          escrowId: String(visit.escrowId),
        });
        const repaired = await resolvePaidEscrowForVisit(taskId, visit.visitId, {
          rowEscrowId: String(visit.escrowId),
        });
        if (repaired) {
          visit.paymentStatus = 'held';
          visit.escrowId = repaired.escrowId;
          visit.paidAt = visit.paidAt ?? new Date();
          if (visit.status === 'payment_pending' || visit.status === 'scheduled') {
            visit.status = 'confirmed';
          }
          visit.updatedAt = new Date();
          changed = true;
          continue;
        }
      }

      if (isVisitDeferredByEarlierChronologicalVisit(visit, rows)) {
        if (status === 'payment_pending') {
          visit.status = 'scheduled';
          visit.paymentStatus = 'not_required';
          visit.paymentDeadline = undefined;
          visit.updatedAt = new Date();
          changed = true;
        }
        continue;
      }

      const chronoPayable = findNextChronologicalPayableVisit(rows);
      if (chronoPayable?.visitId === visit.visitId && !claimsPaid) {
        if (status !== 'payment_pending') {
          visit.status = 'payment_pending';
          visit.paymentStatus = 'pending';
          visit.escrowId = undefined;
          visit.paidAt = undefined;
          visit.amount = Number(
            visit.amount ?? planForVerify?.budgetPerVisit ?? task.budget?.amount ?? 0,
          );
          visit.paymentDeadline =
            visit.paymentDeadline ?? getPaymentDeadline(new Date(visit.date));
          visit.assigneeId =
            visit.assigneeId ??
            (planForVerify as { taskerProfileId?: mongoose.Types.ObjectId })?.taskerProfileId ??
            task.assigneeId;
          visit.assigneeUid =
            visit.assigneeUid ?? String((planForVerify as { taskerUid?: string })?.taskerUid || '');
          visit.updatedAt = new Date();
          await RecurringVisitService.ensureChildTaskForVisit(task, visit);
          (task as unknown as { activeVisitId?: string }).activeVisitId = visit.visitId;
          changed = true;
        }
        continue;
      }

      if (status === 'payment_pending' && chronoPayable?.visitId !== visit.visitId) {
        visit.status = 'scheduled';
        visit.paymentStatus = 'not_required';
        visit.paymentDeadline = undefined;
        visit.updatedAt = new Date();
        changed = true;
        continue;
      }

      if (status !== 'scheduled') {
        if (claimsPaid || visitRowHasHeldPayment(visit)) {
          continue;
        }
        visit.status = 'scheduled';
        visit.paymentStatus = 'not_required';
        visit.escrowId = undefined;
        visit.paidAt = undefined;
        visit.updatedAt = new Date();
        changed = true;
      }
    }

    if (changed) {
      task.schedule = rows as unknown as ITask['schedule'];
      await saveRecurringPlanDocument(task, taskId);
      rows = getScheduleRows(task);
      changed = false;
    }

    const planForSync = (task as unknown as { recurringPlan?: Record<string, unknown> })
      .recurringPlan;
    const completedVisitCount = Number(planForSync?.completedVisitCount || 0);
    if (completedVisitCount > 0) {
      const sortedForSync = [...rows].sort(
        (a, b) =>
          (a.visitIndex ?? 0) - (b.visitIndex ?? 0) ||
          normalizeDateOnly(new Date(a.date)).getTime() -
            normalizeDateOnly(new Date(b.date)).getTime(),
      );
      for (let index = 0; index < sortedForSync.length && index < completedVisitCount; index += 1) {
        const visit = sortedForSync[index];
        if (visit.status === 'scheduled' || visit.status === 'payment_pending') {
          continue;
        }
        if (
          visit.status !== 'completed' &&
          visit.status !== 'cancelled' &&
          visit.status !== 'skipped' &&
          visit.status !== 'skipped_unpaid'
        ) {
          visit.status = 'completed';
          visit.updatedAt = new Date();
          changed = true;
        }
      }
      if (changed) {
        task.schedule = rows as unknown as ITask['schedule'];
        await saveRecurringPlanDocument(task, taskId);
        rows = getScheduleRows(task);
        changed = false;
      }
    }

    const pending = rows.find((v) => v.status === 'payment_pending');
    if (pending) {
      const paidEscrow = await resolvePaidEscrowForVisit(taskId, pending.visitId);
      if (paidEscrow) {
        try {
          await RecurringVisitService.confirmVisitPayment({
            parentTaskId: taskId,
            visitId: pending.visitId,
            escrowId: paidEscrow.escrowId,
            requesterProfileId: task.requesterId,
          });
          changed = true;
        } catch (error) {
          logger.warn('Failed to auto-confirm recurring visit payment during reconcile', {
            taskId,
            visitId: pending.visitId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const freshTask = changed ? await Task.findById(taskId) : task;
    if (!freshTask) return;

    const misplacedRepaired =
      await RecurringVisitService.repairMisplacedHeldPaymentsAfterReschedule(freshTask);
    if (misplacedRepaired) {
      changed = true;
    }

    const taskAfterMisplacedRepair = misplacedRepaired ? await Task.findById(taskId) : freshTask;
    if (!taskAfterMisplacedRepair) return;

    const plan = (taskAfterMisplacedRepair as unknown as { recurringPlan?: { status?: string } })
      .recurringPlan;
    if (plan?.status === 'active') {
      const syncedRows = getScheduleRows(taskAfterMisplacedRepair);
      const hasPendingPayment = syncedRows.some((v) => v.status === 'payment_pending');
      const completedCount = Number(
        (
          taskAfterMisplacedRepair as unknown as {
            recurringPlan?: { completedVisitCount?: number };
          }
        ).recurringPlan?.completedVisitCount || 0,
      );
      const sortedRows = [...syncedRows].sort(
        (a, b) =>
          (a.visitIndex ?? 0) - (b.visitIndex ?? 0) ||
          normalizeDateOnly(new Date(a.date)).getTime() -
            normalizeDateOnly(new Date(b.date)).getTime(),
      );
      const activeVisitId = String(
        (taskAfterMisplacedRepair as unknown as { activeVisitId?: string }).activeVisitId || '',
      ).trim();
      let hasOpenVisitWork = false;
      for (const visit of sortedRows) {
        const status = String(visit.status);
        if (!['confirmed', 'in_progress'].includes(status)) continue;
        if (
          !visit.escrowId &&
          visit.paymentStatus !== 'held' &&
          !visit.paidAt
        ) {
          continue;
        }
        if (activeVisitId && visit.visitId !== activeVisitId) continue;
        if (visit.childTaskId) {
          const child = await Task.findById(visit.childTaskId).select('status').lean();
          if (child?.status === 'completed') continue;
        }
        const visitIndex = sortedRows.indexOf(visit);
        if (completedCount > 0 && visitIndex < completedCount) continue;
        hasOpenVisitWork = true;
        break;
      }

      if (!hasPendingPayment && !hasOpenVisitWork && !openNextVisitForPaymentInFlight.has(taskId)) {
        await RecurringVisitService.ensureMaterializedBuffer(taskId);
        await RecurringVisitService.openNextVisitForPayment(taskId, { skipReconcile: true });
      }
    }

    const taskAfterPayment = await Task.findById(taskId);
    if (!taskAfterPayment) return;

    const progressSynced = await RecurringVisitService.syncActiveVisitProgress(taskAfterPayment);
    if (progressSynced) {
      invalidateTaskDetailCache(taskId);
    } else if (changed) {
      invalidateTaskDetailCache(taskId);
    }
  }

  /**
   * Resolve the child visit task a performer should act on when given a recurring plan id.
   * Prefers the earliest paid confirmed/in-progress visit (Visit 1 after assignment), not the
   * payment_pending slot opened for the next visit.
   */
  static async resolveActiveWorkChildTask(parent: ITask): Promise<ITask | null> {
    if (!isRecurringVisitPlanTask(parent as unknown as Record<string, unknown>)) {
      return null;
    }

    const parentTaskId = String(parent._id);
    const rows = sortScheduleRows(getScheduleRows(parent));

    const loadChild = async (visit: ScheduleVisitRow | undefined): Promise<ITask | null> => {
      if (!visit?.childTaskId) return null;
      const status = String(visit.status || '');
      if (
        ['completed', 'cancelled', 'cancelled_late', 'skipped', 'skipped_unpaid', 'scheduled'].includes(
          status,
        )
      ) {
        return null;
      }
      if (status === 'payment_pending') return null;

      if (['confirmed', 'in_progress'].includes(status)) {
        let paid = visitRowHasHeldPayment(visit);
        if (!paid) {
          const paidEscrow = await resolvePaidEscrowForVisit(parentTaskId, visit.visitId);
          paid = Boolean(paidEscrow);
        }
        if (!paid) return null;
      }

      const child = await Task.findById(visit.childTaskId);
      if (!child || child.status === 'cancelled' || child.status === 'completed') {
        return null;
      }
      return child;
    };

    for (const visit of rows) {
      const child = await loadChild(visit);
      if (child) return child;
    }

    return null;
  }

  /** When a recurring plan id is passed for work actions, return the active child visit task. */
  static async resolvePerformingWorkTaskOrSelf(task: ITask): Promise<ITask> {
    if (task.parentTaskId && task.recurringVisitId) {
      return task;
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      return task;
    }
    const child = await RecurringVisitService.resolveActiveWorkChildTask(task);
    return child ?? task;
  }

  /**
   * Remove schedule rows pointing at child tasks that no longer exist (e.g. after reschedule).
   */
  static async sanitizeOrphanedScheduleChildReferences(
    plan: ITask,
    options?: { persist?: boolean },
  ): Promise<boolean> {
    if (!isRecurringVisitPlanTask(plan as unknown as Record<string, unknown>)) {
      return false;
    }

    const planTaskId = String(plan._id);
    let changed = false;
    const rows = getScheduleRows(plan);

    for (const visit of rows) {
      const childId = visit.childTaskId ? String(visit.childTaskId) : '';
      if (!childId) continue;

      const child = await Task.findById(childId).select('_id status').lean();
      if (child) continue;

      logger.info('[RecurringVisitService] Clearing orphaned childTaskId from visit schedule', {
        planTaskId,
        visitId: visit.visitId,
        childTaskId: childId,
      });

      clearScheduleVisitHeldPaymentBinding(visit);
      const status = String(visit.status || '');
      if (['confirmed', 'in_progress'].includes(status)) {
        visit.status = 'scheduled';
      }
      visit.updatedAt = new Date();
      invalidateTaskDetailCache(childId);
      changed = true;
    }

    if (changed && options?.persist !== false) {
      plan.schedule = rows as unknown as ITask['schedule'];
      plan.markModified('schedule');
      await plan.save();
      invalidateTaskDetailCache(planTaskId);
    }

    return changed;
  }

  /**
   * Recover from GET /tasks/:id when a recurring child task was deleted (e.g. visit 1 reschedule).
   * Repairs the parent schedule and returns the active work child or the parent plan.
   */
  static async resolveDeletedRecurringChildTaskAccess(
    missingChildId: string,
  ): Promise<ITask | null> {
    if (!mongoose.Types.ObjectId.isValid(missingChildId)) return null;

    const existingChild = await Task.findById(missingChildId);
    if (existingChild) return existingChild;

    const childOid = new mongoose.Types.ObjectId(missingChildId);
    let parent = await Task.findOne({
      schedule: { $elemMatch: { childTaskId: childOid } },
    });
    if (!parent) {
      parent = await Task.findOne({ 'schedule.childTaskId': missingChildId });
    }
    if (!parent || !isRecurringVisitPlanTask(parent as unknown as Record<string, unknown>)) {
      return null;
    }

    await RecurringVisitService.sanitizeOrphanedScheduleChildReferences(parent);
    invalidateTaskDetailCache(missingChildId);

    const refreshedParent = await Task.findById(parent._id);
    if (!refreshedParent) return null;

    const workChild = await RecurringVisitService.resolveActiveWorkChildTask(refreshedParent);
    if (workChild) {
      return workChild;
    }

    return refreshedParent;
  }

  static async ensureVisitPaidBeforeWorkStart(task: ITask): Promise<void> {
    const workTask = await RecurringVisitService.resolvePerformingWorkTaskOrSelf(task);
    const parentTaskId = workTask.parentTaskId
      ? String(workTask.parentTaskId)
      : String(workTask._id);
    const planTaskRecord = workTask.parentTaskId
      ? await Task.findById(workTask.parentTaskId)
      : workTask;
    if (!planTaskRecord || !isRecurringVisitPlanTask(planTaskRecord as unknown as Record<string, unknown>)) {
      return;
    }

    if (!workTask.parentTaskId) {
      throw new BadRequestError(
        'Recurring visit work must be started on the paid visit task, not the plan',
      );
    }

    const visitId = workTask.recurringVisitId;
    if (!visitId) {
      throw new BadRequestError(
        'Visit payment must be completed before the helper can start work',
      );
    }

    await RecurringVisitService.syncPendingVisitPaymentsFromEscrow(parentTaskId);

    let refreshed = await Task.findById(parentTaskId);
    if (!refreshed) return;

    // `findVisit()` searches embedded `task.schedule[]`. For collection-backed plans,
    // the authoritative visit rows live in `RecurringVisit`, so we must hydrate
    // `schedule` before attempting to resolve by `visitId`.
    await hydrateTaskVisitsOntoSchedule(refreshed);

    let visit = findVisit(refreshed, String(visitId));
    if (!visit) {
      throw new BadRequestError('Visit not found for this task');
    }

    let paidEscrow = await resolvePaidEscrowForVisit(parentTaskId, String(visitId), {
      rowEscrowId: String(visit.escrowId || ''),
      alignMissingVisitMetadata: true,
    });
    if (!paidEscrow && visitRowHasHeldPayment(visit)) {
      const rowEscrowId = String(visit.escrowId || '').trim();
      if (rowEscrowId) {
        await alignEscrowVisitMetadataIfNeeded({
          taskId: parentTaskId,
          visitId: String(visitId),
          escrowId: rowEscrowId,
        });
        paidEscrow = await resolvePaidEscrowForVisit(parentTaskId, String(visitId), {
          rowEscrowId,
        });
      }
    }
    if (!paidEscrow) {
      throw new BadRequestError(
        'Visit payment must be completed before the helper can start work',
      );
    }

    if (!visitRowHasHeldPayment(visit)) {
      visit.status =
        visit.status === 'payment_pending' ? 'confirmed' : (visit.status as VisitStatus);
      visit.paymentStatus = 'held';
      visit.escrowId = paidEscrow.escrowId;
      visit.paidAt = visit.paidAt ?? new Date();
      visit.updatedAt = new Date();
      refreshed.schedule = getScheduleRows(refreshed) as unknown as ITask['schedule'];
      const visitRow = findVisit(refreshed, String(visitId));
      if (visitRow) {
        visitRow.status = visit.status;
        visitRow.paymentStatus = visit.paymentStatus;
        visitRow.escrowId = visit.escrowId;
        visitRow.paidAt = visit.paidAt;
        visitRow.updatedAt = visit.updatedAt;
      }
      refreshed.markModified('schedule');
      await refreshed.save();
      invalidateTaskDetailCache(parentTaskId);
      visit = findVisit(refreshed, String(visitId)) || visit;
    }

    if (visit.status === 'payment_pending') {
      try {
        await RecurringVisitService.confirmVisitPaymentFromCapture({
          parentTaskId,
          visitId: String(visitId),
          escrowId: paidEscrow.escrowId,
        });
        refreshed = await Task.findById(parentTaskId);
        visit = refreshed ? findVisit(refreshed, String(visitId)) : undefined;
        paidEscrow = await resolvePaidEscrowForVisit(parentTaskId, String(visitId), {
          rowEscrowId: String(visit?.escrowId || ''),
        });
      } catch (error) {
        logger.warn('[RecurringVisitService] Failed to confirm visit before work start', {
          parentTaskId,
          visitId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!visit || !paidEscrow) {
      throw new BadRequestError(
        'Visit payment must be completed before the helper can start work',
      );
    }

    const scheduleRows = getScheduleRows(refreshed!);
    const chronoCurrent = resolveChronologicalCurrentVisitRow(scheduleRows);
    if (
      chronoCurrent?.visitId &&
      chronoCurrent.visitId !== String(visitId) &&
      isVisitDeferredByEarlierChronologicalVisit(visit, scheduleRows)
    ) {
      throw new BadRequestError(
        'Complete earlier scheduled visits before starting this rescheduled visit',
      );
    }

    const paymentStatus = (visit.paymentStatus || 'pending') as VisitPaymentStatus;
    const visitStatus = visit.status as VisitStatus;
    if (!canTaskerStartVisit(visitStatus, paymentStatus)) {
      throw new BadRequestError(
        'Visit payment must be completed before the helper can start work',
      );
    }
  }

  static async syncParentVisitOnChildProgress(
    childTask: ITask,
    childStatus: string,
  ): Promise<void> {
    if (!childTask.parentTaskId || !childTask.recurringVisitId) return;

    const parent = await Task.findById(childTask.parentTaskId);
    if (!parent || !isRecurringVisitPlanTask(parent as unknown as Record<string, unknown>)) {
      return;
    }

    await hydrateTaskVisitsOntoSchedule(parent);
    const visit = findVisit(parent, childTask.recurringVisitId);
    if (!visit) return;

    const paymentStatus = (visit.paymentStatus || 'pending') as VisitPaymentStatus;
    const visitStatus = visit.status as VisitStatus;
    const hasHeldPayment =
      paymentStatus === 'held' ||
      paymentStatus === 'released' ||
      Boolean(visit.paidAt) ||
      Boolean(visit.escrowId);
    if (!hasHeldPayment && visitStatus === 'payment_pending') {
      return;
    }

    const mapped = mapTaskProgressToVisitStatus(childStatus);
    if (!mapped || visit.status === 'completed') return;

    if (visit.status === mapped) return;

    visit.status = mapped;
    visit.updatedAt = new Date();
    (parent as unknown as { activeVisitId?: string }).activeVisitId = visit.visitId;
    parent.schedule = getScheduleRows(parent) as unknown as ITask['schedule'];
    parent.markModified('schedule');
    await parent.save();
    invalidateTaskDetailCache(parent._id.toString());
  }

  private static async syncActiveVisitProgress(task: ITask): Promise<boolean> {
    const rows = getScheduleRows(task);
    const plan = (task as unknown as { recurringPlan?: { completedVisitCount?: number } })
      .recurringPlan;
    const completedVisitCount = Number(plan?.completedVisitCount || 0);
    const sortedRows = [...rows].sort(
      (a, b) =>
        (a.visitIndex ?? 0) - (b.visitIndex ?? 0) ||
        normalizeDateOnly(new Date(a.date)).getTime() -
          normalizeDateOnly(new Date(b.date)).getTime(),
    );
    const isVisitClosedForSync = (visit: (typeof rows)[number]): boolean => {
      if (visit.status === 'completed') return true;
      const visitIdx = sortedRows.findIndex((entry) => entry.visitId === visit.visitId);
      return completedVisitCount > 0 && visitIdx >= 0 && visitIdx < completedVisitCount;
    };

    const parentProgress = mapTaskProgressToVisitStatus(String(task.status || ''));
    const activeVisitId = (task as unknown as { activeVisitId?: string }).activeVisitId;
    const activeFromId = activeVisitId ? findVisit(task, activeVisitId) : undefined;
    const dateSorted = sortScheduleRowsByDate(rows);
    let targetVisit =
      (activeFromId &&
      activeFromId.status !== 'payment_pending' &&
      activeFromId.status !== 'scheduled'
        ? activeFromId
        : undefined) ||
      dateSorted.find(
        (v) =>
          (v.status === 'confirmed' || v.status === 'in_progress') &&
          !isVisitClosedForSync(v) &&
          visitRowHasHeldPayment(v),
      );

    if (targetVisit && isVisitClosedForSync(targetVisit)) {
      targetVisit = undefined;
    }

    if (!targetVisit || !parentProgress) {
      const child = await Task.findOne({
        parentTaskId: task._id,
        status: { $in: ['started', 'in_progress', 'review'] },
      })
        .sort({ updatedAt: -1 })
        .lean();
      if (child?.recurringVisitId) {
        targetVisit = findVisit(task, String(child.recurringVisitId));
        if (
          targetVisit &&
          targetVisit.status !== 'in_progress' &&
          targetVisit.status !== 'completed' &&
          !isVisitClosedForSync(targetVisit)
        ) {
          targetVisit.status = 'in_progress';
          targetVisit.updatedAt = new Date();
          (task as unknown as { activeVisitId?: string }).activeVisitId = targetVisit.visitId;
          task.schedule = rows as unknown as ITask['schedule'];
          task.markModified('schedule');
          await task.save();
          return true;
        }
      }
      return false;
    }

    if (targetVisit.status === 'in_progress' || targetVisit.status === 'completed') {
      return false;
    }

    if (targetVisit.status === 'payment_pending') {
      return false;
    }

    if (!visitRowHasHeldPayment(targetVisit)) {
      return false;
    }

    if (!canTaskerStartVisit(targetVisit.status as VisitStatus, targetVisit.paymentStatus)) {
      if (targetVisit.status !== 'in_progress') {
        return false;
      }
    }

    targetVisit.status = parentProgress;
    targetVisit.updatedAt = new Date();
    (task as unknown as { activeVisitId?: string }).activeVisitId = targetVisit.visitId;

    if (targetVisit.childTaskId) {
      const child = await Task.findById(targetVisit.childTaskId);
      const childTargetStatus =
        parentProgress === 'in_progress' ? 'started' : String(task.status || 'assigned');
      if (
        child &&
        child.status === 'assigned' &&
        ['started', 'in_progress', 'review'].includes(childTargetStatus)
      ) {
        child.status = childTargetStatus as ITask['status'];
        if (!child.startedAt) {
          child.startedAt = task.startedAt || new Date();
        }
        await child.save();
      }
    }

    task.schedule = rows as unknown as ITask['schedule'];
    task.markModified('schedule');
    await task.save();
    return true;
  }

  static async skipVisit(params: {
    taskId: string;
    visitId: string;
    requesterProfileId: mongoose.Types.ObjectId;
    reason?: string;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    const visit = findVisit(task, params.visitId);
    if (!visit) throw new NotFoundError('Visit not found');

    const hoursUntil = (new Date(visit.date).getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursUntil < DEFAULT_SKIP_FREE_HOURS_BEFORE_VISIT) {
      throw new BadRequestError(
        'Visits within 24 hours cannot be skipped without cancellation policy',
      );
    }

    if (!['scheduled', 'payment_pending'].includes(String(visit.status))) {
      throw new BadRequestError('This visit cannot be skipped');
    }

    visit.status = 'skipped';
    visit.skippedAt = new Date();
    visit.skippedBy = 'customer';
    visit.skipReason = params.reason || 'Skipped by customer';
    visit.updatedAt = new Date();

    task.schedule = getScheduleRows(task) as unknown as ITask['schedule'];
    task.markModified('schedule');
    await task.save();
    invalidateTaskDetailCache(task._id.toString());

    await RecurringVisitService.ensureMaterializedBuffer(task._id.toString());
    await RecurringVisitService.openNextVisitForPayment(task._id.toString());
  }

  static async markVisitUnpaid(taskId: string, visitId: string): Promise<void> {
    const task = await Task.findById(taskId);
    if (!task) return;

    const visit = findVisit(task, visitId);
    if (!visit || visit.status !== 'payment_pending') return;

    visit.status = 'skipped_unpaid';
    visit.paymentStatus = 'failed';
    visit.skippedAt = new Date();
    visit.skippedBy = 'system';
    visit.skipReason = 'Payment not completed before deadline';
    visit.updatedAt = new Date();

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const unpaidCount = Number(plan.consecutiveUnpaidCount || 0) + 1;
    plan.consecutiveUnpaidCount = unpaidCount;
    if (unpaidCount >= DEFAULT_CONSECUTIVE_UNPAID_PAUSE_THRESHOLD) {
      plan.status = 'paused';
      plan.pausedAt = new Date();
      plan.pausedReason = 'consecutive_unpaid';
    }

    task.schedule = getScheduleRows(task) as unknown as ITask['schedule'];
    task.markModified('recurringPlan');
    await saveRecurringPlanDocument(task, taskId, getScheduleRows(task));

    await RecurringVisitService.ensureMaterializedBuffer(taskId);
  }

  static async ensureMaterializedBuffer(
    taskId: string,
    options?: {
      allowPaused?: boolean;
      initialMeta?: RecurringMetaPayload;
      initialStartDate?: Date;
      initialEndDate?: Date;
    },
  ): Promise<void> {
    const task = await Task.findById(taskId).select(
      'recurring recurringPlan scheduledDate activeVisitId schedule',
    );
    if (!task || !task.recurring?.enabled) return;

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (!plan) return;
    if (plan.status === 'ended') return;
    if (plan.status === 'paused' && !options?.allowPaused) return;

    const collectionMode = shouldWriteCollection(task);

    const meta: RecurringMetaPayload = options?.initialMeta ?? {
      pattern: plan.pattern as RecurringMetaPayload['pattern'],
      selectedWeekdays: (plan.selectedWeekdays as number[]) || [],
      endType: plan.endType as RecurringMetaPayload['endType'],
      expectedDurationMinutes: Number(plan.expectedDurationMinutes) || 60,
      visitTime: String(plan.visitTime || ''),
    };

    const startRaw =
      options?.initialStartDate ?? task.recurring?.startDate ?? task.scheduledDate;
    if (!startRaw) return;

    const endDate =
      options?.initialEndDate ??
      (plan.endDate ? new Date(String(plan.endDate)) : undefined);

    const config = buildScheduleConfigFromMeta(
      meta,
      new Date(String(startRaw)),
      endDate,
    );

    const bufferSize =
      Number(plan.materializedBufferSize) ||
      (collectionMode ? DEFAULT_RECURRING_VISIT_BUFFER_SIZE : DEFAULT_MATERIALIZED_BUFFER_SIZE);

    if (collectionMode) {
      const upcomingCount = await RecurringVisitRepository.countUpcoming(task._id);
      const totalMaterialized = await RecurringVisitRepository.countByParent(task._id);
      const totalPlanned =
        plan.endType === 'end_on_date'
          ? Number(plan.totalPlanned) || countPlannedRecurringOccurrences(config)
          : undefined;

      let missingCount = resolveMaterializationMissingCount({
        bufferSize,
        upcomingVisitCount: upcomingCount,
        endType: plan.endType as RecurringMetaPayload['endType'],
        totalPlannedOccurrences: totalPlanned,
        totalMaterializedOccurrences: totalMaterialized,
      });

      if (missingCount <= 0) {
        await updatePlanSummaryFromVisits(task);
        task.markModified('recurringPlan');
        await task.save();
        return;
      }

      const lastDoc = await RecurringVisitRepository.getLastMaterializedVisit(task._id);
      let visitIndex =
        (lastDoc?.visitIndex ?? (await RecurringVisitRepository.getMaximumVisitIndex(task._id))) ||
        0;
      let advanceCursor = lastDoc ? new Date(lastDoc.date) : null;
      let materializedCount = totalMaterialized;

      const toUpsert: ReturnType<typeof mapScheduleRowToUpsert>[] = [];

      while (missingCount > 0) {
        const nextDate = resolveNextMaterializedVisitDate(
          config,
          advanceCursor,
          materializedCount,
        );
        if (!nextDate) break;
        if (
          plan.endType === 'end_on_date' &&
          plan.endDate &&
          normalizeDateOnly(nextDate).getTime() >
            normalizeDateOnly(new Date(String(plan.endDate))).getTime()
        ) {
          break;
        }
        visitIndex += 1;
        const row = createVisitRow(nextDate, visitIndex, meta, 'scheduled');
        toUpsert.push(mapScheduleRowToUpsert(task._id, row));
        plan.lastMaterializedDate = nextDate;
        advanceCursor = nextDate;
        materializedCount += 1;
        missingCount -= 1;
      }

      if (toUpsert.length > 0) {
        try {
          await RecurringVisitRepository.upsertVisits(toUpsert);
        } catch (error) {
          logger.warn('[ensureMaterializedBuffer] bulk upsert race — re-querying', {
            taskId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const allVisits = await getVisitsForPlan(task);
      await updatePlanSummaryFromVisits(task, allVisits);
      (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
      task.markModified('recurringPlan');
      await task.save();
      invalidateTaskDetailCache(taskId);
      return;
    }

    // Legacy embedded path (unmigrated plans)
    if (plan.planVersion !== 2) return;

    await hydrateTaskVisitsOntoSchedule(task);
    const rows = getScheduleRows(task);

    if (plan.endType === 'end_on_date') {
      const totalPlanned =
        Number(plan.totalPlanned) || countPlannedRecurringOccurrences(config);
      let visitIndex = rows.reduce((max, r) => Math.max(max, r.visitIndex || 0), 0);
      let materializedCount = rows.length;

      while (materializedCount < totalPlanned) {
        const nextDate = resolveNextMaterializedVisitDate(
          config,
          materializedCount > 0 ? new Date(rows[rows.length - 1].date) : null,
          materializedCount,
        );
        if (!nextDate) break;
        if (
          plan.endDate &&
          normalizeDateOnly(nextDate).getTime() >
            normalizeDateOnly(new Date(String(plan.endDate))).getTime()
        ) {
          break;
        }
        visitIndex += 1;
        rows.push(createVisitRow(nextDate, visitIndex, meta, 'scheduled'));
        plan.lastMaterializedDate = nextDate;
        materializedCount += 1;
      }

      await saveRecurringPlanDocument(task, taskId, rows);
      return;
    }

    const upcomingCount = rows.filter((v) =>
      ['open', 'reserved', 'assigned', 'scheduled', 'payment_pending', 'confirmed'].includes(
        String(v.status),
      ),
    ).length;
    let needed = resolveMaterializationMissingCount({
      bufferSize,
      upcomingVisitCount: upcomingCount,
      endType: 'until_cancelled',
      totalMaterializedOccurrences: rows.length,
    });
    if (needed <= 0) return;

    let materializedCount = rows.length;
    let advanceCursor =
      rows.length > 0 ? new Date(rows[rows.length - 1].date) : null;

    let visitIndex = rows.reduce((max, r) => Math.max(max, r.visitIndex || 0), 0);

    while (needed > 0) {
      const nextDate = resolveNextMaterializedVisitDate(
        config,
        advanceCursor,
        materializedCount,
      );
      if (!nextDate) break;
      visitIndex += 1;
      rows.push(createVisitRow(nextDate, visitIndex, meta, 'scheduled'));
      plan.lastMaterializedDate = nextDate;
      advanceCursor = nextDate;
      materializedCount += 1;
      needed -= 1;
    }

    await saveRecurringPlanDocument(task, taskId, rows);
  }

  /** Non-blocking escrow sync + rebalance after a fast visits read. */
  private static schedulePaymentSyncAndRebalance(taskId: string): void {
    void (async () => {
      try {
        await RecurringVisitService.syncPendingVisitPaymentsFromEscrow(taskId);
        await RecurringVisitService.rebalancePaymentPendingVisits(taskId);
        void RecurringVisitService.scheduleReconcilePlanState(taskId);
      } catch (error) {
        logger.warn('[RecurringVisitService] Background payment sync failed', {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }

  private static readonly LIST_VISITS_TASK_SELECT =
    '_id requesterId status recurring recurringPlan activeVisitId budget';

  static async listVisits(
    taskId: string,
    requesterProfileId?: mongoose.Types.ObjectId,
    options?: { syncPayments?: boolean; scope?: 'work_details' | 'full' },
  ) {
    const taskLean = await Task.findById(taskId)
      .select(RecurringVisitService.LIST_VISITS_TASK_SELECT)
      .lean();
    if (!taskLean) throw new NotFoundError('Task not found');

    const task = taskLean as unknown as ITask;

    if (requesterProfileId && !task.requesterId.equals(requesterProfileId)) {
      const plan = (task as unknown as { recurringPlan?: { taskerProfileId?: mongoose.Types.ObjectId } })
        .recurringPlan;
      if (!plan?.taskerProfileId?.equals(requesterProfileId)) {
        throw new ForbiddenError('Not authorized to view visits');
      }
    }

    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan task');
    }

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const syncPayments = options?.syncPayments === true;

    if (syncPayments) {
      await RecurringVisitService.syncPendingVisitPaymentsFromEscrow(taskId);
      await RecurringVisitService.rebalancePaymentPendingVisits(taskId);
      void RecurringVisitService.scheduleReconcilePlanState(taskId);
      plan.lastPaymentSyncAt = new Date();
      await Task.updateOne({ _id: taskId }, { $set: { 'recurringPlan.lastPaymentSyncAt': plan.lastPaymentSyncAt } });
    } else {
      const lastSync = plan.lastPaymentSyncAt
        ? new Date(String(plan.lastPaymentSyncAt)).getTime()
        : 0;
      const cooldown = recurringVisitConfig.paymentSyncCooldownMs;
      const pendingExists = shouldWriteCollection(task)
        ? (await RecurringVisitRepository.listPaymentPending(task._id)).length > 0
        : false;
      if (pendingExists && Date.now() - lastSync > cooldown) {
        RecurringVisitService.schedulePaymentSyncAndRebalance(taskId);
      }
    }

    const visits = await getVisitsForPlan(task);

    const completedChildren = await Task.find({
      parentTaskId: task._id,
      status: 'completed',
      recurringVisitId: { $exists: true, $nin: [null, ''] },
    })
      .select('_id recurringVisitId')
      .lean();

    const childIdByVisitId = new Map<string, mongoose.Types.ObjectId>();
    for (const child of completedChildren) {
      const visitId = String(child.recurringVisitId || '').trim();
      if (visitId && child._id) {
        childIdByVisitId.set(visitId, child._id as mongoose.Types.ObjectId);
      }
    }

    for (const visit of visits) {
      if (visit.childTaskId || !visit.visitId) continue;
      const childId = childIdByVisitId.get(visit.visitId);
      if (childId) {
        visit.childTaskId = childId;
      }
    }

    const pendingPayment =
      String(plan.status || '').toLowerCase() === 'ended' ||
      String(taskLean.status || '').toLowerCase() === 'cancelled'
        ? null
        : resolvePendingPaymentVisitRow(visits);

    const activeVisitId =
      (task as unknown as { activeVisitId?: string }).activeVisitId ?? null;

    if (options?.scope === 'work_details') {
      const preview = selectWorkDetailsPreviewVisits(visits, activeVisitId);
      return {
        planStatus: plan.status,
        visits: preview.previewVisits,
        preview: {
          scope: 'work_details',
          totalListedVisits: preview.totalListed,
          hiddenVisitCount: preview.hiddenCount,
        },
        pendingPayment: pendingPayment
          ? {
              visitId: pendingPayment.visitId,
              amount: pendingPayment.amount ?? plan.budgetPerVisit,
              paymentDeadline: pendingPayment.paymentDeadline,
              visitIndex: pendingPayment.visitIndex,
              date: pendingPayment.date,
            }
          : null,
        activeVisitId,
      };
    }

    return {
      planStatus: plan.status,
      visits,
      pendingPayment: pendingPayment
        ? {
            visitId: pendingPayment.visitId,
            amount: pendingPayment.amount ?? plan.budgetPerVisit,
            paymentDeadline: pendingPayment.paymentDeadline,
            visitIndex: pendingPayment.visitIndex,
            date: pendingPayment.date,
          }
        : null,
      activeVisitId: (task as unknown as { activeVisitId?: string }).activeVisitId ?? null,
    };
  }

  static async endPlan(params: {
    taskId: string;
    requesterProfileId: mongoose.Types.ObjectId;
    reason?: string;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    await RecurringVisitService.assertPlanCanBeEnded(task);

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const cancelReason = params.reason || 'Customer cancelled recurring plan';
    const requesterUid = await RecurringVisitService.resolveProfileUid(params.requesterProfileId);

    if (plan.status === 'ended' && String(task.status) === 'cancelled') {
      await RecurringVisitService.cancelAllPlanChildTasks({
        planTaskId: params.taskId,
        cancelledByProfileId: params.requesterProfileId,
        cancelReason: params.reason || 'Customer cancelled recurring plan',
        planTask: task,
      });
      return;
    }

    if (plan.status !== 'ended') {
      plan.status = 'ended';
      plan.endedAt = new Date();
      plan.pausedReason = cancelReason;
      (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
      task.markModified('recurringPlan');
      await task.save();
      invalidateTaskDetailCache(params.taskId);
    }

    await RecurringVisitService.cancelAllPlanChildTasks({
      planTaskId: params.taskId,
      cancelledByProfileId: params.requesterProfileId,
      cancelReason,
      planTask: task,
    });

    const refreshed = await Task.findById(params.taskId);
    if (!refreshed) return;

    await hydrateTaskVisitsOntoSchedule(refreshed);
    let rows = getScheduleRows(refreshed);
    for (const visit of rows) {
      if (VISIT_TERMINAL_STATUSES.has(visit.status as VisitStatus)) continue;

      const refundResult = await RecurringVisitService.refundVisitPaymentOnCancel({
        planTask: refreshed,
        visit,
        cancelledBy: 'poster',
        requesterUid,
        reason: cancelReason,
      });
      if (
        refundResult.error &&
        (visitRowHasHeldPayment(visit) ||
          visit.paymentStatus === 'held' ||
          visit.paymentStatus === 'released')
      ) {
        throw new BadRequestError(
          refundResult.error ||
            'Could not refund payment for a cancelled visit. Please try again or contact support.',
        );
      }

      visit.status = 'cancelled';
      visit.updatedAt = new Date();
    }

    refreshed.status = 'cancelled';
    refreshed.cancelledAt = new Date();
    refreshed.cancelledById = params.requesterProfileId;
    (refreshed as unknown as { activeVisitId?: string }).activeVisitId = undefined;
    refreshed.startedAt = undefined;
    refreshed.schedule = rows as unknown as ITask['schedule'];
    refreshed.markModified('schedule');
    if (refreshed.isModified('activeVisitId')) {
      refreshed.markModified('activeVisitId');
    }
    await saveRecurringPlanDocument(refreshed, params.taskId, rows);
    invalidateTaskDetailCache(params.taskId);

    await RecurringVisitService.notifyTaskerRecurringPlanEndedByCustomer(refreshed, {
      reason: params.reason,
    });

    if (refreshed.assigneeId) {
      await Task.updateOne(
        { _id: refreshed._id },
        {
          $unset: { assigneeId: '', assigneeUid: '', activeVisitId: '' },
          $set: { updatedAt: new Date() },
        },
      );
      invalidateTaskDetailCache(params.taskId);
    }
  }

  static async resumePlan(params: {
    taskId: string;
    requesterProfileId: mongoose.Types.ObjectId;
  }): Promise<{ visitId: string; amount: number; paymentDeadline: Date } | null> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (plan.status !== 'paused') {
      throw new BadRequestError('Plan is not paused');
    }

    plan.status = 'active';
    plan.consecutiveUnpaidCount = 0;
    plan.pausedAt = undefined;
    plan.pausedReason = undefined;
    (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
    task.markModified('recurringPlan');
    await task.save();
    invalidateTaskDetailCache(params.taskId);

    await RecurringVisitService.ensureMaterializedBuffer(params.taskId);
    return RecurringVisitService.openNextVisitForPayment(params.taskId);
  }

  /** Fast DB-only sync before opening the next visit for payment (no payment-service round trips). */
  static async syncRecurringPlanVisitCompletions(taskId: string): Promise<void> {
    const task = await Task.findById(taskId);
    if (!task || !isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      return;
    }

    let changed = false;
    let rows = getScheduleRows(task);

    const completedChildren = await Task.find({
      parentTaskId: task._id,
      status: 'completed',
      recurringVisitId: { $exists: true, $nin: [null, ''] },
    })
      .select('recurringVisitId')
      .lean();

    for (const child of completedChildren) {
      const visitId = String(child.recurringVisitId || '').trim();
      if (!visitId) continue;
      const visit = findVisit(task, visitId);
      if (visit && visit.status !== 'completed') {
        visit.status = 'completed';
        visit.updatedAt = new Date();
        changed = true;
      }
    }

    const cancelledChildren = await Task.find({
      parentTaskId: task._id,
      status: 'cancelled',
      recurringVisitId: { $exists: true, $nin: [null, ''] },
    })
      .select('_id recurringVisitId')
      .lean();

    const cancelledChildVisitIds = new Set(
      cancelledChildren
        .map((child) => String(child.recurringVisitId || '').trim())
        .filter(Boolean),
    );

    for (const visit of rows) {
      if (String(visit.status) !== 'cancelled') continue;
      if (visit.skippedAt || visit.skipReason) continue;
      if (!visit.visitId || !cancelledChildVisitIds.has(visit.visitId)) continue;

      visit.status = 'scheduled';
      if (!visitRowHasHeldPayment(visit)) {
        visit.paymentStatus = 'pending';
        visit.escrowId = undefined;
        visit.paidAt = undefined;
      }
      visit.childTaskId = undefined;
      visit.updatedAt = new Date();
      changed = true;
    }

    for (const child of cancelledChildren) {
      const visitId = String(child.recurringVisitId || '').trim();
      if (!visitId) continue;
      const visit = findVisit(task, visitId);
      if (
        visit &&
        visit.status !== 'completed' &&
        !VISIT_TERMINAL_STATUSES.has(visit.status as VisitStatus) &&
        shouldInferVisitCancelledFromChildTask(visit, String(child._id))
      ) {
        visit.status = 'cancelled';
        visit.updatedAt = new Date();
        changed = true;
      }
    }

    const activeVisitId = (task as unknown as { activeVisitId?: string }).activeVisitId;
    if (activeVisitId) {
      const activeVisit = findVisit(task, activeVisitId);
      if (
        activeVisit?.status === 'completed' ||
        activeVisit?.status === 'cancelled' ||
        activeVisit?.status === 'cancelled_late'
      ) {
        (task as unknown as { activeVisitId?: string }).activeVisitId = undefined;
        changed = true;
      }
    }

    const plan = (task as unknown as { recurringPlan?: Record<string, unknown> }).recurringPlan;
    const completedVisitCount = Number(plan?.completedVisitCount || 0);
    const completedRowCount = rows.filter((visit) => visit.status === 'completed').length;
    const effectiveCompletedCount = Math.max(completedVisitCount, completedRowCount);

    if (effectiveCompletedCount > completedVisitCount) {
      if (plan) {
        plan.completedVisitCount = effectiveCompletedCount;
        (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
        changed = true;
      }
    }

    if (effectiveCompletedCount > 0) {
      const sortedForSync = [...rows].sort(
        (a, b) =>
          (a.visitIndex ?? 0) - (b.visitIndex ?? 0) ||
          normalizeDateOnly(new Date(a.date)).getTime() -
            normalizeDateOnly(new Date(b.date)).getTime(),
      );
      for (
        let index = 0;
        index < sortedForSync.length && index < effectiveCompletedCount;
        index += 1
      ) {
        const visit = sortedForSync[index];
        if (visit.status === 'scheduled' || visit.status === 'payment_pending') {
          continue;
        }
        if (
          visit.status !== 'completed' &&
          visit.status !== 'cancelled' &&
          visit.status !== 'skipped' &&
          visit.status !== 'skipped_unpaid'
        ) {
          visit.status = 'completed';
          visit.updatedAt = new Date();
          changed = true;
        }
      }
    }

    if (changed) {
      task.schedule = rows as unknown as ITask['schedule'];
      if (plan) {
        (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
        task.markModified('recurringPlan');
      }
      await saveRecurringPlanDocument(task, taskId);
    }
  }

  static async openNextVisitPayment(params: {
    taskId: string;
    requesterProfileId: mongoose.Types.ObjectId;
  }): Promise<{ visitId: string; amount: number; paymentDeadline: Date }> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    await RecurringVisitService.rebalancePaymentPendingVisits(params.taskId);
    const taskAfterRebalance = await Task.findById(params.taskId);
    const rowsAfterRebalance = taskAfterRebalance
      ? getScheduleRows(taskAfterRebalance)
      : getScheduleRows(task);
    const existingPending = resolvePendingPaymentVisitRow(rowsAfterRebalance);
    if (existingPending) {
      return resolvePendingPaymentPayload(existingPending, plan);
    }

    if (openNextVisitForPaymentInFlight.has(params.taskId)) {
      const taskAfterWait = await Task.findById(params.taskId);
      if (!taskAfterWait) throw new NotFoundError('Task not found');
      const pendingAfterWait = resolvePendingPaymentVisitRow(getScheduleRows(taskAfterWait));
      if (pendingAfterWait) {
        const planAfterWait = (taskAfterWait as unknown as {
          recurringPlan: Record<string, unknown>;
        }).recurringPlan;
        return resolvePendingPaymentPayload(pendingAfterWait, planAfterWait);
      }
    }

    openNextVisitForPaymentInFlight.add(params.taskId);
    try {
      await RecurringVisitService.syncRecurringPlanVisitCompletions(params.taskId);
      await RecurringVisitService.ensureMaterializedBuffer(params.taskId);
      const pendingPayment = await RecurringVisitService.openNextVisitForPayment(params.taskId, {
        skipReconcile: true,
      });
      if (!pendingPayment) {
        throw new BadRequestError('No visit is ready for payment');
      }
      return pendingPayment;
    } finally {
      openNextVisitForPaymentInFlight.delete(params.taskId);
    }
  }

  static recurringPlanVisitsExhausted(task: ITask, rows: ScheduleVisitRow[]): boolean {
    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const sorted = sortScheduleRows(rows);

    const hasActionable = sorted.some((visit) =>
      ['scheduled', 'payment_pending', 'confirmed', 'in_progress'].includes(
        String(visit.status),
      ),
    );
    if (hasActionable) return false;

    if (sorted.length === 0) return false;

    if (plan.endType === 'end_on_date') {
      const totalPlanned = Number(plan.totalPlanned) || 0;
      if (totalPlanned <= 0) return false;
      if (sorted.length < totalPlanned) return false;
      const closedCount = sorted.filter((visit) => isVisitPassed(visit)).length;
      return closedCount >= totalPlanned;
    }

    return sorted.every((visit) => isVisitPassed(visit));
  }

  static async markRecurringPlanParentCompleted(parentId: string): Promise<void> {
    const parent = await Task.findById(parentId);
    if (!parent || !isRecurringVisitPlanTask(parent as unknown as Record<string, unknown>)) {
      return;
    }

    const plan = (parent as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (String(plan?.status || '').toLowerCase() === 'active') {
      const rows = await loadPlanScheduleRows(parent);
      if (!RecurringVisitService.recurringPlanVisitsExhausted(parent, rows)) {
        return;
      }
    }

    const rows = await loadPlanScheduleRows(parent);
    const terminalRows = rows.filter((visit) => isVisitPassed(visit));
    const completedRowCount = terminalRows.filter(
      (visit) => String(visit.status) === 'completed',
    ).length;
    const planCompletedCount = Number(plan?.completedVisitCount || 0);
    const completedCount = Math.max(completedRowCount, planCompletedCount);
    const cancelledOnlyCount = terminalRows.filter((visit) =>
      ['cancelled', 'cancelled_late', 'skipped', 'skipped_unpaid'].includes(String(visit.status)),
    ).length;
    const allTerminalAreCancelledOnly =
      terminalRows.length > 0 && cancelledOnlyCount === terminalRows.length;

    // Keep explicit whole-plan cancellation as cancelled (customer ended the plan).
    const isExplicitPlanCancellation =
      String(parent.status || '').toLowerCase() === 'cancelled' &&
      String(plan?.pausedReason || '').toLowerCase() !== 'all_visits_closed' &&
      completedCount === 0;

    if (isExplicitPlanCancellation) {
      if (plan.status !== 'ended') {
        plan.status = 'ended';
        plan.endedAt = plan.endedAt || new Date();
        (parent as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
        parent.markModified('recurringPlan');
        await parent.save();
        invalidateTaskDetailCache(parentId);
      }
      return;
    }

    const targetParentStatus = allTerminalAreCancelledOnly && completedCount === 0
      ? 'cancelled'
      : completedCount > 0
        ? 'completed'
        : String(parent.status || '').toLowerCase();
    const shouldUpdateParentStatus =
      targetParentStatus === 'completed' || targetParentStatus === 'cancelled';

    plan.status = 'ended';
    plan.endedAt = plan.endedAt || new Date();
    plan.pausedReason = 'all_visits_closed';

    if (shouldUpdateParentStatus) {
      parent.status = targetParentStatus as ITask['status'];
      parent.completedAt = targetParentStatus === 'completed'
        ? parent.completedAt ?? new Date()
        : undefined;
      if (targetParentStatus === 'cancelled') {
        parent.cancelledAt = parent.cancelledAt ?? new Date();
      }
    }
    (parent as unknown as { activeVisitId?: string }).activeVisitId = undefined;
    parent.startedAt = undefined;
    parent.schedule = rows as unknown as ITask['schedule'];
    (parent as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
    parent.markModified('schedule');
    parent.markModified('recurringPlan');
    parent.markModified('activeVisitId');
    await parent.save();
    invalidateTaskDetailCache(parentId);

    logger.info('[RecurringVisitService] Recurring plan parent finalized after all visits closed', {
      parentId,
      status: parent.status,
      completedCount,
      terminalCount: terminalRows.length,
    });
  }

  static async finalizeRecurringPlanIfExhausted(parentId: string): Promise<boolean> {
    await RecurringVisitService.ensureMaterializedBuffer(parentId);

    const parent = await Task.findById(parentId);
    if (!parent || !isRecurringVisitPlanTask(parent as unknown as Record<string, unknown>)) {
      return false;
    }

    const plan = (parent as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (plan.status === 'ended') return true;
    if (plan.status === 'paused') return false;

    const rows = await loadPlanScheduleRows(parent);
    if (!RecurringVisitService.recurringPlanVisitsExhausted(parent, rows)) {
      return false;
    }

    await RecurringVisitService.markRecurringPlanParentCompleted(parentId);
    return true;
  }

  static async onChildVisitCancelled(
    childTask: ITask,
    options?: { reason?: string; cancelledByProfileId?: mongoose.Types.ObjectId },
  ): Promise<void> {
    if (!childTask.parentTaskId || !childTask.recurringVisitId) return;

    const parentId = String(childTask.parentTaskId);
    const parent = await Task.findById(parentId);
    if (!parent || !isRecurringVisitPlanTask(parent as unknown as Record<string, unknown>)) {
      return;
    }

    const plan = (parent as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (plan.status === 'ended') return;

    await hydrateTaskVisitsOntoSchedule(parent);
    const visit = findVisit(parent, childTask.recurringVisitId);
    if (!visit || VISIT_TERMINAL_STATUSES.has(visit.status as VisitStatus)) {
      return;
    }

    const visitStart = new Date(visit.date);
    const visitTime = visit.scheduledTimeStart;
    if (visitTime && typeof visitTime === 'string') {
      const timeMatch = visitTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const mins = parseInt(timeMatch[2], 10);
        const mod = timeMatch[3]?.toLowerCase();
        if (mod === 'pm' && hours < 12) hours += 12;
        if (mod === 'am' && hours === 12) hours = 0;
        visitStart.setHours(hours, mins, 0, 0);
      }
    }
    const hoursUntilVisit =
      (visitStart.getTime() - Date.now()) / (60 * 60 * 1000);
    visit.status =
      hoursUntilVisit < DEFAULT_SKIP_FREE_HOURS_BEFORE_VISIT
        ? 'cancelled_late'
        : 'cancelled';
    visit.updatedAt = new Date();
    if (options?.reason) {
      visit.skipReason = options.reason;
    }
    RecurringVisitService.clearVisitCancelRequest(visit);
    RecurringVisitService.clearVisitRescheduleRequest(visit);
    if (visit.paymentStatus === 'held' || visit.paymentStatus === 'released') {
      visit.paymentStatus = 'refunded';
    }

    const activeVisitId = (parent as unknown as { activeVisitId?: string }).activeVisitId;
    if (activeVisitId === visit.visitId) {
      (parent as unknown as { activeVisitId?: string }).activeVisitId = undefined;
    }

    parent.status = 'assigned';
    parent.startedAt = undefined;
    const rows = getScheduleRows(parent);
    const rowIdx = rows.findIndex((row) => row.visitId === visit.visitId);
    if (rowIdx >= 0) {
      rows[rowIdx] = visit;
    }
    parent.schedule = rows as unknown as ITask['schedule'];
    await saveRecurringPlanDocument(parent, parentId, rows);

    if (
      options?.cancelledByProfileId &&
      parent.requesterId.equals(options.cancelledByProfileId)
    ) {
      await RecurringVisitService.notifyTaskerRecurringVisitCancelled(parent, visit);
    }

    await RecurringVisitService.ensureMaterializedBuffer(parentId);

    if (plan.status === 'active') {
      const opened = await RecurringVisitService.openNextVisitForPayment(parentId, {
        skipReconcile: true,
      });

      if (!opened) {
        await RecurringVisitService.finalizeRecurringPlanIfExhausted(parentId);
      }
    }
  }

  /** Cancel an unpaid scheduled visit (no child task yet) — no escrow refund needed. */
  static async cancelUnpaidVisitOnPlan(params: {
    taskId: string;
    visitId: string;
    requesterProfileId: mongoose.Types.ObjectId;
    reason?: string;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (plan.status === 'ended') {
      throw new BadRequestError('Recurring plan has already ended');
    }

    await hydrateTaskVisitsOntoSchedule(task);
    const visit = findVisit(task, params.visitId);
    if (!visit) throw new NotFoundError('Visit not found');
    if (VISIT_TERMINAL_STATUSES.has(visit.status as VisitStatus)) {
      throw new BadRequestError('This visit is already closed');
    }
    if (visit.childTaskId) {
      throw new BadRequestError(
        'This visit has an assigned task — cancel it from the visit work page',
      );
    }
    if (!['scheduled', 'payment_pending'].includes(String(visit.status))) {
      throw new BadRequestError('This visit cannot be cancelled');
    }

    if (visit.status === 'payment_pending') {
      const paidEscrow = await resolvePaidEscrowForVisit(params.taskId, params.visitId);
      if (paidEscrow) {
        throw new BadRequestError(
          'This visit has payment held — cancel it from the visit work page',
        );
      }
    }

    const visitStart = new Date(visit.date);
    const hoursUntilVisit =
      (visitStart.getTime() - Date.now()) / (60 * 60 * 1000);
    visit.status =
      hoursUntilVisit < DEFAULT_SKIP_FREE_HOURS_BEFORE_VISIT
        ? 'cancelled_late'
        : 'cancelled';
    visit.updatedAt = new Date();
    if (params.reason) {
      visit.skipReason = params.reason;
    }
    RecurringVisitService.clearVisitCancelRequest(visit);
    RecurringVisitService.clearVisitRescheduleRequest(visit);

    const activeVisitId = (task as unknown as { activeVisitId?: string }).activeVisitId;
    if (activeVisitId === visit.visitId) {
      (task as unknown as { activeVisitId?: string }).activeVisitId = undefined;
    }

    const rows = getScheduleRows(task);
    const rowIdx = rows.findIndex((row) => row.visitId === visit.visitId);
    if (rowIdx >= 0) {
      rows[rowIdx] = visit;
    }
    task.schedule = rows as unknown as ITask['schedule'];
    await saveRecurringPlanDocument(task, params.taskId, rows);

    await RecurringVisitService.notifyTaskerRecurringVisitCancelled(task, visit);

    await RecurringVisitService.ensureMaterializedBuffer(params.taskId);
    const opened = await RecurringVisitService.openNextVisitForPayment(params.taskId, {
      skipReconcile: true,
    });
    if (!opened) {
      await RecurringVisitService.finalizeRecurringPlanIfExhausted(params.taskId);
    }
  }

  static async onChildVisitCompleted(childTask: ITask): Promise<void> {
    if (!childTask.parentTaskId || !childTask.recurringVisitId) return;

    const parent = await Task.findById(childTask.parentTaskId);
    if (!parent || !isRecurringVisitPlanTask(parent as unknown as Record<string, unknown>)) {
      return;
    }

    await hydrateTaskVisitsOntoSchedule(parent);
    const visit = findVisit(parent, childTask.recurringVisitId);
    if (!visit || visit.status === 'completed') return;

    visit.status = 'completed';
    visit.updatedAt = new Date();

    const plan = (parent as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    plan.completedVisitCount = Number(plan.completedVisitCount || 0) + 1;
    plan.consecutiveUnpaidCount = 0;

    (parent as unknown as { activeVisitId?: string }).activeVisitId = undefined;
    parent.status = 'assigned';
    parent.startedAt = undefined;
    parent.completedAt = undefined;
    (parent as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
    const rows = getScheduleRows(parent);
    const rowIdx = rows.findIndex((r) => r.visitId === visit.visitId);
    if (rowIdx >= 0) rows[rowIdx] = visit;
    await saveRecurringPlanDocument(parent, parent._id.toString(), rows);

    await RecurringVisitService.ensureMaterializedBuffer(parent._id.toString());
    const opened = await RecurringVisitService.openNextVisitForPayment(parent._id.toString(), {
      skipReconcile: true,
    });
    if (!opened) {
      await RecurringVisitService.finalizeRecurringPlanIfExhausted(parent._id.toString());
    }
  }

  /** Demote payment_pending on deferred series visits; align activeVisitId with calendar order. */
  static async rebalancePaymentPendingVisits(taskId: string): Promise<boolean> {
    const task = await Task.findById(taskId);
    if (!task || !isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      return false;
    }

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (String(plan?.status || '').toLowerCase() !== 'active') return false;

    const rows = await loadPlanScheduleRows(task);
    const chronoTarget = findNextChronologicalPayableVisit(rows);
    let changed = false;

    for (const visit of rows) {
      if (visit.status !== 'payment_pending') continue;
      if (visitRowHasHeldPayment(visit)) continue;

      const shouldKeep =
        chronoTarget?.visitId === visit.visitId &&
        !isVisitDeferredByEarlierChronologicalVisit(visit, rows);
      if (shouldKeep) continue;

      visit.status = 'scheduled';
      visit.paymentStatus = 'not_required';
      visit.paymentDeadline = undefined;
      visit.updatedAt = new Date();
      changed = true;
    }

    const chronoCurrent = resolveChronologicalCurrentVisitRow(rows);
    const activeVisitId = String(
      (task as unknown as { activeVisitId?: string }).activeVisitId || '',
    ).trim();
    if (chronoCurrent?.visitId && chronoCurrent.visitId !== activeVisitId) {
      (task as unknown as { activeVisitId?: string }).activeVisitId = chronoCurrent.visitId;
      changed = true;
    }

    if (changed) {
      await saveRecurringPlanDocument(task, taskId, rows);
    }

    return changed;
  }

  static async openNextVisitForPayment(
    taskId: string,
    options?: OpenNextVisitForPaymentOptions,
  ): Promise<{ visitId: string; amount: number; paymentDeadline: Date } | null> {
    let task = await Task.findById(taskId);
    if (!task) return null;

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (!plan || plan.status !== 'active') return null;

    await RecurringVisitService.rebalancePaymentPendingVisits(taskId);

    task = await Task.findById(taskId);
    if (!task) return null;

    let rows = await loadPlanScheduleRows(task);
    let existingPending = resolvePendingPaymentVisitRow(rows);
    if (existingPending) {
      return resolvePendingPaymentPayload(existingPending, plan);
    }

    if (!options?.skipReconcile) {
      await RecurringVisitService.reconcilePlanState(taskId);
      await RecurringVisitService.ensureMaterializedBuffer(taskId);

      task = await Task.findById(taskId);
      if (!task) return null;

      await RecurringVisitService.rebalancePaymentPendingVisits(taskId);
      task = await Task.findById(taskId);
      if (!task) return null;

      rows = await loadPlanScheduleRows(task);
      existingPending = resolvePendingPaymentVisitRow(rows);
      if (existingPending) {
        return resolvePendingPaymentPayload(existingPending, plan);
      }
    }

    const sorted = sortScheduleRows(rows);

    let hasActiveIncompleteVisit = false;
    for (const visit of sorted) {
      if (!['confirmed', 'in_progress'].includes(String(visit.status))) continue;
      if (!visitRowHasHeldPayment(visit)) continue;
      if (visit.childTaskId) {
        const child = await Task.findById(visit.childTaskId).select('status').lean();
        if (child?.status === 'completed' || child?.status === 'cancelled') continue;
      }
      hasActiveIncompleteVisit = true;
      break;
    }
    if (hasActiveIncompleteVisit) return null;

    const nextVisit =
      findNextChronologicalPayableVisit(rows) ?? findNextPayableVisit(sorted);
    if (!nextVisit) return null;

    if (nextVisit.status === 'payment_pending') {
      return resolvePendingPaymentPayload(nextVisit, plan);
    }

    if (nextVisit.status !== 'scheduled') return null;

    const now = new Date();
    nextVisit.status = 'payment_pending';
    nextVisit.paymentStatus = 'pending';
    nextVisit.escrowId = undefined;
    nextVisit.paidAt = undefined;
    nextVisit.amount = Number(plan.budgetPerVisit ?? task.budget?.amount ?? 0);
    nextVisit.assigneeId = plan.taskerProfileId as mongoose.Types.ObjectId;
    nextVisit.assigneeUid = String(plan.taskerUid || '');
    nextVisit.paymentDeadline = getPaymentDeadline(new Date(nextVisit.date));
    nextVisit.updatedAt = now;

    await RecurringVisitService.ensureChildTaskForVisit(task, nextVisit);
    if (nextVisit.childTaskId) {
      const child = await Task.findById(nextVisit.childTaskId);
      if (
        child &&
        child.status !== 'assigned' &&
        child.status !== 'completed' &&
        child.status !== 'cancelled'
      ) {
        child.status = 'assigned';
        child.startedAt = undefined;
        child.startOtp = undefined;
        await child.save();
      }
    }
    (task as unknown as { activeVisitId?: string }).activeVisitId = nextVisit.visitId;

    await saveRecurringPlanDocument(task, taskId, rows);

    return {
      visitId: nextVisit.visitId,
      amount: Number(nextVisit.amount),
      paymentDeadline: nextVisit.paymentDeadline,
    };
  }

  static tryDecodeMetaFromTaskData(taskData: Record<string, unknown>): RecurringMetaPayload | null {
    return decodeRecurringMetaFromTask(taskData);
  }

  static async findActiveVisitChildInProgress(
    parentTaskId: string,
  ): Promise<ITask | null> {
    const child = await Task.findOne({
      parentTaskId,
      status: { $in: ['started', 'in_progress', 'review'] },
    })
      .select('_id status recurringVisitId title')
      .lean();
    return child as ITask | null;
  }

  static async findBlockingPaidVisitNotStarted(task: ITask): Promise<ScheduleVisitRow | null> {
    const rows = getScheduleRows(task);
    for (const visit of rows) {
      const status = String(visit.status || '');
      if (!['confirmed', 'payment_pending', 'in_progress'].includes(status)) continue;
      if (!visitRowHasHeldPayment(visit)) continue;
      if (!visit.childTaskId) continue;
      const child = await Task.findById(visit.childTaskId).select('status').lean();
      if (child?.status === 'assigned') {
        return visit;
      }
    }
    return null;
  }

  static async assertPlanCanBeEnded(task: ITask): Promise<void> {
    const inProgress = await RecurringVisitService.findActiveVisitChildInProgress(
      String(task._id),
    );
    if (inProgress) {
      throw new BadRequestError(
        'A visit is currently in progress. Complete or resolve the current visit before cancelling the recurring task.',
      );
    }
  }

  private static getVisitStartDateForCancellationPolicy(
    planTask: ITask,
    visit: ScheduleVisitRow,
  ): Date {
    const visitStart = new Date(visit.date);
    const visitTime =
      visit.scheduledTimeStart ||
      (planTask as unknown as { recurringPlan?: { visitTime?: string } }).recurringPlan
        ?.visitTime ||
      planTask.scheduledTimeStart;
    if (visitTime && typeof visitTime === 'string') {
      const timeMatch = visitTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const mins = parseInt(timeMatch[2], 10);
        const mod = timeMatch[3]?.toLowerCase();
        if (mod === 'pm' && hours < 12) hours += 12;
        if (mod === 'am' && hours === 12) hours = 0;
        visitStart.setHours(hours, mins, 0, 0);
      }
    }
    return visitStart;
  }

  private static async resolveProfileUid(
    profileId: mongoose.Types.ObjectId,
  ): Promise<string | undefined> {
    const Profile = mongoose.connection.collection('profiles');
    const profile = await Profile.findOne({ _id: profileId });
    if (!profile || typeof profile !== 'object' || !('uid' in profile)) {
      return undefined;
    }
    const uid = (profile as { uid?: unknown }).uid;
    return typeof uid === 'string' && uid.trim() ? uid.trim() : undefined;
  }

  private static async resolveTaskRequesterUid(task: ITask): Promise<string | undefined> {
    const direct = String(task.requesterUid || '').trim();
    if (direct) return direct;
    return RecurringVisitService.resolveProfileUid(task.requesterId);
  }

  /**
   * Refund held visit payment when a visit or plan is cancelled before work starts.
   * Idempotent — skips visits with no held payment or already refunded escrow.
   */
  static async refundVisitPaymentOnCancel(params: {
    planTask: ITask;
    visit: ScheduleVisitRow;
    cancelledBy: 'poster' | 'performer';
    requesterUid?: string;
    reason?: string;
  }): Promise<{ refunded: boolean; skipped?: boolean; error?: string }> {
    const { planTask, visit, cancelledBy, requesterUid, reason } = params;
    const paymentStatus = String(visit.paymentStatus || '').toLowerCase();

    if (paymentStatus === 'refunded') {
      return { refunded: false, skipped: true };
    }

    const planId = String(planTask._id);
    const paidEscrow = await resolvePaidEscrowForVisit(planId, visit.visitId);
    const hasHeldOnRow =
      visitRowHasHeldPayment(visit) ||
      paymentStatus === 'held' ||
      paymentStatus === 'released';

    if (!paidEscrow && !hasHeldOnRow) {
      return { refunded: false, skipped: true };
    }

    const escrowRecordId =
      paidEscrow?.escrowId || String(visit.escrowId || '').trim() || undefined;
    const visitStart = RecurringVisitService.getVisitStartDateForCancellationPolicy(
      planTask,
      visit,
    );
    const plan = (planTask.recurringPlan || {}) as { budgetPerVisit?: number };
    const budgetObj = planTask.budget as { amount?: number } | undefined;
    const feeBaseAmount =
      typeof visit.amount === 'number' && Number.isFinite(visit.amount)
        ? visit.amount
        : typeof plan.budgetPerVisit === 'number'
          ? plan.budgetPerVisit
          : typeof budgetObj?.amount === 'number'
            ? budgetObj.amount
            : undefined;

    try {
      const payResult = await PaymentClient.cancelPaymentForTask({
        taskId: escrowRecordId ? undefined : planId,
        escrowId: escrowRecordId,
        reason: reason || 'Recurring visit cancelled',
        userId: requesterUid,
        cancelledBy,
        taskStartDate: visitStart.toISOString(),
        assignedAt: planTask.assignedAt
          ? new Date(planTask.assignedAt).toISOString()
          : undefined,
        feeBaseAmount,
        taskTitle: RecurringVisitService.resolveVisitWorkTitle(planTask, visit),
      });

      const errorText = String(payResult.error || '').toLowerCase();
      if (
        !payResult.success &&
        !errorText.includes('already refunded') &&
        !errorText.includes('escrow already refunded')
      ) {
        logger.warn('[RecurringVisitService.refundVisitPaymentOnCancel] Refund failed', {
          planTaskId: planId,
          visitId: visit.visitId,
          error: payResult.error,
        });
        return { refunded: false, error: payResult.error || 'Refund failed' };
      }

      visit.paymentStatus = 'refunded';
      visit.updatedAt = new Date();
      return { refunded: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[RecurringVisitService.refundVisitPaymentOnCancel] Refund error', {
        planTaskId: planId,
        visitId: visit.visitId,
        error: message,
      });
      return { refunded: false, error: message };
    }
  }

  private static visitCanBeRescheduled(
    visit: ScheduleVisitRow,
    childStatus?: string,
  ): boolean {
    if (VISIT_TERMINAL_STATUSES.has(visit.status as VisitStatus)) return false;
    const normalizedChild = String(childStatus || '').toLowerCase();
    if (['started', 'in_progress', 'review', 'completed', 'cancelled'].includes(normalizedChild)) {
      return false;
    }
    return ['scheduled', 'payment_pending', 'confirmed', 'in_progress', 'open', 'assigned'].includes(
      String(visit.status || ''),
    );
  }

  /**
   * Repair held payment sitting on a later visit while an earlier visit still needs payment
   * (legacy bad transfers only — never undo a deliberate post-reschedule transfer).
   */
  private static isIntentionallyUnpaidRescheduleSlot(visit: ScheduleVisitRow): boolean {
    if (visitRowHasHeldPayment(visit)) return false;
    const status = String(visit.status || '');
    const paymentStatus = String(visit.paymentStatus || '');
    return (
      status === 'scheduled' &&
      (paymentStatus === 'not_required' || paymentStatus === 'pending')
    );
  }

  private static async repairMisplacedHeldPaymentsAfterReschedule(task: ITask): Promise<boolean> {
    const plan = (task as unknown as { recurringPlan?: { status?: string } }).recurringPlan;
    if (String(plan?.status || '').toLowerCase() !== 'active') return false;

    const rows = getScheduleRows(task);
    const sorted = sortScheduleRows(rows);
    const parentTaskId = String(task._id);
    const chronoCurrent = resolveChronologicalCurrentVisitRow(rows);

    const lastCompletedIdx = sorted.reduce(
      (max, visit, index) => (visit.status === 'completed' ? index : max),
      -1,
    );

    for (let visitIdx = 0; visitIdx < sorted.length; visitIdx += 1) {
      const visit = sorted[visitIdx];
      if (!visitRowHasHeldPayment(visit)) continue;
      if (visit.status === 'completed') continue;

      if (
        chronoCurrent?.visitId &&
        chronoCurrent.visitId === visit.visitId &&
        visitRowHasHeldPayment(visit)
      ) {
        continue;
      }

      for (let i = Math.max(0, lastCompletedIdx + 1); i < visitIdx; i += 1) {
        const candidate = sorted[i];
        if (candidate.status === 'completed') continue;
        if (VISIT_TERMINAL_STATUSES.has(candidate.status as VisitStatus)) continue;
        if (visitRowHasHeldPayment(candidate)) continue;
        if (RecurringVisitService.isIntentionallyUnpaidRescheduleSlot(candidate)) {
          continue;
        }
        if (String(candidate.status || '') !== 'payment_pending') {
          continue;
        }

        const escrowId = String(visit.escrowId || '').trim();
        if (!escrowId) continue;

        const fromVisitId = visit.visitId;

        const reassign = await PaymentClient.reassignRecurringVisitEscrow({
          escrowId,
          taskId: parentTaskId,
          fromVisitId,
          toVisitId: candidate.visitId,
        });
        if (!reassign.success) {
          logger.warn('[RecurringVisitService] Failed to repair misplaced visit payment', {
            parentTaskId,
            fromVisitId: visit.visitId,
            toVisitId: candidate.visitId,
            error: reassign.error,
          });
          continue;
        }

        candidate.escrowId = escrowId;
        candidate.paidAt = visit.paidAt ? new Date(visit.paidAt) : new Date();
        candidate.paymentStatus = 'held';
        if (typeof visit.amount === 'number') {
          candidate.amount = visit.amount;
        }
        if (visit.assigneeId && !candidate.assigneeId) {
          candidate.assigneeId = visit.assigneeId;
        }
        if (visit.assigneeUid && !candidate.assigneeUid) {
          candidate.assigneeUid = visit.assigneeUid;
        }

        const candidateStatus = String(candidate.status);
        if (['scheduled', 'payment_pending', 'confirmed'].includes(candidateStatus)) {
          candidate.status = 'confirmed';
        }
        candidate.updatedAt = new Date();

        const clearedChildTaskId = visit.childTaskId ?? null;
        RecurringVisitService.clearVisitHeldPaymentState(visit);
        await RecurringVisitService.deleteRecurringVisitChildTask(clearedChildTaskId);
        await RecurringVisitService.ensureChildTaskForVisit(task, candidate);

        task.schedule = rows as unknown as ITask['schedule'];
        task.markModified('schedule');
        await task.save();
        invalidateTaskDetailCache(parentTaskId);

        logger.info('[RecurringVisitService] Repaired misplaced visit payment after reschedule', {
          parentTaskId,
          fromVisitId: visit.visitId,
          toVisitId: candidate.visitId,
          escrowId,
        });
        return true;
      }
    }

    return false;
  }

  /** Next unpaid visit in series order after the last completed visit (payment queue). */
  private static resolveNextVisitForPaymentTransfer(
    rows: ScheduleVisitRow[],
    sourceVisit: ScheduleVisitRow,
  ): ScheduleVisitRow | undefined {
    const sorted = sortScheduleRows(rows);
    const sourceIdx = sorted.findIndex((row) => row.visitId === sourceVisit.visitId);

    const isEligibleTarget = (candidate: ScheduleVisitRow): boolean => {
      if (candidate.visitId === sourceVisit.visitId) return false;
      if (candidate.status === 'completed') return false;
      if (VISIT_TERMINAL_STATUSES.has(candidate.status as VisitStatus)) return false;
      if (visitRowHasHeldPayment(candidate)) return false;
      const status = String(candidate.status || '');
      return ['scheduled', 'payment_pending', 'confirmed', 'open', 'assigned'].includes(
        status,
      );
    };

    const lastCompletedIdx = sorted.reduce(
      (max, visit, index) => (visit.status === 'completed' ? index : max),
      -1,
    );

    const searchStart = Math.max(0, lastCompletedIdx + 1);
    for (let i = searchStart; i < sorted.length; i += 1) {
      const candidate = sorted[i];
      if (isEligibleTarget(candidate)) {
        return candidate;
      }
    }

    if (sourceIdx >= 0) {
      for (let i = searchStart; i < sourceIdx; i += 1) {
        const candidate = sorted[i];
        if (isEligibleTarget(candidate)) {
          return candidate;
        }
      }
    }

    for (const candidate of sorted) {
      if (isEligibleTarget(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  /** Clear held payment on a visit after reschedule transfer or refund. */
  private static clearVisitHeldPaymentState(
    visit: ScheduleVisitRow,
    options?: { paymentStatus?: VisitPaymentStatus },
  ): mongoose.Types.ObjectId | null {
    const childTaskId = visit.childTaskId ?? null;
    clearScheduleVisitHeldPaymentBinding(visit, options);
    if (['confirmed', 'in_progress'].includes(String(visit.status))) {
      visit.status = 'scheduled';
    }
    visit.updatedAt = new Date();
    return childTaskId;
  }

  private static async deleteRecurringVisitChildTask(
    childTaskId: mongoose.Types.ObjectId | string | null | undefined,
  ): Promise<void> {
    if (!childTaskId) return;
    const deletedChildId = String(childTaskId);
    try {
      await Task.findByIdAndDelete(childTaskId);
      invalidateTaskDetailCache(deletedChildId);
    } catch {
      // Best-effort cleanup — reconcile must not see a stale child for this visit.
    }
  }

  /**
   * When a paid visit is rescheduled, move its held payment to the next unpaid visit
   * (calendar-first, same queue as "Pay now") and require payment again for the rescheduled slot.
   */
  private static async transferHeldPaymentOnVisitReschedule(
    task: ITask,
    visit: ScheduleVisitRow,
  ): Promise<{
    transferred: boolean;
    toVisitId?: string;
    clearedChildTaskId?: mongoose.Types.ObjectId | null;
  }> {
    const parentTaskId = String(task._id);
    const visitRow = findVisit(task, visit.visitId) || visit;
    const heldEscrow = await resolveVisitHeldEscrowForRescheduleTransfer(
      parentTaskId,
      visitRow,
    );
    if (!heldEscrow) {
      return { transferred: false };
    }

    visitRow.escrowId = heldEscrow.escrowId;
    visitRow.paidAt = heldEscrow.paidAt;
    visitRow.paymentStatus = 'held';
    if (typeof heldEscrow.amount === 'number') {
      visitRow.amount = heldEscrow.amount;
    }

    const rows = getScheduleRows(task);
    const escrowId = heldEscrow.escrowId;
    const paidAt = heldEscrow.paidAt;
    const amount = visitRow.amount;
    let nextVisit = RecurringVisitService.resolveNextVisitForPaymentTransfer(rows, visitRow);

    if (nextVisit) {
      if (visitRowHasHeldPayment(nextVisit)) {
        throw new BadRequestError(
          'Cannot reschedule this visit: the next visit already has payment applied.',
        );
      }

      const toVisitId = String(nextVisit.visitId || '').trim();
      const escrowRecord =
        (await safeGetTaskEscrowRecord(parentTaskId, String(visitRow.visitId || ''))) ??
        (await PaymentClient.getEscrowByEscrowId(escrowId));
      const metaVisitId = readEscrowMetadataVisitId(escrowRecord);
      const fromVisitId = metaVisitId || String(visitRow.visitId || '').trim();
      let skipReassign = !fromVisitId || !toVisitId || fromVisitId === toVisitId;

      if (!skipReassign && metaVisitId && metaVisitId === toVisitId) {
        skipReassign = true;
        logger.info(
          '[RecurringVisitService] Escrow already bound to target visit — skipping reassign API',
          { parentTaskId, fromVisitId, toVisitId, escrowId },
        );
      }

      if (!skipReassign) {
        if (!metaVisitId || metaVisitId !== fromVisitId) {
          await alignEscrowVisitMetadataIfNeeded({
            taskId: parentTaskId,
            visitId: fromVisitId,
            escrowId,
            escrow: escrowRecord,
          });
        }

        const reassign = await PaymentClient.reassignRecurringVisitEscrow({
          escrowId,
          taskId: parentTaskId,
          fromVisitId,
          toVisitId,
        });
        if (!reassign.success) {
          throw new BadRequestError(
            reassign.error || 'Failed to transfer visit payment to the next visit',
          );
        }
      }

      nextVisit.escrowId = escrowId;
      nextVisit.paidAt = paidAt;
      nextVisit.paymentStatus = 'held';
      if (typeof amount === 'number') {
        nextVisit.amount = amount;
      }
      if (visit.assigneeId && !nextVisit.assigneeId) {
        nextVisit.assigneeId = visit.assigneeId;
      }
      if (visit.assigneeUid && !nextVisit.assigneeUid) {
        nextVisit.assigneeUid = visit.assigneeUid;
      }

      const nextStatus = String(nextVisit.status);
      if (['scheduled', 'payment_pending', 'confirmed'].includes(nextStatus)) {
        nextVisit.status = 'confirmed';
      }
      nextVisit.updatedAt = new Date();

      logger.info('[RecurringVisitService] Transferred visit payment on reschedule', {
        parentTaskId,
        fromVisitId: visitRow.visitId,
        toVisitId: nextVisit.visitId,
        escrowId,
      });
    } else {
      const requesterUid =
        (await RecurringVisitService.resolveProfileUid(task.requesterId)) || undefined;
      await RecurringVisitService.refundVisitPaymentOnCancel({
        planTask: task,
        visit: visitRow,
        cancelledBy: 'poster',
        requesterUid,
        reason: 'Visit rescheduled — payment cleared for re-booking',
      });

      logger.info('[RecurringVisitService] Refunded visit payment on last-visit reschedule', {
        parentTaskId,
        visitId: visitRow.visitId,
        escrowId,
      });
    }

    const clearedChildTaskId = RecurringVisitService.clearVisitHeldPaymentState(visitRow, {
      paymentStatus: nextVisit ? 'not_required' : 'pending',
    });

    return nextVisit
      ? { transferred: true, toVisitId: nextVisit.visitId, clearedChildTaskId }
      : { transferred: false, clearedChildTaskId };
  }

  private static assertPlanAllowsVisitReschedule(plan: Record<string, unknown>): void {
    if (String(plan.endType || '').toLowerCase() === 'until_cancelled') {
      throw new BadRequestError(
        'Individual visit rescheduling is not available for open-ended recurring plans. Cancel a visit or end the plan instead.',
      );
    }
  }

  private static assertPlanAllowsVisitCancelRequest(plan: Record<string, unknown>): void {
    if (String(plan.endType || '').toLowerCase() !== 'until_cancelled') {
      throw new BadRequestError(
        'Visit cancel requests are only available for open-ended recurring plans.',
      );
    }
  }

  private static visitCanRequestCancel(
    visit: ScheduleVisitRow,
    childStatus?: string,
  ): boolean {
    return RecurringVisitService.visitCanBeRescheduled(visit, childStatus);
  }

  private static clearVisitCancelRequest(visit: ScheduleVisitRow): void {
    visit.cancelRequest = undefined;
  }

  private static clearVisitRescheduleRequest(visit: ScheduleVisitRow): void {
    visit.rescheduleRequest = undefined;
  }

  private static assertVisitRescheduleDateAvailable(
    task: ITask,
    visit: ScheduleVisitRow,
    newDate: Date,
  ): void {
    const normalizedDate = normalizeDateOnly(newDate);
    const currentDate = normalizeDateOnly(new Date(visit.date));
    if (normalizedDate.getTime() === currentDate.getTime()) {
      throw new BadRequestError('New date must be different from the current visit date');
    }

    const rows = getScheduleRows(task);
    const conflict = rows.find(
      (row) =>
        row.visitId !== visit.visitId &&
        !VISIT_TERMINAL_STATUSES.has(row.status as VisitStatus) &&
        normalizeDateOnly(new Date(row.date)).getTime() === normalizedDate.getTime(),
    );
    if (conflict) {
      throw new BadRequestError('Another visit is already scheduled on that date');
    }
  }

  private static async applyVisitReschedule(params: {
    task: ITask;
    visit: ScheduleVisitRow;
    newDate: Date;
    scheduledTimeStart?: string;
    scheduledTimeEnd?: string;
  }): Promise<void> {
    const parentTaskId = String(params.task._id);
    await RecurringVisitService.ensureMaterializedBuffer(parentTaskId);

    const task = await Task.findById(parentTaskId);
    if (!task) throw new NotFoundError('Task not found');

    const visit = await requireHydratedVisit(task, params.visit.visitId);

    RecurringVisitService.assertVisitRescheduleDateAvailable(task, visit, params.newDate);

    const transferResult = await RecurringVisitService.transferHeldPaymentOnVisitReschedule(
      task,
      visit,
    );

    const visitRow = findVisit(task, visit.visitId) || visit;
    const normalizedDate = normalizeDateOnly(params.newDate);
    visitRow.date = normalizedDate;
    if (params.scheduledTimeStart) {
      visitRow.scheduledTimeStart = params.scheduledTimeStart;
    }
    if (params.scheduledTimeEnd) {
      visitRow.scheduledTimeEnd = params.scheduledTimeEnd;
    }
    visitRow.rescheduleRequest = undefined;
    visitRow.updatedAt = new Date();

    const rows = getScheduleRows(task);
    if (
      transferResult.transferred &&
      isVisitDeferredByEarlierChronologicalVisit(visitRow, rows)
    ) {
      visitRow.paymentStatus = 'not_required';
      visitRow.status = 'scheduled';
    }

    if (transferResult.transferred && transferResult.toVisitId) {
      (task as unknown as { activeVisitId?: string }).activeVisitId = transferResult.toVisitId;
      task.markModified('activeVisitId');
    }

    task.schedule = rows as unknown as ITask['schedule'];
    await saveRecurringPlanDocument(task, parentTaskId, rows);

    if (transferResult.clearedChildTaskId) {
      await RecurringVisitService.deleteRecurringVisitChildTask(transferResult.clearedChildTaskId);
    }

    if (transferResult.transferred && transferResult.toVisitId) {
      const reloaded = await Task.findById(parentTaskId);
      if (reloaded) {
        await hydrateTaskVisitsOntoSchedule(reloaded);
        const nextVisit = findVisit(reloaded, transferResult.toVisitId);
        if (nextVisit) {
          await RecurringVisitService.ensureChildTaskForVisit(reloaded, nextVisit);
          const reloadedRows = getScheduleRows(reloaded);
          reloaded.schedule = reloadedRows as unknown as ITask['schedule'];
          await saveRecurringPlanDocument(reloaded, parentTaskId, reloadedRows);
        }
      }
    } else if (visitRow.childTaskId) {
      const child = await Task.findById(visitRow.childTaskId);
      if (child && child.status === 'assigned') {
        child.scheduledDate = normalizedDate;
        if (params.scheduledTimeStart) {
          child.scheduledTimeStart = params.scheduledTimeStart;
        }
        if (params.scheduledTimeEnd) {
          child.scheduledTimeEnd = params.scheduledTimeEnd;
        }
        child.updatedAt = new Date();
        await child.save();
      }
    }

    if (!transferResult.transferred) {
      const afterSave = await Task.findById(parentTaskId);
      if (afterSave) {
        await RecurringVisitService.repairMisplacedHeldPaymentsAfterReschedule(afterSave);
      }
    }

    await RecurringVisitService.rebalancePaymentPendingVisits(parentTaskId);
    await RecurringVisitService.syncActiveVisitToChronologicalNext(parentTaskId);

    const refreshed = await Task.findById(parentTaskId);
    if (refreshed) {
      await hydrateTaskVisitsOntoSchedule(refreshed);
      const planStatus = String(
        (refreshed as unknown as { recurringPlan?: { status?: string } }).recurringPlan?.status ||
          '',
      ).toLowerCase();
      if (planStatus === 'active' && !transferResult.transferred) {
        const rescheduledVisit = findVisit(refreshed, visit.visitId);
        const rescheduledNeedsPayment =
          rescheduledVisit &&
          !visitRowHasHeldPayment(rescheduledVisit) &&
          !['completed', 'cancelled', 'skipped', 'skipped_unpaid'].includes(
            String(rescheduledVisit.status || ''),
          );

        if (rescheduledNeedsPayment) {
          const opened = await RecurringVisitService.openNextVisitForPayment(parentTaskId, {
            skipReconcile: true,
          });
          if (!opened) {
            await RecurringVisitService.syncActiveVisitToChronologicalNext(parentTaskId);
          }
        }
      }
    }
  }

  /** Point activeVisitId at the earliest actionable visit by calendar date. */
  static async syncActiveVisitToChronologicalNext(taskId: string): Promise<void> {
    const task = await Task.findById(taskId);
    if (!task || !isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      return;
    }

    const rows = getScheduleRows(task);
    const chronoCurrent = resolveChronologicalCurrentVisitRow(rows);
    let nextActiveId: string | undefined;

    if (chronoCurrent?.visitId) {
      const status = String(chronoCurrent.status || '');
      if (status === 'in_progress') {
        nextActiveId = chronoCurrent.visitId;
      } else if (status === 'payment_pending' || status === 'confirmed') {
        nextActiveId = chronoCurrent.visitId;
      } else if (status === 'scheduled') {
        const payable = findNextChronologicalPayableVisit(rows);
        nextActiveId = payable?.visitId ?? chronoCurrent.visitId;
      }
    }

    const currentActiveId = (task as unknown as { activeVisitId?: string }).activeVisitId;
    if (nextActiveId && nextActiveId !== currentActiveId) {
      (task as unknown as { activeVisitId?: string }).activeVisitId = nextActiveId;
      await task.save();
      invalidateTaskDetailCache(taskId);
    }
  }

  /** Customer: move one visit to a new date; payment and assignee stay linked. */
  static async rescheduleVisit(params: {
    taskId: string;
    visitId: string;
    requesterProfileId: mongoose.Types.ObjectId;
    newDate: Date;
    scheduledTimeStart?: string;
    scheduledTimeEnd?: string;
    reason?: string;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (plan.status === 'ended') {
      throw new BadRequestError('Recurring plan has already ended');
    }
    if (String(plan.status || '').toLowerCase() === 'paused') {
      throw new BadRequestError('Recurring plan is paused');
    }
    RecurringVisitService.assertPlanAllowsVisitReschedule(plan);

    const visit = await requireHydratedVisit(task, params.visitId);

    let childStatus = '';
    if (visit.childTaskId) {
      const child = await Task.findById(visit.childTaskId).select('status').lean();
      childStatus = String(child?.status || '');
    }

    if (!RecurringVisitService.visitCanBeRescheduled(visit, childStatus)) {
      throw new BadRequestError('This visit cannot be rescheduled');
    }

    const hoursUntil =
      (new Date(visit.date).getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursUntil < DEFAULT_SKIP_FREE_HOURS_BEFORE_VISIT) {
      logger.info('Recurring visit rescheduled within 24h window', {
        taskId: params.taskId,
        visitId: params.visitId,
      });
    }

    RecurringVisitService.assertVisitRescheduleDateAvailable(task, visit, params.newDate);

    await RecurringVisitService.applyVisitReschedule({
      task,
      visit,
      newDate: params.newDate,
      scheduledTimeStart: params.scheduledTimeStart,
      scheduledTimeEnd: params.scheduledTimeEnd,
    });

    const refreshedTask = await Task.findById(params.taskId);
    if (refreshedTask) {
      await hydrateTaskVisitsOntoSchedule(refreshedTask);
    }
    const refreshedVisit = refreshedTask
      ? findVisit(refreshedTask, params.visitId)
      : undefined;
    if (refreshedTask && refreshedVisit) {
      await RecurringVisitService.notifyTaskerRecurringVisitRescheduled(
        refreshedTask,
        refreshedVisit,
        {
          newDate: params.newDate,
          scheduledTimeStart: params.scheduledTimeStart,
          approvedRequest: false,
        },
      );
    }
  }

  /** Tasker: request a new date; customer must approve. */
  static async requestVisitReschedule(params: {
    taskId: string;
    visitId: string;
    taskerProfileId: mongoose.Types.ObjectId;
    newDate: Date;
    scheduledTimeStart?: string;
    scheduledTimeEnd?: string;
    reason?: string;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const isAssignedTasker =
      task.assigneeId?.equals(params.taskerProfileId) ||
      (plan?.taskerProfileId as mongoose.Types.ObjectId | undefined)?.equals(
        params.taskerProfileId,
      );
    if (!isAssignedTasker) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    if (plan.status === 'ended') {
      throw new BadRequestError('Recurring plan has already ended');
    }
    if (String(plan.status || '').toLowerCase() === 'paused') {
      throw new BadRequestError('Recurring plan is paused');
    }
    RecurringVisitService.assertPlanAllowsVisitReschedule(plan);

    const visit = await requireHydratedVisit(task, params.visitId);

    if (
      visit.rescheduleRequest &&
      String(visit.rescheduleRequest.status || '').toLowerCase() === 'pending'
    ) {
      throw new BadRequestError('A reschedule request is already pending for this visit');
    }
    if (
      visit.cancelRequest &&
      String(visit.cancelRequest.status || '').toLowerCase() === 'pending'
    ) {
      throw new BadRequestError('A cancel request is already pending for this visit');
    }

    let childStatus = '';
    if (visit.childTaskId) {
      const child = await Task.findById(visit.childTaskId).select('status').lean();
      childStatus = String(child?.status || '');
    }

    if (!RecurringVisitService.visitCanBeRescheduled(visit, childStatus)) {
      throw new BadRequestError('This visit cannot be rescheduled');
    }

    RecurringVisitService.assertVisitRescheduleDateAvailable(task, visit, params.newDate);

    visit.rescheduleRequest = {
      requestedBy: 'tasker',
      status: 'pending',
      newDate: normalizeDateOnly(params.newDate),
      scheduledTimeStart: params.scheduledTimeStart,
      scheduledTimeEnd: params.scheduledTimeEnd,
      reason: params.reason,
      requestedAt: new Date(),
    };
    visit.updatedAt = new Date();

    const rows = replaceVisitRowInSchedule(task, visit);
    await saveRecurringPlanDocument(task, params.taskId, rows);

    await RecurringVisitService.notifyCustomerRecurringVisitRescheduleRequested(task, visit, {
      newDate: params.newDate,
      scheduledTimeStart: params.scheduledTimeStart,
    });
  }

  /** Tasker: request visit cancellation on until-cancelled plans; customer decides. */
  static async requestVisitCancel(params: {
    taskId: string;
    visitId: string;
    taskerProfileId: mongoose.Types.ObjectId;
    reason?: string;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const isAssignedTasker =
      task.assigneeId?.equals(params.taskerProfileId) ||
      (plan?.taskerProfileId as mongoose.Types.ObjectId | undefined)?.equals(
        params.taskerProfileId,
      );
    if (!isAssignedTasker) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    if (plan.status === 'ended') {
      throw new BadRequestError('Recurring plan has already ended');
    }
    if (String(plan.status || '').toLowerCase() === 'paused') {
      throw new BadRequestError('Recurring plan is paused');
    }
    RecurringVisitService.assertPlanAllowsVisitCancelRequest(plan);

    await hydrateTaskVisitsOntoSchedule(task);
    const visit = findVisit(task, params.visitId);
    if (!visit) throw new NotFoundError('Visit not found');

    if (
      visit.cancelRequest &&
      String(visit.cancelRequest.status || '').toLowerCase() === 'pending'
    ) {
      throw new BadRequestError('A cancel request is already pending for this visit');
    }
    if (
      visit.rescheduleRequest &&
      String(visit.rescheduleRequest.status || '').toLowerCase() === 'pending'
    ) {
      throw new BadRequestError('A reschedule request is already pending for this visit');
    }

    let childStatus = '';
    if (visit.childTaskId) {
      const child = await Task.findById(visit.childTaskId).select('status').lean();
      childStatus = String(child?.status || '');
    }

    if (!RecurringVisitService.visitCanRequestCancel(visit, childStatus)) {
      throw new BadRequestError('This visit cannot be cancelled');
    }

    const trimmedReason = String(params.reason || '').trim();
    if (!trimmedReason) {
      throw new BadRequestError('A reason is required for cancel requests');
    }

    visit.cancelRequest = {
      requestedBy: 'tasker',
      status: 'pending',
      reason: trimmedReason,
      requestedAt: new Date(),
    };
    visit.updatedAt = new Date();

    const rows = getScheduleRows(task);
    const rowIdx = rows.findIndex((row) => row.visitId === visit.visitId);
    if (rowIdx >= 0) {
      rows[rowIdx] = visit;
    }
    task.schedule = rows as unknown as ITask['schedule'];
    await saveRecurringPlanDocument(task, params.taskId, rows);

    await RecurringVisitService.notifyCustomerRecurringVisitCancelRequested(task, visit, {
      reason: trimmedReason,
    });
  }

  /** Customer: dismiss a tasker cancel request without cancelling the visit. */
  static async respondVisitCancelRequest(params: {
    taskId: string;
    visitId: string;
    requesterProfileId: mongoose.Types.ObjectId;
    approved: boolean;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized');
    }

    await hydrateTaskVisitsOntoSchedule(task);
    const visit = findVisit(task, params.visitId);
    if (!visit) throw new NotFoundError('Visit not found');

    const request = visit.cancelRequest;
    if (!request || request.status !== 'pending') {
      throw new BadRequestError('No pending cancel request for this visit');
    }

    if (params.approved) {
      throw new BadRequestError(
        'Use cancel visit to approve a cancel request',
      );
    }

    visit.cancelRequest = {
      ...request,
      status: 'rejected',
      respondedAt: new Date(),
    };
    visit.updatedAt = new Date();

    const rows = getScheduleRows(task);
    const rowIdx = rows.findIndex((row) => row.visitId === visit.visitId);
    if (rowIdx >= 0) {
      rows[rowIdx] = visit;
    }
    task.schedule = rows as unknown as ITask['schedule'];
    await saveRecurringPlanDocument(task, params.taskId, rows);
  }

  /** Customer: approve or reject a tasker reschedule request. */
  static async respondVisitRescheduleRequest(params: {
    taskId: string;
    visitId: string;
    requesterProfileId: mongoose.Types.ObjectId;
    approved: boolean;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized');
    }

    const visit = await requireHydratedVisit(task, params.visitId);

    const request = visit.rescheduleRequest;
    if (!request || request.status !== 'pending') {
      throw new BadRequestError('No pending reschedule request for this visit');
    }

    const now = new Date();
    if (params.approved) {
      const approvedDate = new Date(request.newDate);
      await RecurringVisitService.applyVisitReschedule({
        task,
        visit,
        newDate: approvedDate,
        scheduledTimeStart: request.scheduledTimeStart,
        scheduledTimeEnd: request.scheduledTimeEnd,
      });

      const savedTask = await Task.findById(params.taskId);
      if (!savedTask) return;
      await hydrateTaskVisitsOntoSchedule(savedTask);
      const savedVisit = findVisit(savedTask, params.visitId);
      if (!savedVisit) return;

      savedVisit.rescheduleRequest = {
        ...request,
        status: 'approved',
        respondedAt: now,
      };
      const savedRows = replaceVisitRowInSchedule(savedTask, savedVisit);
      await saveRecurringPlanDocument(savedTask, params.taskId, savedRows);

      await RecurringVisitService.notifyTaskerRecurringVisitRescheduled(savedTask, savedVisit, {
        newDate: approvedDate,
        scheduledTimeStart: request.scheduledTimeStart,
        approvedRequest: true,
      });
      return;
    }

    visit.rescheduleRequest = undefined;
    visit.updatedAt = now;
    const rows = replaceVisitRowInSchedule(task, visit);
    await saveRecurringPlanDocument(task, params.taskId, rows);

    await RecurringVisitService.notifyTaskerRecurringVisitRescheduleRejected(task, visit);
  }

  /** Customer: manually pause an active recurring plan. */
  static async pausePlan(params: {
    taskId: string;
    requesterProfileId: mongoose.Types.ObjectId;
    reason?: string;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (!task.requesterId.equals(params.requesterProfileId)) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    await RecurringVisitService.assertPlanCanBeEnded(task);

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    if (plan.status === 'ended') {
      throw new BadRequestError('Recurring plan has already ended');
    }
    if (String(plan.endType || '').toLowerCase() === 'until_cancelled') {
      throw new BadRequestError(
        'Open-ended recurring plans cannot be paused. Reschedule individual visits or cancel the plan instead.',
      );
    }
    if (plan.status === 'paused') return;

    plan.status = 'paused';
    plan.pausedAt = new Date();
    plan.pausedReason = 'customer_paused';
    if (params.reason) {
      plan.pausedReason = params.reason;
    }

    (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
    task.markModified('recurringPlan');
    await task.save();
    invalidateTaskDetailCache(params.taskId);
  }

  /** Remove stale tasker bindings after leaving or repairing a recurring plan. */
  private static async clearTaskerRecurringPlanBindings(params: {
    planTaskId: string;
    taskerProfileId: mongoose.Types.ObjectId;
    cancelReason: string;
    parentStatus?: 'open' | 'cancelled';
  }): Promise<void> {
    const planObjectId = new mongoose.Types.ObjectId(params.planTaskId);
    const now = new Date();

    await Task.updateOne(
      { _id: planObjectId, assigneeId: params.taskerProfileId },
      {
        $set: {
          status: params.parentStatus ?? 'open',
          updatedAt: now,
        },
        $unset: { assigneeId: '', assigneeUid: '', activeVisitId: '' },
      },
    );

    invalidateTaskDetailCache(params.planTaskId);
  }

  /**
   * Cancel every non-terminal child visit task when a recurring plan is ended
   * (customer cancel or tasker leave). Uses updateTaskStatus when possible, then
   * force-cancels any remaining active children linked by parentTaskId or schedule.
   */
  private static async cancelAllPlanChildTasks(params: {
    planTaskId: string;
    cancelledByProfileId: mongoose.Types.ObjectId;
    cancelReason: string;
    planTask?: ITask;
  }): Promise<void> {
    const planObjectId = new mongoose.Types.ObjectId(params.planTaskId);
    const now = new Date();
    const { TaskService } = await import('./TaskService');

    const planTask =
      params.planTask ?? ((await Task.findById(params.planTaskId)) as ITask | null);
    const childIds = new Set<string>();

    if (planTask) {
      for (const visit of getScheduleRows(planTask)) {
        if (visit.childTaskId) {
          childIds.add(String(visit.childTaskId));
        }
      }
    }

    const linkedChildren = await Task.find({
      parentTaskId: planObjectId,
      status: { $nin: ['completed', 'cancelled'] },
    })
      .select('_id status')
      .lean();

    for (const child of linkedChildren) {
      childIds.add(String(child._id));
    }

    for (const childId of childIds) {
      const child = await Task.findById(childId).select('_id status').lean();
      if (!child) continue;
      const status = String(child.status || '');
      if (status === 'completed' || status === 'cancelled') continue;

      try {
        await TaskService.updateTaskStatus(
          childId,
          params.cancelledByProfileId,
          'cancelled',
          { cancellationReason: params.cancelReason },
        );
      } catch (error) {
        logger.warn('[RecurringVisitService] Failed to cancel recurring plan child task', {
          planTaskId: params.planTaskId,
          childTaskId: childId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await Task.updateMany(
      {
        parentTaskId: planObjectId,
        status: { $in: ['assigned', 'started', 'in_progress', 'review', 'open'] },
      },
      {
        $set: {
          status: 'cancelled',
          assigneeId: null,
          updatedAt: now,
          cancellationReason: params.cancelReason,
        },
        $unset: { assigneeUid: '' },
      },
    );

    if (childIds.size > 0) {
      const childObjectIds = [...childIds]
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (childObjectIds.length > 0) {
        await Task.updateMany(
          {
            _id: { $in: childObjectIds },
            status: { $in: ['assigned', 'started', 'in_progress', 'review', 'open'] },
          },
          {
            $set: {
              status: 'cancelled',
              assigneeId: null,
              updatedAt: now,
              cancellationReason: params.cancelReason,
            },
            $unset: { assigneeUid: '' },
          },
        );
      }
    }

    invalidateTaskDetailCache(params.planTaskId);
  }

  /** Tasker: leave the recurring plan — reopen remaining visits for customer reassignment. */
  static async leavePlanByTasker(params: {
    taskId: string;
    taskerProfileId: mongoose.Types.ObjectId;
    reason?: string;
  }): Promise<void> {
    const task = await Task.findById(params.taskId);
    if (!task) throw new NotFoundError('Task not found');

    const plan = (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan;
    const isAssignedTasker =
      task.assigneeId?.equals(params.taskerProfileId) ||
      (plan?.taskerProfileId as mongoose.Types.ObjectId | undefined)?.equals(
        params.taskerProfileId,
      );
    if (!isAssignedTasker) {
      throw new ForbiddenError('Not authorized');
    }
    if (!isRecurringVisitPlanTask(task as unknown as Record<string, unknown>)) {
      throw new BadRequestError('Not a recurring visit plan');
    }

    const cancelReason = params.reason || 'Tasker left recurring plan';
    const now = new Date();
    const planObjectId = new mongoose.Types.ObjectId(params.taskId);
    const requesterUid = await RecurringVisitService.resolveTaskRequesterUid(task);

    if (String(plan.status || '').toLowerCase() === 'ended') {
      await RecurringVisitService.withdrawTaskerAcceptedApplication({
        task,
        taskerProfileId: params.taskerProfileId,
        now,
      });
      await RecurringVisitService.clearTaskerRecurringPlanBindings({
        planTaskId: params.taskId,
        taskerProfileId: params.taskerProfileId,
        cancelReason,
        parentStatus: 'open',
      });
      return;
    }

    await RecurringVisitService.assertPlanCanBeEnded(task);

    await hydrateTaskVisitsOntoSchedule(task);
    const rows = getScheduleRows(task);
    const activeChildIds = await Task.find({
      parentTaskId: planObjectId,
      status: { $nin: ['completed', 'cancelled'] },
      recurringVisitId: { $exists: true, $nin: [null, ''] },
    })
      .select('_id recurringVisitId')
      .lean();
    const childIdsByVisitId = new Map<string, Set<string>>();
    for (const child of activeChildIds) {
      const visitId = String(child.recurringVisitId || '').trim();
      if (!visitId) continue;
      const bucket = childIdsByVisitId.get(visitId) ?? new Set<string>();
      bucket.add(String(child._id));
      childIdsByVisitId.set(visitId, bucket);
    }

    for (const visit of rows) {
      const status = String(visit.status || '');
      if (VISIT_TERMINAL_STATUSES.has(status as VisitStatus)) continue;
      if (status === 'in_progress') continue;
      if (!isVisitReopenedOnTaskerLeave(status)) continue;

      (visit as { assigneeId: mongoose.Types.ObjectId | null }).assigneeId = null;
      (visit as { assigneeUid: string | null }).assigneeUid = null;
      visit.updatedAt = now;

      const childIds = new Set<string>();
      if (visit.childTaskId) {
        childIds.add(String(visit.childTaskId));
      }
      for (const childId of childIdsByVisitId.get(visit.visitId) ?? []) {
        childIds.add(childId);
      }

      for (const childId of childIds) {
        await Task.updateOne(
          { _id: childId, status: { $nin: ['completed', 'cancelled'] } },
          {
            $set: {
              status: 'cancelled',
              assigneeId: null,
              updatedAt: now,
              cancellationReason: cancelReason,
            },
            $unset: { assigneeUid: '' },
          },
        );
      }
      (visit as { childTaskId: mongoose.Types.ObjectId | null }).childTaskId = null;

      const hadHeldPayment = visitRowHasHeldPayment(visit);
      if (hadHeldPayment) {
        const refundResult = await RecurringVisitService.refundVisitPaymentOnCancel({
          planTask: task,
          visit,
          cancelledBy: 'performer',
          requesterUid,
          reason: cancelReason,
        });
        if (refundResult.error) {
          throw new BadRequestError(
            refundResult.error ||
              'Could not refund payment for a visit. Please try again or contact support.',
          );
        }
      }

      visit.status = 'scheduled';
      visit.paymentStatus = 'pending';
      (visit as { escrowId: string | null }).escrowId = null;
      (visit as { paidAt: Date | null }).paidAt = null;

      if (visit.cancelRequest?.status === 'pending') {
        delete visit.cancelRequest;
      }
      if (visit.rescheduleRequest?.status === 'pending') {
        delete visit.rescheduleRequest;
      }
    }

    await RecurringVisitService.withdrawTaskerAcceptedApplication({
      task,
      taskerProfileId: params.taskerProfileId,
      now,
    });

    plan.status = 'active';
    plan.taskerProfileId = undefined;
    plan.taskerUid = undefined;
    plan.acceptedApplicationId = undefined;
    plan.pausedAt = undefined;
    plan.pausedReason = undefined;
    plan.endedAt = undefined;

    (task as unknown as { recurringPlan: Record<string, unknown> }).recurringPlan = plan;
    task.schedule = rows as unknown as ITask['schedule'];
    task.status = 'open';
    (task as unknown as { assigneeId?: mongoose.Types.ObjectId }).assigneeId = undefined;
    (task as unknown as { assigneeUid?: string }).assigneeUid = undefined;
    (task as unknown as { activeVisitId?: string }).activeVisitId = undefined;
    task.updatedAt = now;
    await saveRecurringPlanDocument(task, params.taskId, rows);

    await RecurringVisitService.notifyCustomerRecurringPlanTaskerLeft(task, {
      reason: cancelReason,
    });
  }

  private static async withdrawTaskerAcceptedApplication(params: {
    task: ITask;
    taskerProfileId: mongoose.Types.ObjectId;
    now: Date;
  }): Promise<void> {
    const plan = (params.task as unknown as { recurringPlan?: { acceptedApplicationId?: mongoose.Types.ObjectId } })
      .recurringPlan;
    const acceptedApplicationId = plan?.acceptedApplicationId;

    if (acceptedApplicationId) {
      await TaskApplication.findByIdAndUpdate(acceptedApplicationId, {
        status: 'withdrawn',
        updatedAt: params.now,
      });
      return;
    }

    await TaskApplication.updateOne(
      {
        taskId: params.task._id,
        applicantId: params.taskerProfileId,
        status: 'accepted',
      },
      {
        status: 'withdrawn',
        updatedAt: params.now,
      },
    );
  }
}
