/**
 * Shared recurring types for Post Work and Book Now.
 * Book Now visit rows still persist the existing RecurringVisit status strings;
 * these enums are the product vocabulary used by the Book Now adapter.
 */

export const PLAN_STATES = ['DRAFT', 'ACTIVE', 'PAUSED', 'CANCELLED', 'ENDED'] as const;
export type PlanState = (typeof PLAN_STATES)[number];

export const VISIT_STATES = [
  'SCHEDULED',
  'PAYMENT_OPEN',
  'PAID',
  'UNPAID',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type VisitState = (typeof VISIT_STATES)[number];

export const BOOK_NOW_RECURRENCE_PATTERNS = ['weekly', 'selected_weekdays', 'biweekly'] as const;
export type BookNowRecurrencePattern = (typeof BOOK_NOW_RECURRENCE_PATTERNS)[number];

export type RecurringServiceType = 'post_work' | 'book_now';

export const TERMINAL_PLAN_STATES: ReadonlySet<PlanState> = new Set(['CANCELLED', 'ENDED']);
export const TERMINAL_VISIT_STATES: ReadonlySet<VisitState> = new Set([
  'UNPAID',
  'COMPLETED',
  'CANCELLED',
]);

export type RecurringPriceSnapshot = {
  basePrice: number;
  platformFee: number;
  gst: number;
  totalPrice: number;
  currency: 'INR';
  pricedAt: string;
};

export type RecurrenceRule = {
  pattern: BookNowRecurrencePattern;
  selectedWeekdays?: number[];
  startDateKey: string;
  endDateKey?: string;
  scheduledTimeStart: string;
  scheduledTimeEnd?: string;
  durationMinutes?: number;
};

export type GeneratedVisitSlot = {
  dateKey: string;
  date: Date;
  scheduledAt: Date;
  visitIndex: number;
};

/** Stored RecurringVisit.status ↔ Book Now VisitState */
export const VISIT_STATUS_TO_STATE: Record<string, VisitState> = {
  scheduled: 'SCHEDULED',
  payment_pending: 'PAYMENT_OPEN',
  confirmed: 'PAID',
  skipped_unpaid: 'UNPAID',
  in_progress: 'IN_PROGRESS',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

export const VISIT_STATE_TO_STATUS: Record<VisitState, string> = {
  SCHEDULED: 'scheduled',
  PAYMENT_OPEN: 'payment_pending',
  PAID: 'confirmed',
  UNPAID: 'skipped_unpaid',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const PLAN_STATUS_TO_STATE: Record<string, PlanState> = {
  draft: 'DRAFT',
  active: 'ACTIVE',
  paused: 'PAUSED',
  cancelled: 'CANCELLED',
  ended: 'ENDED',
};

export const PLAN_STATE_TO_STATUS: Record<PlanState, string> = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  ENDED: 'ended',
};
