import { Schema } from 'mongoose';

export type RescheduleActorRole = 'customer' | 'tasker' | 'support' | 'system';

export interface IRescheduleHistoryEntry {
  previousScheduledDate?: Date;
  previousScheduledTimeStart?: string;
  previousScheduledTimeEnd?: string;
  previousTimeSlot?: string;
  newScheduledDate?: Date;
  newScheduledTimeStart?: string;
  newScheduledTimeEnd?: string;
  newTimeSlot?: string;
  rescheduledAt: Date;
  rescheduledBy?: string;
  actorRole?: RescheduleActorRole;
  reason?: string;
  chargeAmount?: number;
}

export const RescheduleHistoryEntrySchema = new Schema<IRescheduleHistoryEntry>(
  {
    previousScheduledDate: Date,
    previousScheduledTimeStart: String,
    previousScheduledTimeEnd: String,
    previousTimeSlot: String,
    newScheduledDate: Date,
    newScheduledTimeStart: String,
    newScheduledTimeEnd: String,
    newTimeSlot: String,
    rescheduledAt: { type: Date, required: true },
    rescheduledBy: String,
    actorRole: { type: String, enum: ['customer', 'tasker', 'support', 'system'] },
    reason: { type: String, trim: true, maxlength: 500 },
    chargeAmount: { type: Number, min: 0 },
  },
  { _id: false },
);

type ScheduleSnapshot = {
  scheduledDate?: Date | string | null;
  scheduledTimeStart?: string | null;
  scheduledTimeEnd?: string | null;
  timeSlot?: string | null;
};

function toDateOrUndefined(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toTrimmedOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = String(value ?? '').trim();
  return trimmed || undefined;
}

export function buildRescheduleHistoryEntry(params: {
  previous: ScheduleSnapshot;
  next: ScheduleSnapshot;
  rescheduledAt: Date;
  rescheduledBy?: string;
  actorRole?: RescheduleActorRole;
  reason?: string | null;
  chargeAmount?: number | null;
}): IRescheduleHistoryEntry {
  const chargeAmount = Number(params.chargeAmount || 0);
  return {
    previousScheduledDate: toDateOrUndefined(params.previous.scheduledDate),
    previousScheduledTimeStart: toTrimmedOrUndefined(params.previous.scheduledTimeStart),
    previousScheduledTimeEnd: toTrimmedOrUndefined(params.previous.scheduledTimeEnd),
    previousTimeSlot: toTrimmedOrUndefined(params.previous.timeSlot),
    newScheduledDate: toDateOrUndefined(params.next.scheduledDate),
    newScheduledTimeStart: toTrimmedOrUndefined(params.next.scheduledTimeStart),
    newScheduledTimeEnd: toTrimmedOrUndefined(params.next.scheduledTimeEnd),
    newTimeSlot: toTrimmedOrUndefined(params.next.timeSlot),
    rescheduledAt: params.rescheduledAt,
    rescheduledBy: toTrimmedOrUndefined(params.rescheduledBy),
    actorRole: params.actorRole,
    reason: toTrimmedOrUndefined(params.reason)?.slice(0, 500),
    chargeAmount: chargeAmount > 0 ? chargeAmount : undefined,
  };
}

/** First-booked slot; only set once, on the first reschedule. */
export function buildOriginalScheduleFields(previous: ScheduleSnapshot): {
  originalScheduledDate?: Date;
  originalScheduledTimeStart?: string;
  originalScheduledTimeEnd?: string;
} {
  return {
    originalScheduledDate: toDateOrUndefined(previous.scheduledDate),
    originalScheduledTimeStart: toTrimmedOrUndefined(previous.scheduledTimeStart),
    originalScheduledTimeEnd: toTrimmedOrUndefined(previous.scheduledTimeEnd),
  };
}
