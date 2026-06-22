import type { RecurringEndType, RecurringFrequencyPattern } from './recurringVisitMeta';

export interface RecurringScheduleBuildConfig {
  pattern: RecurringFrequencyPattern;
  selectedWeekdays: number[];
  startDate: Date;
  endType: RecurringEndType;
  endDate?: Date;
}

export function normalizeDateOnly(value: Date): Date {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Parse mobile/web calendar dates without timezone off-by-one. */
export function parseIncomingCalendarDate(value: unknown): Date {
  if (!value) {
    throw new Error('Calendar date is required');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const [, y, m, d] = dateOnly;
      return normalizeDateOnly(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))));
    }
    const prefix = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (prefix) {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        if (/T00:00:00(\.000)?Z?$/.test(trimmed)) {
          return normalizeDateOnly(
            new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())),
          );
        }
        return normalizeDateOnly(
          new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())),
        );
      }
    }
  }
  const parsed = new Date(value as string | number | Date);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid calendar date');
  }
  if (
    typeof value === 'string' &&
    /T00:00:00(\.000)?Z?$/.test(String(value).trim())
  ) {
    return normalizeDateOnly(
      new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())),
    );
  }
  return normalizeDateOnly(
    new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())),
  );
}

function resolveRecurringEndDate(config: {
  startDate: Date;
  endType: RecurringEndType;
  endDate?: Date;
}): Date {
  if (config.endType === 'end_on_date' && config.endDate) {
    return normalizeDateOnly(config.endDate);
  }
  const until = normalizeDateOnly(config.startDate);
  until.setFullYear(until.getFullYear() + 2);
  return until;
}

export function buildRecurringScheduleDates(
  config: RecurringScheduleBuildConfig,
  maxOccurrences = 366,
): Date[] {
  const start = normalizeDateOnly(config.startDate);
  const end = resolveRecurringEndDate({
    startDate: start,
    endType: config.endType,
    endDate: config.endDate,
  });

  const dates: Date[] = [];
  const { pattern, selectedWeekdays } = config;

  if (pattern === 'daily') {
    let current = new Date(start);
    while (current.getTime() <= end.getTime() && dates.length < maxOccurrences) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  if (pattern === 'weekly') {
    let current = new Date(start);
    while (current.getTime() <= end.getTime() && dates.length < maxOccurrences) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 7);
    }
    return dates;
  }

  if (pattern === 'selected_weekdays') {
    const weekdaySet = new Set(
      (selectedWeekdays.length > 0 ? selectedWeekdays : [start.getUTCDay()]).map((d) => d % 7),
    );
    let current = new Date(start);
    while (current.getTime() <= end.getTime() && dates.length < maxOccurrences) {
      if (weekdaySet.has(current.getUTCDay())) {
        dates.push(new Date(current));
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  if (pattern === 'biweekly') {
    let current = new Date(start);
    while (current.getTime() <= end.getTime() && dates.length < maxOccurrences) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 14);
    }
    return dates;
  }

  if (pattern === 'monthly' || pattern === 'bimonthly') {
    const monthStep = pattern === 'monthly' ? 1 : 2;
    let current = new Date(start);
    const anchorDay = start.getUTCDate();
    while (current.getTime() <= end.getTime() && dates.length < maxOccurrences) {
      dates.push(new Date(current));
      const next = new Date(current);
      next.setUTCMonth(next.getUTCMonth() + monthStep);
      const daysInTargetMonth = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
      ).getUTCDate();
      next.setUTCDate(Math.min(anchorDay, daysInTargetMonth));
      current = next;
    }
    return dates;
  }

  return dates;
}

/** Product cap — recurring plans cannot exceed this many occurrences. */
export const MAX_RECURRING_PLAN_OCCURRENCES = 366;

export function countPlannedRecurringOccurrences(config: RecurringScheduleBuildConfig): number {
  return buildRecurringScheduleDates(config, MAX_RECURRING_PLAN_OCCURRENCES).length;
}

/**
 * Validate fixed-range plans before persisting.
 * Rejects empty schedules and ranges that exceed MAX_RECURRING_PLAN_OCCURRENCES.
 */
export function validateRecurringPlanOccurrences(config: RecurringScheduleBuildConfig): number {
  const probe = buildRecurringScheduleDates(config, MAX_RECURRING_PLAN_OCCURRENCES + 1);
  if (probe.length === 0) {
    throw new Error('Recurring schedule has no dates in the selected range');
  }
  if (probe.length > MAX_RECURRING_PLAN_OCCURRENCES) {
    throw new Error(
      `Recurring plan exceeds the maximum supported ${MAX_RECURRING_PLAN_OCCURRENCES} visits`,
    );
  }
  return probe.length;
}

export function computeNextVisitDateAfter(
  afterDate: Date,
  config: RecurringScheduleBuildConfig,
): Date | null {
  const dates = buildRecurringScheduleDates(config, MAX_RECURRING_PLAN_OCCURRENCES + 1);
  const after = normalizeDateOnly(afterDate).getTime();
  const next = dates.find((d) => normalizeDateOnly(d).getTime() > after);
  return next ? normalizeDateOnly(next) : null;
}

/**
 * Next visit date to materialize.
 * - end_on_date: uses planned occurrence index (inclusive start, never skips first day).
 * - until_cancelled: first row is start date; later rows use cursor advancement.
 */
export function resolveNextMaterializedVisitDate(
  config: RecurringScheduleBuildConfig,
  cursor: Date | null,
  totalMaterializedCount: number,
): Date | null {
  if (config.endType === 'end_on_date') {
    const planned = buildRecurringScheduleDates(config, MAX_RECURRING_PLAN_OCCURRENCES);
    if (totalMaterializedCount >= planned.length) return null;
    return normalizeDateOnly(planned[totalMaterializedCount]);
  }

  if (totalMaterializedCount === 0) {
    const first = buildRecurringScheduleDates(config, 1);
    return first.length > 0 ? normalizeDateOnly(first[0]) : null;
  }

  if (!cursor) return null;
  return computeNextVisitDateAfter(cursor, config);
}

/** Buffer gap capped by remaining valid occurrences for fixed-end plans. */
export function resolveMaterializationMissingCount(params: {
  bufferSize: number;
  upcomingVisitCount: number;
  endType: RecurringEndType;
  totalPlannedOccurrences?: number;
  totalMaterializedOccurrences: number;
}): number {
  const missingFromBuffer = Math.max(0, params.bufferSize - params.upcomingVisitCount);
  if (missingFromBuffer <= 0) return 0;

  if (params.endType !== 'end_on_date') {
    return missingFromBuffer;
  }

  const totalPlanned = params.totalPlannedOccurrences ?? 0;
  const remainingValid = Math.max(0, totalPlanned - params.totalMaterializedOccurrences);
  return Math.min(missingFromBuffer, remainingValid);
}

export function addMinutesToTimeLabel(timeLabel: string, minutesToAdd: number): string {
  const match = String(timeLabel).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return timeLabel;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  const total = hours * 60 + minutes + minutesToAdd;
  const outHours24 = Math.floor((total % (24 * 60)) / 60);
  const outMinutes = total % 60;
  if (meridiem) {
    const outMeridiem = outHours24 >= 12 ? 'PM' : 'AM';
    let outHours12 = outHours24 % 12;
    if (outHours12 === 0) outHours12 = 12;
    return `${outHours12}:${String(outMinutes).padStart(2, '0')} ${outMeridiem}`;
  }
  return `${String(outHours24).padStart(2, '0')}:${String(outMinutes).padStart(2, '0')}`;
}
