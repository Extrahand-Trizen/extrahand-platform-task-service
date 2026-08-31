/**
 * Pure Hourly Helper cancellation evaluator.
 * No DB, Razorpay, notifications, or side effects.
 */

import { HOURLY_CANCELLATION_POLICY } from './hourlyCancellationPolicy';
import type {
  HourlyCancellationContext,
  HourlyCancellationResult,
  CancellationReasonCode,
  CancellationSettlement,
} from './cancellationTypes';

const MS_PER_MINUTE = 60_000;

function denied(
  reasonCode: CancellationReasonCode,
  reason: string,
): HourlyCancellationResult {
  return {
    status: 'DENIED',
    reasonCode,
    reason,
    customerFeePaise: 0,
    settlement: {
      refundAmountPaise: 0,
      workerCompensationPaise: 0,
      platformRetainedAmountPaise: 0,
    },
    refundRequired: false,
  };
}

function allowed(
  reasonCode: CancellationReasonCode,
  reason: string,
  paidAmountPaise: number,
  customerFeePaise: number,
): HourlyCancellationResult {
  const fee = clampFee(customerFeePaise, paidAmountPaise);
  const refundAmountPaise = paidAmountPaise - fee;
  // MVP: full fee to worker; platform keeps 0 (change only here later).
  const settlement: CancellationSettlement = {
    refundAmountPaise,
    workerCompensationPaise: fee,
    platformRetainedAmountPaise: 0,
  };

  const result: HourlyCancellationResult = {
    status: 'ALLOWED',
    reasonCode,
    reason,
    customerFeePaise: fee,
    settlement,
    refundRequired: refundAmountPaise > 0,
  };

  assertAllowedInvariants(result, paidAmountPaise);
  return result;
}

function clampFee(feePaise: number, paidAmountPaise: number): number {
  if (feePaise <= 0) return 0;
  if (feePaise > paidAmountPaise) return paidAmountPaise;
  return feePaise;
}

/** Public for unit tests — every ALLOWED result must satisfy these. */
export function assertAllowedInvariants(
  result: HourlyCancellationResult,
  paidAmountPaise: number,
): void {
  const { customerFeePaise, settlement } = result;
  const { refundAmountPaise, workerCompensationPaise, platformRetainedAmountPaise } =
    settlement;

  if (customerFeePaise < 0 || refundAmountPaise < 0) {
    throw new Error('Cancellation invariant: fee and refund must be >= 0');
  }
  if (workerCompensationPaise < 0 || platformRetainedAmountPaise < 0) {
    throw new Error('Cancellation invariant: worker and platform must be >= 0');
  }
  if (customerFeePaise > paidAmountPaise) {
    throw new Error('Cancellation invariant: fee must be <= paidAmount');
  }
  if (refundAmountPaise + customerFeePaise !== paidAmountPaise) {
    throw new Error('Cancellation invariant: refund + fee must equal paidAmount');
  }
  if (workerCompensationPaise + platformRetainedAmountPaise !== customerFeePaise) {
    throw new Error('Cancellation invariant: worker + platform must equal fee');
  }
}

function minutesUntilStart(scheduledAt: Date, cancelledAt: Date): number {
  return (scheduledAt.getTime() - cancelledAt.getTime()) / MS_PER_MINUTE;
}

function isWorkStarted(taskStatus?: HourlyCancellationContext['taskStatus']): boolean {
  return taskStatus === 'started' || taskStatus === 'in_progress';
}

function isWorkFinished(taskStatus?: HourlyCancellationContext['taskStatus']): boolean {
  return taskStatus === 'completed' || taskStatus === 'review';
}

function isArrived(ctx: HourlyCancellationContext): boolean {
  return ctx.taskExecutionPhase === 'arrived';
}

function postArrivalFeePaise(ctx: HourlyCancellationContext): number {
  return Math.min(ctx.firstHourRatePaise, ctx.paidAmountPaise);
}

/**
 * Evaluate hourly cancellation policy.
 * Interprets BookingOrderStatus / TaskStatus / Task.executionPhase internally.
 */
export function evaluateHourlyCancellation(
  ctx: HourlyCancellationContext,
): HourlyCancellationResult {
  const paid = Math.max(0, Math.trunc(ctx.paidAmountPaise));
  const firstHour = Math.max(0, Math.trunc(ctx.firstHourRatePaise));
  const normalized: HourlyCancellationContext = {
    ...ctx,
    paidAmountPaise: paid,
    firstHourRatePaise: firstHour,
  };

  if (
    normalized.bookingStatus === 'draft' ||
    normalized.bookingStatus === 'awaiting_payment'
  ) {
    return denied(
      'UNPAID',
      'Unpaid bookings must use abandon flow, not cancellation evaluation',
    );
  }

  if (
    normalized.bookingStatus === 'cancelled' ||
    normalized.bookingStatus === 'refunded'
  ) {
    return denied(
      'ALREADY_CANCELLED',
      'Booking is already cancelled or refunded',
    );
  }

  if (isWorkFinished(normalized.taskStatus)) {
    return denied('COMPLETED', 'Cannot cancel a completed booking');
  }

  // Helper / platform / system fault paths (except no-show) — customer not charged.
  if (normalized.cancelledBy === 'HELPER') {
    if (isWorkStarted(normalized.taskStatus)) {
      return denied(
        'IN_PROGRESS',
        'Helper cannot cancel through this path after work has started',
      );
    }
    return allowed(
      'HELPER_CANCELLED',
      'Helper cancelled the booking',
      paid,
      0,
    );
  }

  if (normalized.cancelledBy === 'PLATFORM') {
    return allowed(
      'PLATFORM_CANCELLED',
      'Platform cancelled the booking',
      paid,
      0,
    );
  }

  // SYSTEM after arrival, before start → customer no-show.
  if (normalized.cancelledBy === 'SYSTEM') {
    if (isWorkStarted(normalized.taskStatus)) {
      return denied(
        'IN_PROGRESS',
        'Cannot mark no-show after work has started',
      );
    }
    if (isArrived(normalized)) {
      return allowed(
        'CUSTOMER_NO_SHOW',
        'Customer no-show after helper arrival',
        paid,
        postArrivalFeePaise(normalized),
      );
    }
    return allowed(
      'PLATFORM_CANCELLED',
      'System cancelled before arrival',
      paid,
      0,
    );
  }

  // CUSTOMER
  if (normalized.cancelledBy === 'CUSTOMER') {
    if (isWorkStarted(normalized.taskStatus)) {
      return denied(
        'IN_PROGRESS',
        'Cannot cancel after work has started',
      );
    }

    // No helper assigned yet → 100% refund of amount paid (no time-based fees).
    if (!normalized.helperAssigned) {
      return allowed(
        'NO_HELPER_ASSIGNED',
        'Cancelled before a helper was assigned — full refund',
        paid,
        0,
      );
    }

    if (isArrived(normalized)) {
      return allowed(
        'POST_ARRIVAL_FEE',
        'Cancelled after helper arrived',
        paid,
        postArrivalFeePaise(normalized),
      );
    }

    const mins = minutesUntilStart(normalized.scheduledAt, normalized.cancelledAt);
    if (mins > HOURLY_CANCELLATION_POLICY.FREE_WINDOW_MINUTES) {
      return allowed(
        'FREE_CANCEL',
        'Cancelled outside the late-cancellation window',
        paid,
        0,
      );
    }

    return allowed(
      'LATE_FLAT_FEE',
      'Cancelled within the late-cancellation window',
      paid,
      HOURLY_CANCELLATION_POLICY.LATE_CANCEL_FEE_PAISE,
    );
  }

  return denied('INVALID_STATE', 'Unrecognized cancellation context');
}
