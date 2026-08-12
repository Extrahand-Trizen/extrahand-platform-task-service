/**
 * Hourly Helper cancellation — shared types (pure evaluation contract).
 * Orchestration / payment integration is out of scope for this module.
 */

import type { BookingOrderStatus } from '../../models/BookingOrder';

/** Matches Task.status enum in Task model. */
export type TaskStatus =
  | 'open'
  | 'assigned'
  | 'started'
  | 'in_progress'
  | 'review'
  | 'completed'
  | 'cancelled';

/** Matches Task.executionPhase enum in Task model. */
export type TaskExecutionPhase = 'assigned' | 'on_the_way' | 'arrived';

export type CancelledBy = 'CUSTOMER' | 'HELPER' | 'PLATFORM' | 'SYSTEM';

export type CancellationStatus = 'ALLOWED' | 'DENIED';

export type CancellationReasonCode =
  | 'FREE_CANCEL'
  | 'NO_HELPER_ASSIGNED'
  | 'LATE_FLAT_FEE'
  | 'POST_ARRIVAL_FEE'
  | 'CUSTOMER_NO_SHOW'
  | 'HELPER_CANCELLED'
  | 'PLATFORM_CANCELLED'
  | 'ALREADY_CANCELLED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'UNPAID'
  | 'INVALID_STATE';

/** True when Task has a real assigned helper (assigneeUid and/or assigneeId). */
export function isHelperAssignedOnTask(task: {
  assigneeUid?: string | null;
  assigneeId?: unknown;
} | null | undefined): boolean {
  if (!task) return false;
  const uid = typeof task.assigneeUid === 'string' ? task.assigneeUid.trim() : '';
  if (uid.length > 0) return true;
  return task.assigneeId != null && String(task.assigneeId).trim().length > 0;
}

/** Amounts payment-service will execute — no policy meaning. */
export type CancellationSettlement = {
  refundAmountPaise: number;
  workerCompensationPaise: number;
  platformRetainedAmountPaise: number;
};

export type HourlyCancellationContext = {
  /** Captured amount for this booking, paise. */
  paidAmountPaise: number;
  /** Catalog first-hour rate, paise (e.g. 9900). Used for POST_ARRIVAL / NO_SHOW. */
  firstHourRatePaise: number;
  cancelledBy: CancelledBy;
  /** Server clock when cancel is evaluated. */
  cancelledAt: Date;
  /** Scheduled visit start (UTC). */
  scheduledAt: Date;
  bookingStatus: BookingOrderStatus;
  taskStatus?: TaskStatus;
  /** Mongo Task.executionPhase when present. */
  taskExecutionPhase?: TaskExecutionPhase | null;
  /**
   * Whether a helper is actually assigned (Task.assigneeUid / assigneeId).
   * When false, customer cancel is full refund (no time-based fees).
   */
  helperAssigned: boolean;
};

export type HourlyCancellationResult = {
  status: CancellationStatus;
  reasonCode: CancellationReasonCode;
  reason: string;
  customerFeePaise: number;
  settlement: CancellationSettlement;
  refundRequired: boolean;
};

/** Persisted on BookingOrder for idempotency / disputes (written in later phases). */
export type PersistedHourlyCancellationResult = HourlyCancellationResult & {
  evaluatedAt: string; // ISO
  cancelledBy: CancelledBy;
};

export type HourlyCancellationOrchestratorOutcome =
  | 'UNPAID_ABANDONED'
  | 'IDEMPOTENT'
  | 'EVALUATED';

export type HourlyCancellationOrchestratorResult = {
  outcome: HourlyCancellationOrchestratorOutcome;
  /** True only when this call newly abandoned an unpaid checkout. */
  abandoned: boolean;
  /**
   * Present for IDEMPOTENT + EVALUATED.
   * Absent for UNPAID_ABANDONED (abandon path does not run the fee evaluator).
   */
  result?: HourlyCancellationResult;
  orderId: string;
  bookingStatus: BookingOrderStatus;
};

export type { BookingOrderStatus };
