const MINUTE_MS = 60 * 1000;

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const bookNowRecurringConfig = {
  visitHorizon: envNumber('BOOK_NOW_RECURRING_VISIT_HORIZON', 7),
  maxOccurrences: envNumber('BOOK_NOW_RECURRING_MAX_OCCURRENCES', 366),
  horizonMonths: envNumber('BOOK_NOW_RECURRING_HORIZON_MONTHS', 6),
  firstVisitLeadHours: envNumber('BOOK_NOW_RECURRING_FIRST_VISIT_LEAD_HOURS', 6),
  minGapHours: envNumber('BOOK_NOW_RECURRING_MIN_GAP_HOURS', 4),
  cancelLeadHours: envNumber('BOOK_NOW_RECURRING_CANCEL_LEAD_HOURS', 6),
  rescheduleLeadHours: envNumber('BOOK_NOW_RECURRING_RESCHEDULE_LEAD_HOURS', 6),
  paymentOpenLeadHours: envNumber('BOOK_NOW_RECURRING_PAYMENT_OPEN_LEAD_HOURS', 72),
  paymentCutoffHours: envNumber('BOOK_NOW_RECURRING_PAYMENT_CUTOFF_HOURS', 6),
  paymentMinWindowMinutes: envNumber('BOOK_NOW_RECURRING_PAYMENT_MIN_WINDOW_MINUTES', 60),
  consecutiveUnpaidPause: envNumber('BOOK_NOW_RECURRING_UNPAID_PAUSE_THRESHOLD', 2),
};

export function hoursToMs(hours: number): number {
  return hours * 60 * MINUTE_MS;
}

export const PRICE_MAY_VARY_DISCLAIMER = 'Price may vary per visit based on current rates.';

export const BookNowRecurringErrors = {
  INSTANT_NOT_ALLOWED: 'Instant Book Now jobs cannot be booked as a recurring series.',
  SCHEDULED_ONLY: 'Recurring is only available for scheduled Book Now jobs.',
  HOURLY_NOT_ALLOWED: 'Hourly Helper cannot be booked as a recurring job.',
  SERVICE_NOT_ALLOWED: 'This service cannot be booked as a recurring job.',
  CONSULTATION_NOT_ALLOWED: 'Consultation and project bookings cannot be recurring.',
  PATTERN_NOT_ALLOWED: 'Choose weekly, selected weekdays, or every 2 weeks.',
  WEEKDAYS_REQUIRED: 'Select at least one weekday for this recurring plan.',
  FIRST_VISIT_LEAD: 'The first visit must be at least 6 hours from now.',
  MIN_GAP: 'Recurring visits must be at least 4 hours apart.',
  HORIZON: 'Recurring plans cannot be scheduled more than 6 months ahead.',
  EMPTY_SCHEDULE: 'Recurring schedule has no dates in the selected range.',
  TOO_MANY_VISITS: 'Recurring plan exceeds the maximum supported 366 visits.',
  CANCEL_LEAD: 'A visit can only be cancelled up to 6 hours before it starts.',
  RESCHEDULE_LEAD: 'This visit cannot be rescheduled less than 6 hours before it starts.',
  PLAN_NOT_ACTIVE: 'This recurring plan is not active.',
  VISIT_NOT_CANCELLABLE: 'This visit can no longer be cancelled.',
  VISIT_NOT_RESCHEDULABLE: 'This visit can no longer be rescheduled.',
  NOT_OWNER: 'Not your recurring plan.',
} as const;
