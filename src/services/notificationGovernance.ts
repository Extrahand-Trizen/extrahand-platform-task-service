import type { TaskStatus } from '../types';

/** Statuses where start-soon and 24h reminders may fire. */
export const REMINDER_ELIGIBLE_STATUSES: TaskStatus[] = [
  'assigned',
  'started',
  'in_progress',
];

/** Work is still live for applicant/digest notifications. */
export const DIGEST_ELIGIBLE_STATUSES: TaskStatus[] = ['open'];

/** Terminal — never send lifecycle reminders or digests. */
export const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'cancelled'];

export function isReminderEligibleStatus(status: string | undefined): boolean {
  return REMINDER_ELIGIBLE_STATUSES.includes(status as TaskStatus);
}

export function isDigestEligibleTask(args: {
  status: string;
  assigneeId?: unknown | null;
}): boolean {
  if (!DIGEST_ELIGIBLE_STATUSES.includes(args.status as TaskStatus)) return false;
  if (args.assigneeId) return false;
  return true;
}

/**
 * Skip start-soon if helper already marked work started before the scheduled instant.
 */
export function hasStartedBeforeSchedule(args: {
  status: string;
  startedAt?: Date | string | null;
  scheduledStart: Date;
}): boolean {
  if (!['started', 'in_progress', 'review', 'completed'].includes(args.status)) {
    return false;
  }
  if (!args.startedAt) return args.status !== 'assigned';
  const started = new Date(args.startedAt);
  return !Number.isNaN(started.getTime()) && started.getTime() < args.scheduledStart.getTime();
}

/** UTC date key YYYY-MM-DD for per-day digest counters. */
export function utcDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
