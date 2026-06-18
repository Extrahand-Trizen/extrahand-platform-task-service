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

export function computeNextVisitDateAfter(
  afterDate: Date,
  config: RecurringScheduleBuildConfig,
): Date | null {
  const dates = buildRecurringScheduleDates(config, 500);
  const after = normalizeDateOnly(afterDate).getTime();
  const next = dates.find((d) => normalizeDateOnly(d).getTime() > after);
  return next ? normalizeDateOnly(next) : null;
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
