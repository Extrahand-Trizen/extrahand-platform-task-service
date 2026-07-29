/**
 * Book Now Hourly M1 — product constants (single-visit checkout).
 * RecurringPlan / packs are out of scope.
 */

export const HOURLY_HELPER_CATEGORY_SLUG = 'hourly-helper' as const;

/** Allowed booked durations (minutes). */
export const HOURLY_ALLOWED_DURATION_MINUTES = [60, 90, 120, 180, 240] as const;
export type HourlyAllowedDurationMinutes = (typeof HOURLY_ALLOWED_DURATION_MINUTES)[number];

export const HOURLY_DURATION_SET: ReadonlySet<number> = new Set(HOURLY_ALLOWED_DURATION_MINUTES);

/** Catalog SKU slug ↔ duration. Client duration key = slug. */
export const HOURLY_DURATION_SKUS: ReadonlyArray<{
  slug: string;
  durationMinutes: HourlyAllowedDurationMinutes;
  name: string;
  /** Seed list price (INR). Ops may change via catalog; create path uses live SKU.basePrice. */
  basePrice: number;
  description: string;
}> = [
  {
    slug: 'hourly-1h',
    durationMinutes: 60,
    name: 'Helper · 1 hour',
    basePrice: 99,
    description: 'Book a helper for 1 hour of on-demand help.',
  },
  {
    slug: 'hourly-1-5h',
    durationMinutes: 90,
    name: 'Helper · 1.5 hours',
    basePrice: 149,
    description: 'Book a helper for 1.5 hours of on-demand help.',
  },
  {
    slug: 'hourly-2h',
    durationMinutes: 120,
    name: 'Helper · 2 hours',
    basePrice: 189,
    description: 'Book a helper for 2 hours of on-demand help.',
  },
  {
    slug: 'hourly-3h',
    durationMinutes: 180,
    name: 'Helper · 3 hours',
    basePrice: 269,
    description: 'Book a helper for 3 hours of on-demand help.',
  },
  {
    slug: 'hourly-4h',
    durationMinutes: 240,
    name: 'Helper · 4 hours',
    basePrice: 349,
    description: 'Book a helper for 4 hours of on-demand help.',
  },
];

export const HOURLY_HELPER_CATEGORY = {
  slug: HOURLY_HELPER_CATEGORY_SLUG,
  name: 'Hourly Helper',
  sortOrder: 90,
  description: 'Book helper time by the hour — Instant or Scheduled.',
} as const;

/** Default Instant window in Asia/Kolkata (inclusive start, exclusive end hour). */
export const HOURLY_INSTANT_DEFAULT_START_HOUR = 8;
export const HOURLY_INSTANT_DEFAULT_END_HOUR = 20;
export const HOURLY_INSTANT_TIMEZONE = 'Asia/Kolkata';
