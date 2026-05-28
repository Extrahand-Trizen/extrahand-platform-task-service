/**
 * Rules for when a performer is locked into an assigned task (after payment or work started).
 */

const ACTIVE_ESCROW_STATUSES = new Set(['pending', 'held', 'authorized', 'captured']);

const WORK_IN_FLIGHT_STATUSES = new Set(['started', 'in_progress', 'review']);

export function isActiveEscrow(escrow: { status?: string } | null | undefined): boolean {
  if (!escrow) return false;
  const status = String(escrow.status || '').toLowerCase();
  return ACTIVE_ESCROW_STATUSES.has(status);
}

export function isWorkInFlightStatus(taskStatus: string | undefined | null): boolean {
  return WORK_IN_FLIGHT_STATUSES.has(String(taskStatus || '').toLowerCase());
}

export function canWithdrawAcceptedApplication(
  taskStatus: string | undefined | null,
  escrow: { status?: string } | null | undefined
): { allowed: boolean; reason?: string } {
  if (isActiveEscrow(escrow)) {
    return {
      allowed: false,
      reason:
        'Cannot withdraw after payment is held for this task. Contact support if you need help.',
    };
  }

  if (isWorkInFlightStatus(taskStatus)) {
    return {
      allowed: false,
      reason:
        'Cannot withdraw while work is in progress or under review. Complete the task or contact the poster.',
    };
  }

  if (String(taskStatus || '').toLowerCase() === 'completed') {
    return {
      allowed: false,
      reason: 'Cannot withdraw from a completed task.',
    };
  }

  if (String(taskStatus || '').toLowerCase() !== 'assigned') {
    return {
      allowed: false,
      reason: 'Withdraw is only allowed before work has started on this task.',
    };
  }

  return { allowed: true };
}
