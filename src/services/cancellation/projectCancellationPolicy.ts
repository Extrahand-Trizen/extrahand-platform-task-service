/**
 * Multi-day consultation project cancellation policy (bookingKind: project).
 * Pure functions — settlement is precomputed here; payment must not recalculate.
 */

export const PROJECT_CANCELLATION_POLICY = {
  /** Free cancel if more than this many hours before planned/scheduled start. */
  FREE_WINDOW_HOURS: 24,
  /** Flat fee within 24h before start, partner assigned, work not started (paise). */
  WITHIN_24H_FEE_PAISE: 9900,
  /** Flat fee within 4h before start, partner assigned, work not started (paise). */
  WITHIN_4H_FEE_PAISE: 19900,
  /** Flat fee when partner reached / arrived but no project day started (paise). */
  PARTNER_REACHED_FEE_PAISE: 29900,
  /**
   * Mid-project admin fee on top of work-value retention (paise).
   * Clamped so customer always keeps non-negative refund.
   */
  MID_PROJECT_ADMIN_FEE_PAISE: 19900,
  /** Cap admin fee at this fraction of paid amount (basis points, 500 = 5%). */
  MID_PROJECT_ADMIN_FEE_BPS: 500,
} as const;

export type ProjectCancelDecision =
  | 'ALLOWED'
  | 'DENIED';

export type ProjectCancelTier =
  | 'no_partner'
  | 'free'
  | 'within_24h'
  | 'within_4h'
  | 'partner_reached'
  | 'mid_project_proration'
  | 'terminal';

export type ProjectCancellationSettlementPaise = {
  refundAmountPaise: number;
  workerCompensationPaise: number;
  platformRetainedAmountPaise: number;
};

export type ProjectCancellationEvaluation = {
  status: ProjectCancelDecision;
  tier: ProjectCancelTier;
  policyKey: string;
  reason: string;
  reasonCode?: string;
  /** Effective days counted as work done for proration (includes active day). */
  workDaysCounted: number;
  totalPlannedDays: number;
  settlement: ProjectCancellationSettlementPaise;
};

export type EvaluateProjectCancellationInput = {
  paidAmountPaise: number;
  cancelledAt: Date;
  /** Planned project start or task scheduledDate. */
  projectStartDate: Date;
  partnerAssigned: boolean;
  partnerReachedLocation: boolean;
  /** projectExecution.status */
  projectStatus?: string | null;
  totalPlannedDays: number;
  completedDayCount: number;
  activeDayNumber: number | null;
  /** Task status */
  taskStatus: string;
};

function clampPaise(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function hoursUntil(start: Date, now: Date): number {
  return (start.getTime() - now.getTime()) / (1000 * 60 * 60);
}

function isTerminalProjectStatus(status?: string | null): boolean {
  const s = String(status || '').trim().toLowerCase();
  return s === 'completed' || s === 'ended_early';
}

function isTerminalTaskStatus(status: string): boolean {
  const s = String(status || '').trim().toLowerCase();
  return s === 'completed' || s === 'cancelled' || s === 'review';
}

/**
 * Days of work already consumed for refund proration.
 * Active day counts as in-progress work (full day retained for partner share base).
 */
export function resolveProjectWorkDaysCounted(params: {
  completedDayCount: number;
  activeDayNumber: number | null;
  totalPlannedDays: number;
}): number {
  const total = Math.max(0, Math.trunc(params.totalPlannedDays) || 0);
  let done = Math.max(0, Math.trunc(params.completedDayCount) || 0);
  if (params.activeDayNumber != null) {
    done = Math.max(done, done + 1);
  }
  if (total > 0) return Math.min(total, done);
  return done;
}

function buildSettlement(params: {
  paidAmountPaise: number;
  refundAmountPaise: number;
  workerCompensationPaise: number;
}): ProjectCancellationSettlementPaise {
  const paid = clampPaise(params.paidAmountPaise);
  let refund = clampPaise(params.refundAmountPaise);
  let worker = clampPaise(params.workerCompensationPaise);
  if (refund + worker > paid) {
    // Prefer full refund integrity: shrink worker first, then refund.
    const overflow = refund + worker - paid;
    const shrinkWorker = Math.min(worker, overflow);
    worker -= shrinkWorker;
    refund = Math.max(0, refund - (overflow - shrinkWorker));
  }
  const platform = Math.max(0, paid - refund - worker);
  return {
    refundAmountPaise: refund,
    workerCompensationPaise: worker,
    platformRetainedAmountPaise: platform,
  };
}

function midProjectAdminFeePaise(paidAmountPaise: number): number {
  const paid = clampPaise(paidAmountPaise);
  const bpsFee = Math.trunc((paid * PROJECT_CANCELLATION_POLICY.MID_PROJECT_ADMIN_FEE_BPS) / 10000);
  return Math.min(PROJECT_CANCELLATION_POLICY.MID_PROJECT_ADMIN_FEE_PAISE, bpsFee || 0);
}

/**
 * Pure evaluator for consultation multi-day project customer cancel.
 */
export function evaluateProjectCancellation(
  input: EvaluateProjectCancellationInput,
): ProjectCancellationEvaluation {
  const paid = clampPaise(input.paidAmountPaise);
  const totalPlannedDays = Math.max(1, Math.trunc(input.totalPlannedDays) || 1);
  const workDaysCounted = resolveProjectWorkDaysCounted({
    completedDayCount: input.completedDayCount,
    activeDayNumber: input.activeDayNumber,
    totalPlannedDays,
  });

  if (isTerminalTaskStatus(input.taskStatus) || isTerminalProjectStatus(input.projectStatus)) {
    return {
      status: 'DENIED',
      tier: 'terminal',
      policyKey: 'project_cancel_terminal',
      reason: 'This project can no longer be cancelled',
      reasonCode: 'PROJECT_CANCEL_TERMINAL',
      workDaysCounted,
      totalPlannedDays,
      settlement: buildSettlement({
        paidAmountPaise: paid,
        refundAmountPaise: 0,
        workerCompensationPaise: 0,
      }),
    };
  }

  // All planned days already completed — raise-issue path only.
  if (workDaysCounted >= totalPlannedDays && input.completedDayCount >= totalPlannedDays) {
    return {
      status: 'DENIED',
      tier: 'terminal',
      policyKey: 'project_cancel_all_days_done',
      reason: 'All project days are complete. Use raise issue if you need help.',
      reasonCode: 'PROJECT_CANCEL_ALL_DAYS_DONE',
      workDaysCounted,
      totalPlannedDays,
      settlement: buildSettlement({
        paidAmountPaise: paid,
        refundAmountPaise: 0,
        workerCompensationPaise: 0,
      }),
    };
  }

  if (!input.partnerAssigned) {
    return {
      status: 'ALLOWED',
      tier: 'no_partner',
      policyKey: 'project_cancel_no_partner',
      reason: 'Full refund — no partner assigned',
      workDaysCounted: 0,
      totalPlannedDays,
      settlement: buildSettlement({
        paidAmountPaise: paid,
        refundAmountPaise: paid,
        workerCompensationPaise: 0,
      }),
    };
  }

  // Mid-project: any day started or completed.
  if (workDaysCounted > 0) {
    const workValuePaise = Math.trunc((paid * workDaysCounted) / totalPlannedDays);
    const adminFee = midProjectAdminFeePaise(paid);
    const remainingAfterWork = Math.max(0, paid - workValuePaise);
    const platformKeep = Math.min(adminFee, remainingAfterWork);
    const refund = Math.max(0, paid - workValuePaise - platformKeep);
    return {
      status: 'ALLOWED',
      tier: 'mid_project_proration',
      policyKey: 'project_cancel_mid_project',
      reason: `Partial refund after ${workDaysCounted} of ${totalPlannedDays} day(s) of work`,
      workDaysCounted,
      totalPlannedDays,
      settlement: buildSettlement({
        paidAmountPaise: paid,
        refundAmountPaise: refund,
        workerCompensationPaise: workValuePaise,
      }),
    };
  }

  // Pre-start with partner assigned.
  if (input.partnerReachedLocation) {
    const fee = Math.min(paid, PROJECT_CANCELLATION_POLICY.PARTNER_REACHED_FEE_PAISE);
    return {
      status: 'ALLOWED',
      tier: 'partner_reached',
      policyKey: 'project_cancel_partner_reached',
      reason: 'Cancellation fee — partner reached location before work day started',
      workDaysCounted: 0,
      totalPlannedDays,
      settlement: buildSettlement({
        paidAmountPaise: paid,
        refundAmountPaise: Math.max(0, paid - fee),
        workerCompensationPaise: 0,
      }),
    };
  }

  const hours = hoursUntil(input.projectStartDate, input.cancelledAt);
  if (hours > PROJECT_CANCELLATION_POLICY.FREE_WINDOW_HOURS) {
    return {
      status: 'ALLOWED',
      tier: 'free',
      policyKey: 'project_cancel_free',
      reason: 'Free cancellation — more than 24 hours before project start',
      workDaysCounted: 0,
      totalPlannedDays,
      settlement: buildSettlement({
        paidAmountPaise: paid,
        refundAmountPaise: paid,
        workerCompensationPaise: 0,
      }),
    };
  }

  if (hours > 4) {
    const fee = Math.min(paid, PROJECT_CANCELLATION_POLICY.WITHIN_24H_FEE_PAISE);
    return {
      status: 'ALLOWED',
      tier: 'within_24h',
      policyKey: 'project_cancel_within_24h',
      reason: 'Cancellation fee — within 24 hours of project start',
      workDaysCounted: 0,
      totalPlannedDays,
      settlement: buildSettlement({
        paidAmountPaise: paid,
        refundAmountPaise: Math.max(0, paid - fee),
        workerCompensationPaise: 0,
      }),
    };
  }

  const fee = Math.min(paid, PROJECT_CANCELLATION_POLICY.WITHIN_4H_FEE_PAISE);
  return {
    status: 'ALLOWED',
    tier: 'within_4h',
    policyKey: 'project_cancel_within_4h',
    reason: 'Cancellation fee — within 4 hours of project start',
    workDaysCounted: 0,
    totalPlannedDays,
    settlement: buildSettlement({
      paidAmountPaise: paid,
      refundAmountPaise: Math.max(0, paid - fee),
      workerCompensationPaise: 0,
    }),
  };
}

export function formatProjectCancelFeeRupees(paise: number): string {
  const rupees = Math.round(clampPaise(paise) / 100);
  return `₹${rupees.toLocaleString('en-IN')}`;
}
