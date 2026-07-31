import { BadRequestError } from '../errors/AppError';
import { isBookNowTaskForCompletion } from './isBookNowTaskForCompletion';
import { formatCompletionWindowDuration } from '../constants/bookNowPartnerPayoutCopy';

/** Default raise-issue window: 60 minutes (aligned with partner payout visibility). */
export const BOOK_NOW_RAISE_ISSUE_WINDOW_MINUTES_DEFAULT = 60;

/**
 * Customer may raise an issue only within this window after Book Now first completion.
 *
 * Env: `BOOK_NOW_RAISE_ISSUE_WINDOW_MINUTES` (preferred).
 * Fallback: `BOOK_NOW_PAYOUT_PARTNER_VISIBLE_AFTER_MINUTES` so raise-issue and partner
 * visibility stay aligned when only one is set.
 * Legacy: `BOOK_NOW_PAYOUT_PARTNER_VISIBLE_AFTER_HOURS` × 60.
 */
export function getBookNowRaiseIssueWindowMinutes(): number {
  const raiseRaw = process.env.BOOK_NOW_RAISE_ISSUE_WINDOW_MINUTES;
  if (raiseRaw != null && String(raiseRaw).trim() !== '') {
    const n = Number(raiseRaw);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  const visibleMins = process.env.BOOK_NOW_PAYOUT_PARTNER_VISIBLE_AFTER_MINUTES;
  if (visibleMins != null && String(visibleMins).trim() !== '') {
    const n = Number(visibleMins);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  const hoursRaw = process.env.BOOK_NOW_PAYOUT_PARTNER_VISIBLE_AFTER_HOURS;
  if (hoursRaw != null && String(hoursRaw).trim() !== '') {
    const hours = Number(hoursRaw);
    if (Number.isFinite(hours) && hours >= 0) return hours * 60;
  }

  return BOOK_NOW_RAISE_ISSUE_WINDOW_MINUTES_DEFAULT;
}

export function getBookNowRaiseIssueWindowMs(): number {
  return getBookNowRaiseIssueWindowMinutes() * 60 * 1000;
}

/**
 * @deprecated Prefer getBookNowRaiseIssueWindowMs() — value is env-configurable.
 * Kept as a getter-compatible constant default for older imports/tests.
 */
export const BOOK_NOW_RAISE_ISSUE_WINDOW_MS = BOOK_NOW_RAISE_ISSUE_WINDOW_MINUTES_DEFAULT * 60 * 1000;

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
 * Prefer firstCompletedAt so re-completes after revision do not reset the window.
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
  return Math.max(0, getBookNowRaiseIssueWindowMs() - elapsed);
}

export function canBookNowRaiseIssue(
  task: BookNowRaiseIssueTaskSlice,
  nowMs: number = Date.now(),
): boolean {
  const status = String(task.status || '');
  if (!isBookNowTaskForCompletion(task)) return false;
  // Legacy Book Now still in review — allow raise without the clock.
  if (status === 'review') return true;
  if (status !== 'completed') return false;
  return getBookNowRaiseIssueRemainingMs(task, nowMs) > 0;
}

/** Throws if Book Now completed task is outside the raise-issue window. */
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
    const label = formatCompletionWindowDuration(getBookNowRaiseIssueWindowMinutes());
    throw new BadRequestError(
      `The ${label} window to request changes has ended. Please contact support if you still need help.`,
    );
  }
}
