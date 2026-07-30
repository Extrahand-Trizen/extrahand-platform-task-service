import { BadRequestError } from '../errors/AppError';
import { isBookNowTaskForCompletion } from './isBookNowTaskForCompletion';

/** Customer may raise an issue only within this window after Book Now first completion. */
export const BOOK_NOW_RAISE_ISSUE_WINDOW_MS = 60 * 60 * 1000;

export type BookNowRaiseIssueTaskSlice = {
  bookingSource?: string | null;
  bookingOrderId?: unknown;
  status?: string | null;
  /** Canonical clock start — set once, never cleared on revision. */
  firstCompletedAt?: Date | string | null;
  completedAt?: Date | string | null;
  completionApprovedAt?: Date | string | null;
  completionSubmittedAt?: Date | string | null;
};

function toValidDate(raw: Date | string | null | undefined): Date | null {
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Clock start for the raise-issue window.
 * Prefer firstCompletedAt so re-completes after revision do not reset the hour.
 */
export function resolveBookNowRaiseIssueClockStart(
  task: BookNowRaiseIssueTaskSlice,
): Date | null {
  return (
    toValidDate(task.firstCompletedAt) ||
    toValidDate(task.completedAt) ||
    toValidDate(task.completionApprovedAt) ||
    toValidDate(task.completionSubmittedAt)
  );
}

/**
 * Remaining ms in the Book Now raise-issue window (0 if expired / unknown).
 */
export function getBookNowRaiseIssueRemainingMs(
  task: BookNowRaiseIssueTaskSlice,
  nowMs: number = Date.now(),
): number {
  if (!isBookNowTaskForCompletion(task)) return 0;
  if (String(task.status || '') !== 'completed') return 0;
  const clockStart = resolveBookNowRaiseIssueClockStart(task);
  if (!clockStart) return 0;
  const elapsed = nowMs - clockStart.getTime();
  return Math.max(0, BOOK_NOW_RAISE_ISSUE_WINDOW_MS - elapsed);
}

export function canBookNowRaiseIssue(
  task: BookNowRaiseIssueTaskSlice,
  nowMs: number = Date.now(),
): boolean {
  const status = String(task.status || '');
  if (!isBookNowTaskForCompletion(task)) return false;
  // Legacy Book Now still in review — allow raise without the 1h clock.
  if (status === 'review') return true;
  if (status !== 'completed') return false;
  return getBookNowRaiseIssueRemainingMs(task, nowMs) > 0;
}

/** Throws if Book Now completed task is outside the 1-hour raise-issue window. */
export function assertBookNowRaiseIssueAllowed(
  task: BookNowRaiseIssueTaskSlice,
  nowMs: number = Date.now(),
): void {
  if (!isBookNowTaskForCompletion(task)) return;
  const status = String(task.status || '');
  if (status === 'review') return;
  if (status !== 'completed') {
    throw new BadRequestError(
      'You can raise an issue after the helper marks the work complete',
    );
  }
  if (getBookNowRaiseIssueRemainingMs(task, nowMs) <= 0) {
    throw new BadRequestError(
      'The 1-hour window to request changes has ended. Please contact support if you still need help.',
    );
  }
}
