import { normalizeDateOnly } from './recurringVisitScheduleBuilder';
import {
  VISIT_TERMINAL_STATUSES,
  type ScheduleVisitRow,
  type VisitStatus,
} from '../types/recurringVisitSchedule';

/** Statuses a visit can be in to receive a held payment moved by a reschedule. */
const PAYMENT_OWNER_TARGET_STATUSES = new Set([
  'scheduled',
  'payment_pending',
  'confirmed',
  'open',
  'assigned',
]);

export function visitRowHasHeldPayment(visit: ScheduleVisitRow): boolean {
  const paymentStatus = String(visit.paymentStatus || '').toLowerCase();
  if (paymentStatus === 'refunded' || paymentStatus === 'failed') return false;
  const hasPaidAt = Boolean(visit.paidAt);
  const hasEscrow = Boolean(String(visit.escrowId || '').trim());
  return hasPaidAt && hasEscrow;
}

/** Minutes after midnight for "9:00 AM" / "14:30" labels; null when unparseable. */
export function parseVisitTimeLabelToMinutes(label: string | null | undefined): number | null {
  const match = String(label || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Chronological visit order: scheduled date, then start time, then visitIndex as tie-breaker. */
export function compareRecurringVisitsBySchedule(
  a: Pick<ScheduleVisitRow, 'date' | 'scheduledTimeStart' | 'visitIndex'>,
  b: Pick<ScheduleVisitRow, 'date' | 'scheduledTimeStart' | 'visitIndex'>,
): number {
  return (
    normalizeDateOnly(new Date(a.date)).getTime() - normalizeDateOnly(new Date(b.date)).getTime() ||
    (parseVisitTimeLabelToMinutes(a.scheduledTimeStart) ?? 0) -
      (parseVisitTimeLabelToMinutes(b.scheduledTimeStart) ?? 0) ||
    (a.visitIndex ?? 0) - (b.visitIndex ?? 0)
  );
}

function isClosedVisit(row: ScheduleVisitRow): boolean {
  const status = String(row.status || '');
  return status === 'completed' || VISIT_TERMINAL_STATUSES.has(status as VisitStatus);
}

export type ProposedVisitSchedule = {
  visitId: string;
  date: Date;
  scheduledTimeStart?: string;
};

/**
 * The held payment of a rescheduled visit belongs to the first eligible visit in the resulting
 * chronological schedule. The rescheduled visit is evaluated at its proposed date/time; other
 * visits qualify only when open and unpaid. Returns the matching row from `rows`.
 */
export function resolveRecurringVisitPaymentOwner(
  rows: ScheduleVisitRow[],
  proposed: ProposedVisitSchedule,
): ScheduleVisitRow | undefined {
  const candidates = rows
    .filter((row) => {
      if (isClosedVisit(row)) return false;
      if (row.visitId === proposed.visitId) return true;
      if (visitRowHasHeldPayment(row)) return false;
      return PAYMENT_OWNER_TARGET_STATUSES.has(String(row.status || ''));
    })
    .map((row) =>
      row.visitId === proposed.visitId
        ? {
            row,
            date: normalizeDateOnly(new Date(proposed.date)),
            scheduledTimeStart: proposed.scheduledTimeStart || row.scheduledTimeStart,
            visitIndex: row.visitIndex,
          }
        : {
            row,
            date: row.date,
            scheduledTimeStart: row.scheduledTimeStart,
            visitIndex: row.visitIndex,
          },
    );

  candidates.sort(compareRecurringVisitsBySchedule);
  return candidates[0]?.row;
}
