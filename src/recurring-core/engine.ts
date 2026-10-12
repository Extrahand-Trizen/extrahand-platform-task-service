import {
  buildRecurringScheduleDates,
  MAX_RECURRING_PLAN_OCCURRENCES,
  normalizeDateOnly,
  parseIncomingCalendarDate,
} from '../utils/recurringVisitScheduleBuilder';
import { addCalendarMonths, dateKeyOfStoredDate, resolveVisitStartInstant, storedDateFromKey } from './time';
import { bookNowRecurringConfig, BookNowRecurringErrors, hoursToMs } from './config';
import { BOOK_NOW_RECURRENCE_PATTERNS, type GeneratedVisitSlot, type RecurrenceRule } from './types';

export function assertBookNowRecurrencePattern(pattern: string): asserts pattern is RecurrenceRule['pattern'] {
  if (!(BOOK_NOW_RECURRENCE_PATTERNS as readonly string[]).includes(pattern)) {
    throw new Error(BookNowRecurringErrors.PATTERN_NOT_ALLOWED);
  }
}

export function addMonthsToDateKey(dateKey: string, months: number): string {
  const start = storedDateFromKey(dateKey);
  const moved = addCalendarMonths(start, months);
  return dateKeyOfStoredDate(moved) || dateKey;
}

/**
 * Future Book Now slots only. First visit ≥ lead hours, last visit ≤ horizon months,
 * consecutive starts ≥ min gap, capped at 366.
 */
export function generateBookNowVisitSlots(
  rule: RecurrenceRule,
  now: Date = new Date(),
  options?: { maxSlots?: number; afterDateKey?: string },
): GeneratedVisitSlot[] {
  assertBookNowRecurrencePattern(rule.pattern);
  if (rule.pattern === 'selected_weekdays' && !(rule.selectedWeekdays && rule.selectedWeekdays.length > 0)) {
    throw new Error(BookNowRecurringErrors.WEEKDAYS_REQUIRED);
  }

  const start = parseIncomingCalendarDate(rule.startDateKey);
  const horizonEndKey = addMonthsToDateKey(rule.startDateKey, bookNowRecurringConfig.horizonMonths);
  let end: Date;
  if (rule.endDateKey) {
    const requestedEnd = parseIncomingCalendarDate(rule.endDateKey);
    const horizonEnd = parseIncomingCalendarDate(horizonEndKey);
    if (requestedEnd.getTime() > horizonEnd.getTime()) {
      throw new Error(BookNowRecurringErrors.HORIZON);
    }
    end = requestedEnd;
  } else {
    end = parseIncomingCalendarDate(horizonEndKey);
  }

  const maxCap = Math.min(
    options?.maxSlots ?? MAX_RECURRING_PLAN_OCCURRENCES,
    bookNowRecurringConfig.maxOccurrences,
    MAX_RECURRING_PLAN_OCCURRENCES,
  );

  const dates = buildRecurringScheduleDates(
    {
      pattern: rule.pattern,
      selectedWeekdays: rule.selectedWeekdays || [],
      startDate: start,
      endType: 'end_on_date',
      endDate: end,
    },
    maxCap + 1,
  );

  if (dates.length > maxCap) {
    throw new Error(BookNowRecurringErrors.TOO_MANY_VISITS);
  }

  const earliestStart = new Date(now.getTime() + hoursToMs(bookNowRecurringConfig.firstVisitLeadHours));
  const minGapMs = hoursToMs(bookNowRecurringConfig.minGapHours);
  const afterKey = options?.afterDateKey;
  const slots: GeneratedVisitSlot[] = [];
  let lastStartMs = 0;

  for (const date of dates) {
    const dateKey = dateKeyOfStoredDate(date);
    if (!dateKey) continue;
    if (afterKey && dateKey <= afterKey) continue;

    const scheduledAt = resolveVisitStartInstant(date, rule.scheduledTimeStart);
    if (!scheduledAt) continue;
    if (scheduledAt.getTime() < earliestStart.getTime() && !afterKey) continue;
    if (lastStartMs && scheduledAt.getTime() - lastStartMs < minGapMs) {
      throw new Error(BookNowRecurringErrors.MIN_GAP);
    }

    lastStartMs = scheduledAt.getTime();
    slots.push({
      dateKey,
      date: normalizeDateOnly(date),
      scheduledAt,
      visitIndex: slots.length + 1,
    });
  }

  if (slots.length === 0 && !afterKey) {
    const anyFuture = dates.some((date) => {
      const instant = resolveVisitStartInstant(date, rule.scheduledTimeStart);
      return instant && instant.getTime() >= now.getTime();
    });
    if (!anyFuture) throw new Error(BookNowRecurringErrors.EMPTY_SCHEDULE);
    throw new Error(BookNowRecurringErrors.FIRST_VISIT_LEAD);
  }

  return slots;
}

export function nextHorizonSlots(
  rule: RecurrenceRule,
  existingDateKeys: string[],
  now: Date = new Date(),
  horizon = bookNowRecurringConfig.visitHorizon,
): GeneratedVisitSlot[] {
  const upcoming = existingDateKeys.length;
  const missing = Math.max(0, horizon - upcoming);
  if (missing <= 0) return [];
  const afterDateKey = existingDateKeys.length
    ? existingDateKeys.reduce((a, b) => (a > b ? a : b))
    : undefined;
  const generated = generateBookNowVisitSlots(rule, now, {
    maxSlots: bookNowRecurringConfig.maxOccurrences,
    afterDateKey,
  });
  return generated.slice(0, missing).map((slot, index) => ({
    ...slot,
    visitIndex: upcoming + index + 1,
  }));
}
