/**
 * Recurring visit schedule — canonical types for embedded task.schedule[] (v1).
 * See docs/RECURRING_VISIT_SCHEDULE_DESIGN.md for state machines and API plan.
 */

import type mongoose from 'mongoose';

/** Mirrors mobile RecurringFrequencyPattern (stored on plan + __recur_meta tag). */
export type RecurringFrequencyPattern =
  | 'daily'
  | 'selected_weekdays'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly';

export type RecurringEndType = 'until_cancelled' | 'end_on_date';

export type RecurringPlanStatus = 'draft' | 'active' | 'paused' | 'ended';

export type RecurringPlanPauseReason =
  | 'consecutive_unpaid'
  | 'customer_paused'
  | 'tasker_ended'
  | 'customer_ended';

/**
 * Visit lifecycle status (replaces legacy open|reserved|assigned|completed|cancelled
 * for recurring visits after migration).
 */
export type VisitStatus =
  | 'scheduled'
  | 'payment_pending'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'skipped_unpaid'
  | 'cancelled'
  | 'cancelled_late';

export type VisitPaymentStatus =
  | 'not_required'
  | 'pending'
  | 'held'
  | 'released'
  | 'refunded'
  | 'failed';

export type VisitSkippedBy = 'customer' | 'system' | 'tasker';

/** Terminal visit states — after these, materializer may append next visit. */
export const VISIT_TERMINAL_STATUSES: ReadonlySet<VisitStatus> = new Set([
  'completed',
  'skipped',
  'skipped_unpaid',
  'cancelled',
  'cancelled_late',
]);

/** Visits that block tasker travel / OTP until payment completes. */
export const VISIT_UNPAID_STATUSES: ReadonlySet<VisitStatus> = new Set([
  'scheduled',
  'payment_pending',
]);

/** Visits shown to tasker as confirmed assigned work. */
export const VISIT_TASKER_ASSIGNED_STATUSES: ReadonlySet<VisitStatus> = new Set([
  'confirmed',
  'in_progress',
]);

/** Default number of future rows to keep materialized for until_cancelled plans. */
export const DEFAULT_MATERIALIZED_BUFFER_SIZE = 2;

/** Hours before visit when payment must be completed. */
export const DEFAULT_PAYMENT_CUTOFF_HOURS_BEFORE_VISIT = 24;

/** Hours before visit to send first payment reminder. */
export const DEFAULT_PAYMENT_REMINDER_HOURS_BEFORE_VISIT = 48;

/** Pause plan after this many consecutive skipped_unpaid visits. */
export const DEFAULT_CONSECUTIVE_UNPAID_PAUSE_THRESHOLD = 2;

/** Customer skip allowed without charge if more than this many hours before visit. */
export const DEFAULT_SKIP_FREE_HOURS_BEFORE_VISIT = 24;

export interface IRecurringPlan {
  status: RecurringPlanStatus;
  taskerProfileId?: mongoose.Types.ObjectId;
  taskerUid?: string;
  acceptedApplicationId?: mongoose.Types.ObjectId;
  pattern: RecurringFrequencyPattern;
  selectedWeekdays?: number[];
  endType: RecurringEndType;
  endDate?: Date;
  visitTime?: string;
  expectedDurationMinutes?: number;
  budgetPerVisit: number;
  lastMaterializedDate?: Date;
  materializedBufferSize: number;
  completedVisitCount: number;
  consecutiveUnpaidCount: number;
  pausedAt?: Date;
  pausedReason?: RecurringPlanPauseReason;
  endedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ITaskScheduleVisit {
  visitId: string;
  visitIndex: number;
  date: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  expectedDurationMinutes?: number;
  status: VisitStatus;
  paymentStatus: VisitPaymentStatus;
  escrowId?: string;
  paymentDeadline?: Date;
  paidAt?: Date;
  amount?: number;
  assigneeId?: mongoose.Types.ObjectId | null;
  assigneeUid?: string | null;
  childTaskId?: mongoose.Types.ObjectId | null;
  skippedAt?: Date;
  skippedBy?: VisitSkippedBy;
  skipReason?: string;
  cancellationChargeAmount?: number;
  paymentReminderSentAt?: Date;
  rescheduleRequest?: {
    requestedBy: 'customer' | 'tasker';
    status: 'pending' | 'approved' | 'rejected';
    newDate: Date;
    scheduledTimeStart?: string;
    scheduledTimeEnd?: string;
    reason?: string;
    requestedAt: Date;
    respondedAt?: Date;
  };
  cancelRequest?: {
    requestedBy: 'tasker';
    status: 'pending' | 'approved' | 'rejected';
    reason?: string;
    requestedAt: Date;
    respondedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurringVisitSummary {
  completedCount: number;
  upcomingCount: number;
  nextVisit?: ITaskScheduleVisit;
  planStatus: RecurringPlanStatus;
  /** Omitted when endType is until_cancelled */
  totalPlanned?: number;
  consecutiveUnpaidCount: number;
  isPaused: boolean;
}

/** Payment service metadata for per-visit escrow. */
export interface VisitEscrowMetadata {
  taskId: string;
  visitId: string;
  visitIndex: number;
  recurringPlan: true;
  parentTaskId: string;
}

/** Legacy schedule row shape (pre-migration). */
export interface ILegacyScheduleEntry {
  date: Date;
  status: 'open' | 'reserved' | 'assigned' | 'completed' | 'cancelled';
  assigneeId?: mongoose.Types.ObjectId | null;
  assigneeUid?: string | null;
}

export function isLegacyScheduleEntry(
  entry: ITaskScheduleVisit | ILegacyScheduleEntry,
): entry is ILegacyScheduleEntry {
  return !('visitId' in entry && entry.visitId);
}

export function isVisitTerminal(status: VisitStatus): boolean {
  return VISIT_TERMINAL_STATUSES.has(status);
}

export function canTaskerStartVisit(status: VisitStatus, paymentStatus: VisitPaymentStatus): boolean {
  return VISIT_TASKER_ASSIGNED_STATUSES.has(status) && paymentStatus === 'held';
}

/** Runtime visit row used by RecurringVisitService and collection migration layer. */
export interface ScheduleVisitRow {
  visitId: string;
  visitIndex: number;
  date: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  expectedDurationMinutes?: number;
  status: VisitStatus | string;
  paymentStatus: VisitPaymentStatus;
  escrowId?: string;
  paymentDeadline?: Date;
  paidAt?: Date;
  amount?: number;
  assigneeId?: mongoose.Types.ObjectId | null;
  assigneeUid?: string | null;
  childTaskId?: mongoose.Types.ObjectId | null;
  skippedAt?: Date;
  skippedBy?: string;
  skipReason?: string;
  paymentReminderSentAt?: Date;
  cancellationChargeAmount?: number;
  rescheduleRequest?: {
    requestedBy: 'customer' | 'tasker';
    status: 'pending' | 'approved' | 'rejected';
    newDate: Date;
    scheduledTimeStart?: string;
    scheduledTimeEnd?: string;
    reason?: string;
    requestedAt: Date;
    respondedAt?: Date;
  };
  cancelRequest?: {
    requestedBy: 'tasker';
    status: 'pending' | 'approved' | 'rejected';
    reason?: string;
    requestedAt: Date;
    respondedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}
