import { BadRequestError } from '../errors/AppError';
import {
  HOURLY_ALLOWED_DURATION_MINUTES,
  HOURLY_DURATION_SET,
  HOURLY_HELPER_CATEGORY_SLUG,
  HOURLY_INSTANT_DEFAULT_END_HOUR,
  HOURLY_INSTANT_DEFAULT_START_HOUR,
  HOURLY_INSTANT_TIMEZONE,
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

/** Resolved line is Hourly (pricingUnit or category). Line count is NOT part of this check. */
export function isHourlyResolvedLine(line: {
  pricingUnit?: string;
  categorySlug?: string;
}): boolean {
  if (line.pricingUnit === 'hourly') return true;
  return String(line.categorySlug || '').trim().toLowerCase() === HOURLY_HELPER_CATEGORY_SLUG;
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
  if (!HOURLY_DURATION_SET.has(line.durationMinutes)) {
    throw new BadRequestError(
      `Hourly duration must be one of: ${HOURLY_ALLOWED_DURATION_MINUTES.join(', ')} minutes`,
    );
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
