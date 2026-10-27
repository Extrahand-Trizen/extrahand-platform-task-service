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
  'painting-interior': 'Interior Painting',
  'painting-exterior': 'Exterior Painting',
  'painting-rental': 'Rental Painting',
  'painting-waterproofing': 'Waterproofing',
  painting: 'Painting',
  'car-wash-basic': 'Basic Car Wash',
  'car-wash-premium': 'Premium Car Wash',
  'car-wash-interior-deep-cleaning': 'Car Interior Deep Cleaning',
  'car-wash-sanitization': 'Car Sanitization',
  'laundry-wash-by-weight': 'Wash by Weight',
  'laundry-ironing-services': 'Ironing Services',
  'laundry-traditional-wear': 'Traditional Wear',
  'laundry-bedding-and-blankets': 'Bedding & Blankets',
  'laundry-shoe-cleaning': 'Shoe Cleaning',
  'hourly-helper': 'Hourly Helper',
  'personal-assistance': 'Personal Assistant',
};

export const BOOK_NOW_TASK_CATEGORY_BY_CATALOG: Record<string, TaskCategory> = {
  'daily-labour': 'other',
  'full-house': 'cleaning',
  bathroom: 'cleaning',
  kitchen: 'cleaning',
  sofa: 'cleaning',
  mattress: 'cleaning',
  'window-glass': 'cleaning',
  'ac-services': 'repair',
  'appliance-repair': 'repair',
  'painting-interior': 'other',
  'painting-exterior': 'other',
  'painting-rental': 'other',
  'painting-waterproofing': 'other',
  painting: 'other',
  'car-wash-basic': 'cleaning',
  'car-wash-premium': 'cleaning',
  'car-wash-interior-deep-cleaning': 'cleaning',
  'car-wash-sanitization': 'cleaning',
  'laundry-wash-by-weight': 'cleaning',
  'laundry-ironing-services': 'cleaning',
  'laundry-traditional-wear': 'cleaning',
  'laundry-bedding-and-blankets': 'cleaning',
  'laundry-shoe-cleaning': 'cleaning',
  /** Hourly Helper is general help — maps to Task enum `other` (not a catalog slug). */
  'hourly-helper': 'other',
  'personal-assistance': 'other',
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
  const key = String(catalogId || '')
    .trim()
    .toLowerCase();
  if (key === 'daily-labour') return 'other';
  if (BOOK_NOW_TASK_CATEGORY_BY_CATALOG[key]) {
    return BOOK_NOW_TASK_CATEGORY_BY_CATALOG[key];
  }
  if (key === 'painting' || key.startsWith('painting-')) {
    return 'other';
  }
  return 'cleaning';
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
export const HOME_CLEANING_SLUGS = [
  'full-house',
  'bathroom',
  'kitchen',
  'sofa',
  'mattress',
  'window-glass',
  'home-cleaning',
];

export type ParentCategoryInfo = {
  slug: string;
  label: string;
};

export function resolveParentCategory(catalogIdOrSlug: string): ParentCategoryInfo {
  const s = String(catalogIdOrSlug || '').trim().toLowerCase();
  if (HOME_CLEANING_SLUGS.includes(s)) {
    return { slug: 'home-cleaning', label: 'Home Cleaning' };
  }
  if (['ac-services', 'ac-repair', 'ac-servicing', 'gas-refill', 'install', 'uninstall'].includes(s)) {
    return { slug: 'ac-services', label: 'AC Services' };
  }
  if (['appliance-repair', 'washing-machine', 'refrigerator', 'water-purifier', 'geyser'].includes(s)) {
    return { slug: 'appliance-repair', label: 'Appliance Repair' };
  }
  if (['personal-assistance', 'personal-assistant'].includes(s)) {
    return { slug: 'personal-assistance', label: 'Personal Assistance' };
  }
  if (s === 'daily-labour') {
    return { slug: 'daily-labour', label: 'Daily Labour' };
  }
  if (s === 'hourly-helper') {
    return { slug: 'hourly-helper', label: 'Hourly Helper' };
  }
  if (s.startsWith('painting')) {
    return { slug: 'painting', label: 'Painting' };
  }
  if (s.startsWith('electrician')) {
    return { slug: 'electrician-switch-and-socket', label: 'Switch & Socket' };
  }
  if (s.startsWith('plumbing')) {
    return { slug: 'plumbing', label: 'Plumbing' };
  }
  if (s.startsWith('carpentry')) {
    return { slug: 'carpentry', label: 'Carpentry' };
  }
  if (s.startsWith('pest-control')) {
    return { slug: 'pest-control', label: 'Pest Control' };
  }
  if (s.startsWith('car-wash')) {
    return { slug: 'car-wash', label: 'Car Wash' };
  }
  if (s.startsWith('laundry')) {
    return { slug: 'laundry', label: 'Laundry' };
  }
  return { slug: s, label: resolveBookNowCategoryLabel(s) };
}
