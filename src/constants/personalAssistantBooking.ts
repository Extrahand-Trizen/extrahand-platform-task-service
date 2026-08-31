/**
 * Book Now Personal Assistant — category + duration SKUs (single-visit checkout).
 */

export const PERSONAL_ASSISTANT_CATEGORY_SLUG = 'personal-assistance' as const;

export const PERSONAL_ASSISTANT_DURATION_SKUS: ReadonlyArray<{
  slug: string;
  durationMinutes: 60 | 120 | 180 | 240;
  name: string;
  basePrice: number;
  description: string;
}> = [
  {
    slug: 'personal-assistance-hourly-1h',
    durationMinutes: 60,
    name: 'Personal Assistant · 1 hour',
    basePrice: 149,
    description: 'Book a personal assistant for 1 hour of on-demand help.',
  },
  {
    slug: 'personal-assistance-hourly-2h',
    durationMinutes: 120,
    name: 'Personal Assistant · 2 hours',
    basePrice: 189,
    description: 'Book a personal assistant for 2 hours of on-demand help.',
  },
  {
    slug: 'personal-assistance-hourly-3h',
    durationMinutes: 180,
    name: 'Personal Assistant · 3 hours',
    basePrice: 269,
    description: 'Book a personal assistant for 3 hours of on-demand help.',
  },
  {
    slug: 'personal-assistance-hourly-4h',
    durationMinutes: 240,
    name: 'Personal Assistant · 4 hours',
    basePrice: 349,
    description: 'Book a personal assistant for 4 hours of on-demand help.',
  },
];

export const PERSONAL_ASSISTANT_CATEGORY = {
  slug: PERSONAL_ASSISTANT_CATEGORY_SLUG,
  name: 'Personal Assistant',
  sortOrder: 5,
  description: 'Errands, queue assistance, documents, and everyday tasks.',
} as const;
