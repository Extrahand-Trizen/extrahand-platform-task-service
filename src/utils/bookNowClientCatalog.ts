import type { TaskCategory } from '../types';

/** Task.category enum values — Book Now must never write outside this set. */
const TASK_CATEGORY_ENUM: ReadonlySet<string> = new Set([
  'cleaning',
  'repair',
  'delivery',
  'assembly',
  'gardening',
  'petcare',
  'packers-movers',
  'other',
]);

/** Mirrors extrahand-mobile-app Book Now catalogId → task metadata (no MongoDB required). */
export const BOOK_NOW_CATALOG_LABELS: Record<string, string> = {
  'full-house': 'Full House Cleaning',
  bathroom: 'Bathroom Cleaning',
  kitchen: 'Kitchen Cleaning',
  sofa: 'Sofa Cleaning',
  mattress: 'Mattress Cleaning',
  'window-glass': 'Window & Glass Cleaning',
  'ac-services': 'AC Services',
  'appliance-repair': 'Appliance Repair',
  'hourly-helper': 'Hourly Helper',
};

export const BOOK_NOW_TASK_CATEGORY_BY_CATALOG: Record<string, TaskCategory> = {
  'full-house': 'cleaning',
  bathroom: 'cleaning',
  kitchen: 'cleaning',
  sofa: 'cleaning',
  mattress: 'cleaning',
  'window-glass': 'cleaning',
  'ac-services': 'repair',
  'appliance-repair': 'repair',
  /** Hourly Helper is general help — maps to Task enum `other` (not a catalog slug). */
  'hourly-helper': 'other',
};

/** Legacy / mistaken SKU.taskCategory values → valid Task.category. */
const TASK_CATEGORY_ALIASES: Record<string, TaskCategory> = {
  helper: 'other',
  'hourly-helper': 'other',
  handyman: 'repair',
  cleaning: 'cleaning',
  repair: 'repair',
  delivery: 'delivery',
  assembly: 'assembly',
  gardening: 'gardening',
  petcare: 'petcare',
  'packers-movers': 'packers-movers',
  other: 'other',
};

export function resolveBookNowTaskCategory(catalogId: string): TaskCategory {
  return BOOK_NOW_TASK_CATEGORY_BY_CATALOG[catalogId] || 'cleaning';
}

/**
 * Coerce catalog/SKU taskCategory into a valid Task.category enum value.
 * Prevents payment-captured Task.create ValidationError (e.g. `helper`).
 */
export function normalizeBookNowTaskCategory(raw: string | undefined | null): TaskCategory {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (!key) return 'other';
  if (TASK_CATEGORY_ALIASES[key]) return TASK_CATEGORY_ALIASES[key];
  if (TASK_CATEGORY_ENUM.has(key)) return key as TaskCategory;
  if (BOOK_NOW_TASK_CATEGORY_BY_CATALOG[key]) return BOOK_NOW_TASK_CATEGORY_BY_CATALOG[key];
  return 'other';
}

export function resolveBookNowCategoryLabel(catalogId: string): string {
  return BOOK_NOW_CATALOG_LABELS[catalogId] || catalogId;
}
