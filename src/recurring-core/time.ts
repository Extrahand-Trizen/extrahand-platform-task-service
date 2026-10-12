/**
 * Recurring schedules are calendar dates in India time. A visit date is stored as UTC midnight of
 * its calendar day (YYYY-MM-DD) and its start time as a clock label ("9:00 AM" / "18:30"); the
 * instant is always computed in IST so results never depend on the server's TZ.
 */
export const RECURRING_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';
const MINUTE_MS = 60 * 1000;

/** Default start when a visit has no clock time. */
export const DEFAULT_VISIT_START_MINUTES = 9 * 60;

/** "9:00 AM", "09:00", "6:30pm", "18:30" → minutes after midnight; null when unparseable. */
export function parseClockLabelToMinutes(label: string | null | undefined): number | null {
  const match = String(label || '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

export function minutesToClockLabel(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes).padStart(2, '0')} ${period}`;
}

/** Calendar day key of a stored visit date (UTC midnight of the calendar day). */
export function dateKeyOfStoredDate(date: Date | string): string | null {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** IST calendar day key of an instant. */
export function istDateKey(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RECURRING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes after IST midnight of an instant. */
export function istMinutesOfDay(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: RECURRING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return (get('hour') % 24) * 60 + get('minute');
}

/** Stored form of a calendar day: UTC midnight. */
export function storedDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Add calendar months to a stored UTC-midnight date, clamping the day if needed. */
export function addCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month, 1));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return target;
}

export function istInstant(dateKey: string, minutesOfDay: number): Date {
  const base = new Date(`${dateKey}T00:00:00.000${IST_OFFSET}`);
  return new Date(base.getTime() + minutesOfDay * MINUTE_MS);
}

/** Start instant of a visit from its stored calendar date and clock label, in IST. */
export function resolveVisitStartInstant(
  date: Date | string,
  clockLabel?: string | null,
  fallbackMinutes = DEFAULT_VISIT_START_MINUTES,
): Date | null {
  const key = dateKeyOfStoredDate(date);
  if (!key) return null;
  const minutes = parseClockLabelToMinutes(clockLabel) ?? fallbackMinutes;
  return istInstant(key, minutes);
}

export interface PaymentDeadlinePolicy {
  /** Payment is due this long before the visit starts. */
  cutoffMinutes: number;
  /** A newly opened payment always gets at least this long from now. */
  minWindowMinutes: number;
}

/**
 * max(visitStart − cutoff, now + minWindow), never after the visit start. Returns null when the
 * visit has already started (it can no longer be opened for payment).
 */
export function computeSafePaymentDeadline(
  visitStart: Date,
  now: Date,
  policy: PaymentDeadlinePolicy,
): Date | null {
  const start = visitStart.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(start) || start <= nowMs) return null;
  const byCutoff = start - Math.max(0, policy.cutoffMinutes) * MINUTE_MS;
  const floor = nowMs + Math.max(0, policy.minWindowMinutes) * MINUTE_MS;
  return new Date(Math.min(start, Math.max(byCutoff, floor)));
}
