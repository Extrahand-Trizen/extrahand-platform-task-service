import type { TaskCategory } from '../types';

/** Task.category enum values — includes both legacy broad enums and canonical category IDs. */
const TASK_CATEGORY_ENUM: ReadonlySet<string> = new Set([
  // Legacy broad enums
  'cleaning',
  'repair',
  'delivery',
  'assembly',
  'gardening',
  'petcare',
  'packers-movers',
  'other',
  // Canonical category IDs (from categoryTree.ts)
  'electrician',
  'appliance_repair',
  'ac_service',
  'plumbing',
  'carpentry',
  'pest_control',
  'beauty_services',
  'delivery_logistics',
  'driving',
  'painting',
  'car_wash',
  'pet_services',
  'event_services',
  'professional_services',
  'care_services',
  'laundry',
  'deep_cleaning',
  'maid',
  'handyperson',
  'accounting',
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
  // Electrician services
  'electrician-switch-and-socket': 'repair',
  'electrician-fan-and-light': 'repair',
  'electrician-mcb-wiring': 'repair',
  'electrician-general': 'repair',
  // Plumbing services
  plumbing: 'repair',
  'plumbing-toilet': 'repair',
  'plumbing-tap-mixer': 'repair',
  'plumbing-pipeline': 'repair',
  'plumbing-drainage': 'repair',
  'plumbing-water-tank': 'repair',
  'plumbing-bath-shower': 'repair',
  'plumbing-general': 'repair',
  // Carpentry services
  carpentry: 'repair',
  'carpentry-door-window': 'repair',
  'carpentry-furniture': 'repair',
  'carpentry-general': 'repair',
  // Pest control
  'pest-control': 'other',
  'pest-control-termite': 'other',
  'pest-control-cockroach': 'other',
  'pest-control-general': 'other',
  // Bath accessories / installation
  'bath-accessories': 'repair',
  'bath-accessories-installation': 'repair',
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
  // Prefix-based resolution for service families not individually listed above
  if (key === 'painting' || key.startsWith('painting-')) return 'other';
  if (key === 'electrician' || key.startsWith('electrician-')) return 'repair';
  if (key === 'plumbing' || key.startsWith('plumbing-')) return 'repair';
  if (key === 'carpentry' || key.startsWith('carpentry-')) return 'repair';
  if (key === 'pest-control' || key.startsWith('pest-control-')) return 'other';
  if (key === 'bath-accessories' || key.startsWith('bath-accessories-')) return 'repair';
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

/**
 * Maps a booking categorySlug → the exact partner profile category ID stored
 * in MongoDB (profiles.partnerProfile.categories[]).
 * These IDs come from categoryTree.ts in the helper app and are the canonical
 * values partners register under.
 */
export const CATALOG_SLUG_TO_PARTNER_CATEGORY_ID: Record<string, string> = {
  // ── Canonical category IDs (from mobile app taskPostingTransform CATEGORY_TO_SLUG)
  // Pass-through: these are already the correct partner category IDs.
  cleaning: 'cleaning',
  electrician: 'electrician',
  appliance_repair: 'appliance_repair',
  ac_service: 'ac_service',
  plumbing: 'plumbing',
  carpentry: 'carpentry',
  pest_control: 'pest_control',
  beauty_services: 'beauty_services',
  delivery_logistics: 'delivery_logistics',
  driving: 'driving',
  painting: 'painting',
  car_wash: 'car_wash',
  pet_services: 'pet_services',
  event_services: 'event_services',
  // ── Legacy / hyphenated slugs kept for backward-compat ───────────────────
  // Cleaning family
  'full-house': 'cleaning',
  bathroom: 'cleaning',
  kitchen: 'cleaning',
  sofa: 'cleaning',
  mattress: 'cleaning',
  'window-glass': 'cleaning',
  'home-cleaning': 'cleaning',
  'deep-cleaning': 'cleaning',
  'car-wash-basic': 'car_wash',
  'car-wash-premium': 'car_wash',
  'car-wash-interior-deep-cleaning': 'car_wash',
  'car-wash-sanitization': 'car_wash',
  'laundry-wash-by-weight': 'laundry',
  'laundry-ironing-services': 'laundry',
  'laundry-traditional-wear': 'laundry',
  'laundry-bedding-and-blankets': 'laundry',
  'laundry-shoe-cleaning': 'laundry',
  // Electrician family
  'electrician-switch-and-socket': 'electrician',
  'electrician-fan-and-light': 'electrician',
  'electrician-mcb-wiring': 'electrician',
  'electrician-general': 'electrician',
  electrical: 'electrician',
  // Appliance repair
  'appliance-repair': 'appliance_repair',
  // AC service
  'ac-services': 'ac_service',
  'ac-repair': 'ac_service',
  'ac-service': 'ac_service',
  // Plumbing family
  plumbing: 'plumbing',
  'plumbing-toilet': 'plumbing',
  'plumbing-tap-mixer': 'plumbing',
  'plumbing-pipeline': 'plumbing',
  'plumbing-drainage': 'plumbing',
  'plumbing-water-tank': 'plumbing',
  'plumbing-bath-shower': 'plumbing',
  'plumbing-general': 'plumbing',
  // Carpentry family
  carpenter: 'carpentry',
  'carpentry-door-window': 'carpentry',
  'carpentry-furniture': 'carpentry',
  'carpentry-general': 'carpentry',
  // Pest control
  'pest-control': 'pest_control',
  'pest-control-termite': 'pest_control',
  'pest-control-cockroach': 'pest_control',
  'pest-control-general': 'pest_control',
  // Bath accessories
  'bath-accessories': 'carpentry',
  'bath-accessories-installation': 'carpentry',
  // Painting
  'painting-interior': 'painting',
  'painting-exterior': 'painting',
  'painting-rental': 'painting',
  'painting-waterproofing': 'painting',
  // Beauty
  'beauty-services': 'beauty_services',
  'womens-beauty': 'beauty_services',
  'womens-hair': 'beauty_services',
  'mens-grooming': 'beauty_services',
  // Delivery / logistics
  delivery: 'delivery_logistics',
  'pick-drop': 'delivery_logistics',
  'delivery-pickup-services': 'delivery_logistics',
  'delivery-logistics': 'delivery_logistics',
  // Driving
  'driver-chauffeur': 'driving',
  // Daily labour
  'daily-labour': 'daily-labour',
  // Hourly / personal
  'hourly-helper': 'cleaning',
  'personal-assistance': 'professional_services',
  'daily-help': 'cleaning',
  // Packers & movers
  'packers-movers': 'packers-movers',
  // Massage / spa
  massage: 'care_services',
  'massage-spa': 'care_services',
  // Pet services
  'pet-services': 'pet_services',
};

export function resolvePartnerCategoryId(categorySlug: string): string {
  const key = String(categorySlug || '').trim().toLowerCase();
  if (CATALOG_SLUG_TO_PARTNER_CATEGORY_ID[key]) {
    return CATALOG_SLUG_TO_PARTNER_CATEGORY_ID[key];
  }
  // Prefix-based fallbacks
  if (key.startsWith('electrician')) return 'electrician';
  if (key.startsWith('plumbing')) return 'plumbing';
  if (key.startsWith('carpentry')) return 'carpentry';
  if (key.startsWith('ac-')) return 'ac_service';
  if (key.startsWith('appliance')) return 'appliance_repair';
  if (key.startsWith('pest-control')) return 'pest_control';
  if (key.startsWith('painting')) return 'painting';
  if (key.startsWith('car-wash')) return 'car_wash';
  if (key.startsWith('laundry')) return 'laundry';
  if (key.startsWith('beauty') || key.startsWith('womens') || key.startsWith('mens-groom')) return 'beauty_services';
  if (key.startsWith('delivery') || key.startsWith('pick')) return 'delivery_logistics';
  if (
    key === 'full-house' ||
    key.startsWith('cleaning') ||
    key === 'bathroom' ||
    key === 'kitchen' ||
    key === 'sofa' ||
    key === 'mattress' ||
    key === 'window-glass'
  ) return 'cleaning';
  return '';
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
