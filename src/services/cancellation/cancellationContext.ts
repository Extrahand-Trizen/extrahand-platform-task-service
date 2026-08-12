/**
 * Pure helpers to build HourlyCancellationContext from booking/task facts.
 * No DB access — unit-testable without Mongo.
 */

import { HOURLY_DURATION_SKUS, HOURLY_HELPER_CATEGORY_SLUG } from '../../constants/hourlyBooking';
import { BadRequestError } from '../../errors/AppError';
import type { BookingOrderStatus } from '../../models/BookingOrder';
import { isHourlyCatalogLineInput, isHourlyResolvedLine } from '../../utils/hourlyBookingGuards';
import type {
  CancelledBy,
  HourlyCancellationContext,
  HourlyCancellationResult,
  PersistedHourlyCancellationResult,
  TaskExecutionPhase,
  TaskStatus,
} from './cancellationTypes';

const IST_OFFSET = '+05:30';

export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees < 0) return 0;
  return Math.round(rupees * 100);
}

/** Default first-hour catalog rate (paise) from seeded hourly-1h SKU. */
export function defaultFirstHourRatePaise(): number {
  const oneHour = HOURLY_DURATION_SKUS.find((s) => s.durationMinutes === 60);
  const rupees = oneHour?.basePrice ?? 99;
  return rupeesToPaise(rupees);
}

function parseSlotToMinutes(slot: string): number | null {
  const match = String(slot || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** Format a stored schedule Date as YYYY-MM-DD in IST (+05:30). */
export function formatScheduleDateKeyIST(scheduledDate: Date): string {
  const shifted = new Date(scheduledDate.getTime() + 5.5 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Combine Book Now schedule date + "h:mm AM/PM" start into an absolute Instant.
 * Matches how slots are stored (calendar day in +05:30).
 */
export function resolveVisitScheduledAt(params: {
  scheduledDate?: Date | null;
  scheduledTimeStart?: string | null;
}): Date {
  if (!params.scheduledDate) {
    throw new BadRequestError('Booking is missing a scheduled date');
  }
  const dateKey = formatScheduleDateKeyIST(params.scheduledDate);
  const mins = parseSlotToMinutes(String(params.scheduledTimeStart || '').trim());
  const total = mins == null ? 0 : mins;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return new Date(`${dateKey}T${hh}:${mm}:00.000${IST_OFFSET}`);
}

export type HourlyLineHint = {
  categorySlug?: string | null;
  skuSlug?: string | null;
  pricingUnit?: string | null;
};

export function isHourlyBookingFromHints(hints: HourlyLineHint[]): boolean {
  return hints.some(
    (h) =>
      isHourlyResolvedLine({
        pricingUnit: h.pricingUnit || undefined,
        categorySlug: h.categorySlug || undefined,
      }) ||
      isHourlyCatalogLineInput({
        categorySlug: h.categorySlug,
        skuSlug: h.skuSlug,
      }),
  );
}

export function normalizeTaskExecutionPhase(
  raw: unknown,
): TaskExecutionPhase | null {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'assigned' || v === 'on_the_way' || v === 'arrived') return v;
  return null;
}

export function normalizeTaskStatus(raw: unknown): TaskStatus | undefined {
  const v = String(raw || '').trim().toLowerCase();
  const allowed: TaskStatus[] = [
    'open',
    'assigned',
    'started',
    'in_progress',
    'review',
    'completed',
    'cancelled',
  ];
  return allowed.includes(v as TaskStatus) ? (v as TaskStatus) : undefined;
}

export function buildHourlyCancellationContext(input: {
  paidAmountRupees: number;
  firstHourRatePaise?: number;
  cancelledBy: CancelledBy;
  cancelledAt: Date;
  scheduledDate?: Date | null;
  scheduledTimeStart?: string | null;
  bookingStatus: BookingOrderStatus;
  taskStatus?: unknown;
  taskExecutionPhase?: unknown;
  /** Source of truth: Task.assigneeUid / assigneeId present. */
  helperAssigned?: boolean;
}): HourlyCancellationContext {
  return {
    paidAmountPaise: rupeesToPaise(input.paidAmountRupees),
    firstHourRatePaise:
      input.firstHourRatePaise != null
        ? Math.max(0, Math.trunc(input.firstHourRatePaise))
        : defaultFirstHourRatePaise(),
    cancelledBy: input.cancelledBy,
    cancelledAt: input.cancelledAt,
    scheduledAt: resolveVisitScheduledAt({
      scheduledDate: input.scheduledDate,
      scheduledTimeStart: input.scheduledTimeStart,
    }),
    bookingStatus: input.bookingStatus,
    taskStatus: normalizeTaskStatus(input.taskStatus),
    taskExecutionPhase: normalizeTaskExecutionPhase(input.taskExecutionPhase),
    helperAssigned: Boolean(input.helperAssigned),
  };
}

export function isPersistedCancellationResult(
  value: unknown,
): value is PersistedHourlyCancellationResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.status === 'ALLOWED' || v.status === 'DENIED') &&
    typeof v.reasonCode === 'string' &&
    typeof v.customerFeePaise === 'number' &&
    v.settlement != null &&
    typeof v.settlement === 'object'
  );
}

export function toHourlyCancellationResult(
  persisted: PersistedHourlyCancellationResult,
): HourlyCancellationResult {
  return {
    status: persisted.status,
    reasonCode: persisted.reasonCode,
    reason: persisted.reason,
    customerFeePaise: persisted.customerFeePaise,
    settlement: persisted.settlement,
    refundRequired: persisted.refundRequired,
  };
}

export { HOURLY_HELPER_CATEGORY_SLUG };
