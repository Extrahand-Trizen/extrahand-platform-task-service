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
};

export const BOOK_NOW_TASK_CATEGORY_BY_CATALOG: Record<string, string> = {
  'full-house': 'cleaning',
  bathroom: 'cleaning',
  kitchen: 'cleaning',
  sofa: 'cleaning',
  mattress: 'cleaning',
  'window-glass': 'cleaning',
  'ac-services': 'repair',
  'appliance-repair': 'repair',
};

export function resolveBookNowTaskCategory(catalogId: string): string {
  return BOOK_NOW_TASK_CATEGORY_BY_CATALOG[catalogId] || 'cleaning';
}

export function resolveBookNowCategoryLabel(catalogId: string): string {
  return BOOK_NOW_CATALOG_LABELS[catalogId] || catalogId;
}
