/**
 * Book Now Hourly M1 — product constants (single-visit checkout).
 * RecurringPlan / packs are out of scope.
 */

export const HOURLY_HELPER_CATEGORY_SLUG = 'hourly-helper' as const;

/** partnerProfile.categories values that qualify a partner as an Hourly Helper. */
export const HOURLY_HELPER_PARTNER_CATEGORIES: readonly string[] = ['cleaning'];

export const HOURLY_HELPER_COMING_SOON_CODE = 'HOURLY_HELPER_COMING_SOON' as const;

/** Catalog SKU slug ↔ duration. Client duration key = slug. */
export const HOURLY_DURATION_SKUS: ReadonlyArray<{
  slug: string;
  durationMinutes: number;
  name: string;
  /** Seed list price (INR). Ops may change via catalog; create path uses live SKU.basePrice. */
  basePrice: number;
  offerPrice: number;
  description: string;
}> = [
  {
    slug: 'hourly-1h',
    durationMinutes: 60,
    name: 'ExtraHand Assist · 1 hour',
    basePrice: 99,
    offerPrice: 0,
    description: 'Book a helper for 1 hour of on-demand help.',
  },
  {
    slug: 'hourly-1-5h',
    durationMinutes: 90,
    name: 'ExtraHand Assist · 1.5 hours',
    basePrice: 149,
    offerPrice: 0,
    description: 'Book a helper for 1.5 hours of on-demand help.',
  },
  {
    slug: 'hourly-2h',
    durationMinutes: 120,
    name: 'ExtraHand Assist · 2 hours',
    basePrice: 189,
    offerPrice: 0,
    description: 'Book a helper for 2 hours of on-demand help.',
  },
  {
    slug: 'hourly-3h',
    durationMinutes: 180,
    name: 'ExtraHand Assist · 3 hours',
    basePrice: 269,
    offerPrice: 0,
    description: 'Book a helper for 3 hours of on-demand help.',
  },
  {
    slug: 'hourly-4h',
    durationMinutes: 240,
    name: 'ExtraHand Assist · 4 hours',
    basePrice: 349,
    offerPrice: 0,
    description: 'Book a helper for 4 hours of on-demand help.',
  },
  {
    slug: 'hourly-30m',
    durationMinutes: 30,
    name: 'ExtraHand Assist · 30 minutes',
    basePrice: 39,
    offerPrice: 0,
    description: 'Book a helper for 30 minutes of on-demand help.',
  },
  {
    slug: 'hourly-45m',
    durationMinutes: 45,
    name: 'ExtraHand Assist · 45 minutes',
    basePrice: 49,
    offerPrice: 0,
    description: 'Book a helper for 45 minutes of on-demand help.',
  },
];

export function getHourlyHelperSkuDisplayName(durationMinutes: number): string {
  const configuredSku = HOURLY_DURATION_SKUS.find((sku) => sku.durationMinutes === durationMinutes);
  if (configuredSku) return configuredSku.name;

  const minutes = Number(durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'ExtraHand Assist';

  const durationLabel =
    minutes < 60
      ? `${minutes} minute${minutes === 1 ? '' : 's'}`
      : minutes % 60 === 0
        ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
        : minutes % 30 === 0
          ? `${Number((minutes / 60).toFixed(1))} hours`
          : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  return `ExtraHand Assist · ${durationLabel}`;
}

export const HOURLY_HELPER_CATEGORY = {
  slug: HOURLY_HELPER_CATEGORY_SLUG,
  name: 'Hourly Helper',
  sortOrder: 90,
  description: 'Book helper time by the hour — Instant or Scheduled.',
} as const;

/** Default Instant window in Asia/Kolkata (inclusive start, exclusive end hour). */
export const HOURLY_INSTANT_DEFAULT_START_HOUR = 8;
export const HOURLY_INSTANT_DEFAULT_END_HOUR = 19;
export const HOURLY_INSTANT_TIMEZONE = 'Asia/Kolkata';

/** Scheduled Hourly bookings must finish by 8:00 PM local time. */
export const HOURLY_SCHEDULED_START_HOUR = 7;
export const HOURLY_SCHEDULED_END_HOUR = 20;
