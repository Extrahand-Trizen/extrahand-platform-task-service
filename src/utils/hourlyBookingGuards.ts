import { BadRequestError } from '../errors/AppError';
import {
  HOURLY_HELPER_CATEGORY_SLUG,
  HOURLY_INSTANT_DEFAULT_END_HOUR,
  HOURLY_INSTANT_DEFAULT_START_HOUR,
  HOURLY_INSTANT_TIMEZONE,
  HOURLY_SCHEDULED_END_HOUR,
} from '../constants/hourlyBooking';
import type { BookingFulfillmentType } from '../models/BookingOrder';

export type HourlyLineHint = {
  categorySlug?: string | null;
  skuSlug?: string | null;
  packageId?: string | null;
  pricingUnit?: string | null;
};

/** Input looks like Hourly catalog (force server catalog resolve — never client price). */
export function isHourlyCatalogLineInput(line: HourlyLineHint): boolean {
  const category = String(line.categorySlug || '').trim().toLowerCase();
  if (category === HOURLY_HELPER_CATEGORY_SLUG) return true;
  const slug = String(line.skuSlug || line.packageId || '').trim().toLowerCase();
  return slug.startsWith('hourly-');
}

/** Resolved line is Hourly (pricingUnit, category, or hourly-* SKU slug). */
export function isHourlyResolvedLine(line: {
  pricingUnit?: string;
  categorySlug?: string;
  packageSlug?: string;
  packageId?: string;
}): boolean {
  if (line.pricingUnit === 'hourly') return true;
  if (String(line.categorySlug || '').trim().toLowerCase() === HOURLY_HELPER_CATEGORY_SLUG) {
    return true;
  }
  const slug = String(line.packageSlug || line.packageId || '')
    .trim()
    .toLowerCase();
  return slug.startsWith('hourly-');
}

export function parseBookingFulfillmentType(
  raw: unknown,
): BookingFulfillmentType | undefined {
  if (raw == null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === 'instant' || v === 'scheduled') return v;
  throw new BadRequestError('fulfillmentType must be instant or scheduled');
}

type HourlyCheckoutLine = {
  pricingUnit?: string;
  categorySlug?: string;
  skuId?: unknown;
  quantity: number;
  durationMinutes: number;
  lineTotal: number;
};

function assertHourlyLineBasics(line: HourlyCheckoutLine): void {
  if (!line.skuId) {
    throw new BadRequestError('Hourly Helper requires a catalog SKU (skuId)');
  }
  if (line.quantity !== 1) {
    throw new BadRequestError('Hourly Helper quantity must be 1');
  }
  if (!Number.isInteger(line.durationMinutes) || line.durationMinutes < 1) {
    throw new BadRequestError('Hourly duration must be greater than zero');
  }
  if (!(line.lineTotal > 0)) {
    throw new BadRequestError('Hourly Helper line total must be greater than zero');
  }
}

/**
 * Hourly checkout rules:
 * - Single visit: exactly one hourly line (instant or scheduled)
 * - Multi-day pack: 2+ hourly lines, same SKU + duration, scheduled only
 *   (one BookingOrder → N visit tasks; RecurringPlan may replace this later)
 */
export function assertHourlySingleVisitCheckout(params: {
  lines: HourlyCheckoutLine[];
  fulfillmentType?: BookingFulfillmentType;
}): void {
  const hourlyLines = params.lines.filter(isHourlyResolvedLine);
  if (hourlyLines.length === 0) return;

  if (hourlyLines.length !== params.lines.length) {
    throw new BadRequestError('Hourly Helper cannot be mixed with other Book Now packages in one order');
  }

  if (!params.fulfillmentType) {
    throw new BadRequestError('Hourly Helper requires fulfillmentType (instant or scheduled)');
  }

  if (params.lines.length === 1) {
    assertHourlyLineBasics(params.lines[0]);
    return;
  }

  // Multi-visit (multi-day) pack on one BookingOrder
  if (params.fulfillmentType !== 'scheduled') {
    throw new BadRequestError('Multi-day Hourly Helper requires fulfillmentType scheduled');
  }

  const firstSku = String(params.lines[0]?.skuId ?? '');
  const firstDuration = params.lines[0]?.durationMinutes;
  for (const line of params.lines) {
    assertHourlyLineBasics(line);
    if (String(line.skuId) !== firstSku) {
      throw new BadRequestError('Multi-day Hourly Helper visits must use the same duration SKU');
    }
    if (line.durationMinutes !== firstDuration) {
      throw new BadRequestError('Multi-day Hourly Helper visits must share the same duration');
    }
  }
}

export function hourInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === 'hour');
  return Number(hourPart?.value ?? '0');
}

function parseTimeLabelToMinutes(timeLabel: string): number | null {
  const match = String(timeLabel || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return null;

  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** Scheduled Hourly bookings must start and finish within the 7 PM cutoff. */
export function assertHourlyScheduledSlotWithinOperatingHours(params: {
  scheduledTimeStart?: string;
  durationMinutes: number;
  endHour?: number;
}): void {
  const startMinutes = parseTimeLabelToMinutes(params.scheduledTimeStart || '');
  const durationMinutes = Math.round(Number(params.durationMinutes));
  const endHour = Number.isFinite(params.endHour)
    ? Number(params.endHour)
    : HOURLY_SCHEDULED_END_HOUR;

  if (startMinutes == null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new BadRequestError('Hourly Helper requires a valid start time and duration');
  }

  if (startMinutes >= endHour * 60 || startMinutes + durationMinutes > endHour * 60) {
    throw new BadRequestError(
      `Scheduled Hourly Helper bookings must finish by ${String(endHour).padStart(2, '0')}:00. Please choose an earlier slot.`,
    );
  }
}

/** Instant only inside configured local operating hours (default Asia/Kolkata 08:00–20:00). */
export function assertHourlyInstantOperatingHours(params: {
  now?: Date;
  startHour: number;
  endHour: number;
  timeZone?: string;
}): void {
  const timeZone = params.timeZone || HOURLY_INSTANT_TIMEZONE;
  const start =
    Number.isFinite(params.startHour) ? params.startHour : HOURLY_INSTANT_DEFAULT_START_HOUR;
  const end = Number.isFinite(params.endHour) ? params.endHour : HOURLY_INSTANT_DEFAULT_END_HOUR;
  const hour = hourInTimeZone(params.now || new Date(), timeZone);

  if (hour < start || hour >= end) {
    throw new BadRequestError(
      `Instant Hourly Helper is only available between ${String(start).padStart(2, '0')}:00 and ${String(end).padStart(2, '0')}:00 (${timeZone}). Please book a Scheduled slot instead.`,
    );
  }
}
