import { addMinutesToTimeLabel } from './recurringVisitScheduleBuilder';
import {
  deriveBookNowTimeSlot,
  type BookNowTimeBucket,
} from './bookNowSlotAvailability';

/** India calendar day — matches how customers pick dates in the app. */
const BOOK_NOW_SLOT_TIMEZONE = '+05:30';

export type BookNowScheduleInput = {
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: BookNowTimeBucket;
  durationMinutes?: number;
};

export type ResolvedBookNowLineSchedule = {
  scheduledDate: string;
  scheduledDateValue: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  timeSlot?: BookNowTimeBucket;
  durationMinutes: number;
};

function bucketAnchorSlot(bucket: BookNowTimeBucket): string {
  switch (bucket) {
    case 'morning':
      return '8:00 AM';
    case 'midday':
      return '11:00 AM';
    case 'afternoon':
      return '2:00 PM';
    case 'evening':
      return '5:00 PM';
    default:
      return '8:00 AM';
  }
}

export function isValidBookNowDateKey(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').trim());
}

export function parseBookNowScheduleDate(date: string): Date | null {
  const trimmed = String(date || '').trim();
  if (!isValidBookNowDateKey(trimmed)) return null;
  return new Date(`${trimmed}T00:00:00.000${BOOK_NOW_SLOT_TIMEZONE}`);
}

export function hasAnyBookNowScheduleFields(input: BookNowScheduleInput | null | undefined): boolean {
  if (!input) return false;
  return Boolean(
    input.scheduledDate ||
      input.scheduledTimeStart ||
      input.scheduledTimeEnd ||
      input.timeSlot ||
      input.durationMinutes != null,
  );
}

export function resolveBookNowLineDurationMinutes(
  catalogDurationMinutes: number,
  clientOverride?: number,
): number {
  const catalog =
    Number.isFinite(catalogDurationMinutes) && catalogDurationMinutes > 0
      ? Math.round(catalogDurationMinutes)
      : 60;
  const override = Number(clientOverride);
  if (Number.isFinite(override) && override > 0 && Number.isInteger(override)) {
    return Math.min(Math.round(override), 24 * 60);
  }
  return catalog;
}

function resolveStartAnchor(input: BookNowScheduleInput): string | undefined {
  const start = String(input.scheduledTimeStart || '').trim();
  if (start) return start;
  if (input.timeSlot) return bucketAnchorSlot(input.timeSlot);
  return undefined;
}

export function isCompleteResolvedBookNowSchedule(
  schedule: ResolvedBookNowLineSchedule | null | undefined,
): schedule is ResolvedBookNowLineSchedule {
  if (!schedule) return false;
  return Boolean(
    schedule.scheduledDate &&
      (schedule.scheduledTimeStart || schedule.timeSlot) &&
      schedule.durationMinutes > 0,
  );
}

export function finalizeBookNowLineSchedule(
  partial: BookNowScheduleInput,
  catalogDurationMinutes: number,
): ResolvedBookNowLineSchedule | null {
  const dateKey = String(partial.scheduledDate || '').trim();
  if (!isValidBookNowDateKey(dateKey)) return null;

  const scheduledDateValue = parseBookNowScheduleDate(dateKey);
  if (!scheduledDateValue) return null;

  const startAnchor = resolveStartAnchor(partial);
  if (!startAnchor) return null;

  const durationMinutes = resolveBookNowLineDurationMinutes(
    catalogDurationMinutes,
    partial.durationMinutes,
  );

  const scheduledTimeStart = String(partial.scheduledTimeStart || '').trim() || startAnchor;
  const scheduledTimeEnd =
    String(partial.scheduledTimeEnd || '').trim() ||
    addMinutesToTimeLabel(scheduledTimeStart, durationMinutes);
  const timeSlot =
    partial.timeSlot ||
    (scheduledTimeStart ? deriveBookNowTimeSlot(scheduledTimeStart) : undefined);

  return {
    scheduledDate: dateKey,
    scheduledDateValue,
    scheduledTimeStart,
    scheduledTimeEnd,
    timeSlot,
    durationMinutes,
  };
}

export function resolveBookNowLineSchedule(params: {
  lineSchedule?: BookNowScheduleInput;
  legacySchedule?: BookNowScheduleInput;
  catalogDurationMinutes: number;
}): ResolvedBookNowLineSchedule | null {
  const merged: BookNowScheduleInput = {
    scheduledDate: params.lineSchedule?.scheduledDate ?? params.legacySchedule?.scheduledDate,
    scheduledTimeStart:
      params.lineSchedule?.scheduledTimeStart ?? params.legacySchedule?.scheduledTimeStart,
    scheduledTimeEnd:
      params.lineSchedule?.scheduledTimeEnd ?? params.legacySchedule?.scheduledTimeEnd,
    timeSlot: params.lineSchedule?.timeSlot ?? params.legacySchedule?.timeSlot,
    durationMinutes:
      params.lineSchedule?.durationMinutes ?? params.legacySchedule?.durationMinutes,
  };

  return finalizeBookNowLineSchedule(merged, params.catalogDurationMinutes);
}

export function usesPerItemBookNowScheduling(
  items: BookNowScheduleInput[],
  itemCount: number,
): boolean {
  if (itemCount > 1) return true;
  return items.some((item) => hasAnyBookNowScheduleFields(item));
}

export function assertPerItemScheduleFieldsComplete(
  lineSchedule: BookNowScheduleInput | undefined,
  lineIndex: number,
): void {
  if (!lineSchedule || !hasAnyBookNowScheduleFields(lineSchedule)) return;

  const dateKey = String(lineSchedule.scheduledDate || '').trim();
  const hasStart = Boolean(String(lineSchedule.scheduledTimeStart || '').trim() || lineSchedule.timeSlot);

  if (!dateKey || !hasStart) {
    throw new Error(
      `INCOMPLETE_LINE_SCHEDULE:${lineIndex}:Each service with a schedule must include scheduledDate and scheduledTimeStart or timeSlot`,
    );
  }
  if (!isValidBookNowDateKey(dateKey)) {
    throw new Error(`INVALID_LINE_SCHEDULE_DATE:${lineIndex}:Invalid scheduledDate`);
  }
}

export type BookNowSlotCheck = {
  date: string;
  scheduledTimeStart?: string;
  timeSlot?: BookNowTimeBucket;
};

export function collectDistinctBookNowSlotChecks(
  schedules: Array<ResolvedBookNowLineSchedule | null | undefined>,
): BookNowSlotCheck[] {
  const seen = new Set<string>();
  const checks: BookNowSlotCheck[] = [];

  for (const schedule of schedules) {
    if (!isCompleteResolvedBookNowSchedule(schedule)) continue;

    const key = [
      schedule.scheduledDate,
      schedule.scheduledTimeStart || '',
      schedule.timeSlot || '',
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);

    checks.push({
      date: schedule.scheduledDate,
      scheduledTimeStart: schedule.scheduledTimeStart,
      timeSlot: schedule.timeSlot,
    });
  }

  return checks;
}

export function scheduleFieldsFromResolved(
  schedule: ResolvedBookNowLineSchedule | null | undefined,
): BookNowScheduleInput | undefined {
  if (!schedule) return undefined;
  return {
    scheduledDate: schedule.scheduledDate,
    scheduledTimeStart: schedule.scheduledTimeStart,
    scheduledTimeEnd: schedule.scheduledTimeEnd,
    timeSlot: schedule.timeSlot,
    durationMinutes: schedule.durationMinutes,
  };
}

export function scheduleDateValueFromKey(dateKey: string): Date | undefined {
  return parseBookNowScheduleDate(dateKey) ?? undefined;
}
