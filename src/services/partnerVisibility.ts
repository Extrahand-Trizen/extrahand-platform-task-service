import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { normalizeLocationName } from '../constants/locations/isHardcodedSupportedLocation';
import {
  BOOK_NOW_WORK_AREA_PROXIMITY_KM,
  HYDERABAD_WORK_AREA_COORDS,
} from '../constants/locations/hyderabadWorkAreaCoords';

/**
 * Shared server-side visibility guard for partner-facing Book Now queries.
 *
 * A Book Now job may only ever be returned to a partner when BOTH conditions
 * hold:
 *   1. Category match  — the job's service category equals one of the
 *      partner's registered/approved service categories
 *      (partnerProfile.categories).
 *   2. Work area match — the job's locality (location.taskArea/locality /
 *      city mentioned in the address) equals one of the partner's selected
 *      work areas (partnerProfile.workAreas).
 *
 * These builders produce Mongo query fragments so the restriction is enforced
 * at the query level — no partner can receive a job they don't qualify for,
 * even by calling the API directly.
 */

/**
 * Maps category aliases to canonical category names so queries are robust
 * even when the task was created with a different slug variant.
 */
const CATEGORY_MAP: Record<string, string[]> = {
  cleaning: ['cleaning', 'home-cleaning', 'home_cleaning'],
  repair: [
    'repair',
    'plumbing',
    'electrical',
    'electrician',
    'carpenter',
    'carpentry',
    'ac-service',
    'ac-services',
    'ac-repair',
    'appliance-repair',
    'appliance-repair-services',
  ],
  plumbing: ['plumbing', 'repair'],
  electrical: ['electrical', 'electrician', 'repair'],
  electrician: ['electrician', 'electrical', 'repair'],
  delivery: ['delivery', 'pickup', 'pick-drop'],
  assembly: ['assembly', 'furniture-assembly'],
  gardening: ['gardening', 'lawn-mowing'],
  petcare: ['petcare', 'pet-care'],
  'packers-movers': ['packers-movers', 'moving'],
  beautician: ['beautician', 'beauty', 'beauty-services', 'salon'],
  driver: ['driver', 'chauffeur', 'driving'],
  'home-cleaning': ['cleaning', 'home-cleaning'],
  'pest-control': ['pest-control'],
  'beauty-services': ['beauty-services', 'beauty', 'beautician', 'salon'],
};

export function normalizeCategory(input: string): string {
  const lower = input.toLowerCase().replace(/[\s_-]+/g, '-');
  for (const [canonical, aliases] of Object.entries(CATEGORY_MAP)) {
    if (aliases.includes(lower) || canonical === lower) return canonical;
  }
  return lower;
}

function normalizePartnerCategoryValue(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const id = obj.id ?? obj.slug ?? obj.category ?? obj.value;
    if (id != null && String(id).trim()) {
      return normalizeCategory(String(id));
    }
  }
  return normalizeCategory(String(raw || ''));
}

export function normalizePartnerCategorySlug(raw: unknown): string {
  return normalizePartnerCategoryValue(raw);
}

export function normalizePartnerCategoryList(categories: unknown[]): string[] {
  if (!Array.isArray(categories)) return [];
  return categories.map((entry) => normalizePartnerCategoryValue(entry)).filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every Task.category enum value a Book Now task can carry. */
const ALL_BOOK_NOW_TASK_CATEGORIES = [
  'cleaning',
  'repair',
  'delivery',
  'assembly',
  'gardening',
  'petcare',
  'packers-movers',
  'other',
];

/**
 * Maps partner-registered service categories (supply-onboarding wizard group
 * ids, admin onboarding values, legacy umbrella ids) to the Task.category
 * enum values Book Now tasks actually use. Keys are normalized (lowercase,
 * dash-separated).
 */
const PARTNER_CATEGORY_TO_TASK_CATEGORIES: Record<string, string[]> = {
  // Broad "all home services" umbrella (admin / legacy onboarding).
  'home-services': ALL_BOOK_NOW_TASK_CATEGORIES,
  'home_services': ALL_BOOK_NOW_TASK_CATEGORIES,
  handyperson: ALL_BOOK_NOW_TASK_CATEGORIES,
  handyman: ALL_BOOK_NOW_TASK_CATEGORIES,
  // Cleaning family.
  cleaning: ['cleaning'],
  'home-cleaning': ['cleaning'],
  // Repair family (plumbing / electrical / carpentry / AC / appliance).
  repair: ['repair'],
  plumbing: ['repair'],
  electrical: ['repair'],
  electrician: ['repair'],
  appliance_repair: ['repair'],
  'appliance-repair-services': ['repair'],
  ac_service: ['repair'],
  'ac-services': ['repair'],
  carpenter: ['repair'],
  carpentry: ['repair'],
  'ac-service': ['repair'],
  'ac-repair': ['repair'],
  'appliance-repair': ['repair'],
  // Delivery / driving family.
  delivery: ['delivery'],
  'delivery-logistics': ['delivery'],
  driving: ['delivery'],
  // Assembly family.
  assembly: ['assembly'],
  'assembly-services': ['assembly'],
  'furniture-assembly': ['assembly'],
  // Gardening family.
  gardening: ['gardening'],
  // Pet care family.
  petcare: ['petcare'],
  'pet-care': ['petcare'],
  'pet-services': ['petcare'],
  // Packers & movers family.
  'packers-movers': ['packers-movers'],
  moving: ['packers-movers'],
  // Remaining Book Now catalog services fall under Task.category 'other'.
  other: ['other'],
  painting: ['other'],
  'interior-painting': ['other'],
  'exterior-painting': ['other'],
  'rental-painting': ['other'],
  waterproofing: ['other'],
  'painting-interior': ['other'],
  'painting-exterior': ['other'],
  'painting-rental': ['other'],
  'painting-waterproofing': ['other'],
  'pest-control': ['other'],
  'pest_control': ['other'],
  'beauty-services': ['other'],
  beauty: ['other'],
  beautician: ['other'],
  salon: ['other'],
  'care-services': ['other'],
  'professional-services': ['other'],
  'event-services': ['other'],
};

const PAINTING_SUPPLY_CATEGORY_SLUGS = new Set([
  'painting',
  'interior-painting',
  'exterior-painting',
  'rental-painting',
  'waterproofing',
  'painting-interior',
  'painting-exterior',
  'painting-rental',
  'painting-waterproofing',
]);

function partnerHasPaintingSupplyCategory(normalizedPartnerCategories: string[]): boolean {
  return normalizedPartnerCategories.some(
    (cat) =>
      PAINTING_SUPPLY_CATEGORY_SLUGS.has(cat) ||
      cat.includes('painting') ||
      cat === 'waterproofing',
  );
}

export function partnerCategoryMatchesBookNowTask(
  partnerCategories: unknown[],
  task: {
    category?: string;
    categorySlug?: string;
    categoryLabel?: string;
    subcategory?: string;
    serviceType?: string;
    serviceFlowType?: string;
    bookingKind?: string;
  },
): boolean {
  const normalized = normalizePartnerCategoryList(partnerCategories);
  if (!normalized.length) return false;

  const taskCategory = String(task.category || '').trim().toLowerCase();
  const taskSlug = normalizeCategory(String(task.categorySlug || ''));
  const taskLabel = normalizeCategory(String(task.categoryLabel || ''));
  const taskSubcategory = String(task.subcategory || '').trim().toLowerCase();
  const taskServiceType = String(task.serviceType || '').trim().toLowerCase();
  const taskFlowType = String(task.serviceFlowType || '').trim();
  const taskBookingKind = String(task.bookingKind || '').trim().toLowerCase();

  const taskCategories = new Set<string>();
  normalized.forEach((cat) => {
    const mapped = PARTNER_CATEGORY_TO_TASK_CATEGORIES[cat];
    if (mapped) mapped.forEach((tc) => taskCategories.add(tc));
    else taskCategories.add(cat);
  });

  if (taskCategory && taskCategories.has(taskCategory)) return true;
  if (taskSlug && normalized.includes(taskSlug)) return true;
  if (taskLabel && normalized.includes(taskLabel)) return true;

  if (partnerHasPaintingSupplyCategory(normalized)) {
    if (taskServiceType === 'painting') return true;
    if (
      taskFlowType === 'consultation_project' &&
      (taskBookingKind === 'consultation' || taskBookingKind === 'project')
    ) {
      return true;
    }
    if (PAINTING_SUPPLY_CATEGORY_SLUGS.has(taskSlug)) return true;
    if (taskSubcategory.startsWith('painting-consultation-')) return true;
    if (taskSubcategory.startsWith('consultation-project-')) return true;
  }

  return normalized.some((partnerCat) => {
    const partnerKey = partnerCat.replace(/[\s_-]+/g, '');
    const slugKey = taskSlug.replace(/[\s_-]+/g, '');
    const labelKey = taskLabel.replace(/[\s_-]+/g, '');
    const subKey = taskSubcategory.replace(/[\s_-]+/g, '');
    return (
      (slugKey && (slugKey === partnerKey || slugKey.includes(partnerKey) || partnerKey.includes(slugKey))) ||
      (labelKey && (labelKey === partnerKey || labelKey.includes(partnerKey) || partnerKey.includes(labelKey))) ||
      (subKey && (subKey.includes(partnerKey) || partnerKey.includes(subKey)))
    );
  });
}

/**
 * Builds the query condition "job service category equals one of the
 * partner's registered categories". The Task.category enum arm is the
 * authoritative one; the slug/label arms keep parity with tasks whose enum
 * was mis-stored. Returns null when the partner has no registered categories
 * (meaning the partner matches no jobs).
 */
export function buildPartnerCategoryFilter(
  partnerCategories: unknown[],
): Record<string, any> | null {
  const normalized = partnerCategories
    .map((c) => normalizePartnerCategoryValue(c))
    .filter(Boolean);

  if (!normalized.length) return null;

  const taskCategories = new Set<string>();
  normalized.forEach((cat) => {
    const mapped = PARTNER_CATEGORY_TO_TASK_CATEGORIES[cat];
    if (mapped) mapped.forEach((tc) => taskCategories.add(tc));
    else taskCategories.add(cat);
  });

  if (!taskCategories.size) return null;

  const orConditions: Record<string, unknown>[] = [
    { category: { $in: [...taskCategories] } },
    { categorySlug: { $in: normalized } },
    {
      categoryLabel: {
        $in: normalized.map((n) => new RegExp(`^${escapeRegExp(n)}$`, 'i')),
      },
    },
  ];

  if (partnerHasPaintingSupplyCategory(normalized)) {
    orConditions.push({ serviceType: 'painting' });
    orConditions.push({
      serviceFlowType: 'consultation_project',
      bookingKind: { $in: ['consultation', 'project'] },
    });
    orConditions.push({ categorySlug: { $in: [...PAINTING_SUPPLY_CATEGORY_SLUGS] } });
  }

  return { $or: orConditions };
}

/**
 * Builds the query condition "job locality equals one of the partner's
 * selected work areas".
 *
 * The job's locality is read from every locality-bearing location field
 * (`location.taskArea`, `location.locality`, `location.area`, `location.city`)
 * and from the free-text `location.address` (a job whose address mentions a
 * partner work area, e.g. "... Balaji Nagar Main Road, Secunderabad ...", is
 * located in that work area). Matching is layout-insensitive (hyphens /
 * underscores / spaces are equivalent) and case-insensitive, so a stored work
 * area id like `moti-nagar` matches a locality stored as "Moti Nagar".
 *
 * Returns null when the partner has no work areas (meaning the partner
 * matches no jobs).
 */
export function buildPartnerWorkAreaFilter(
  partnerWorkAreas: unknown[],
): Record<string, any> | null {
  const areas = partnerWorkAreas
    .map((area) => String(area || '').trim())
    .filter(Boolean);

  if (!areas.length) return null;

  const exactFieldConditions: Record<string, unknown>[] = [];
  const addressConditions: Record<string, unknown>[] = [];
  const geoConditions: Record<string, unknown>[] = [];
  const EARTH_RADIUS_KM = 6378.1;

  areas.forEach((area) => {
    const normalized = normalizeLocationName(area);
    if (!normalized) return;

    // Layout-insensitive exact match: "lb nagar" ↔ "LB Nagar" / "lb-nagar".
    const pattern = normalized
      .split(/\s+/)
      .map(escapeRegExp)
      .join('\\s*[-_\\s]+\\s*');
    if (pattern) {
      const eq = new RegExp(`^${pattern}$`, 'i');
      for (const field of ['location.taskArea', 'location.area', 'location.locality', 'location.city']) {
        exactFieldConditions.push({ [field]: eq });
      }
    }

    // Containment match against the free-text address: a job whose address
    // mentions the partner's work area is located in that work area even
    // when the taskArea extraction produced a finer-grained or empty value.
    const contained = normalized
      .split(/\s+/)
      .map(escapeRegExp)
      .join('[\\s_-]+');
    if (contained) {
      addressConditions.push({
        'location.address': new RegExp(`(^|[^a-z0-9])${contained}([^a-z0-9]|$)`, 'i'),
      });
    }

    // Geo proximity: align available-leads visibility with auto-assign's 6 km work-area radius.
    const coord = HYDERABAD_WORK_AREA_COORDS.find(
      (wa) => normalizeLocationName(wa.area) === normalized,
    );
    if (coord) {
      geoConditions.push({
        location: {
          $geoWithin: {
            $centerSphere: [
              [coord.lng, coord.lat],
              BOOK_NOW_WORK_AREA_PROXIMITY_KM / EARTH_RADIUS_KM,
            ],
          },
        },
      });
    }
  });

  const orConditions: Record<string, unknown>[] = [];
  if (exactFieldConditions.length) orConditions.push({ $or: exactFieldConditions });
  if (addressConditions.length) orConditions.push({ $or: addressConditions });
  if (geoConditions.length) orConditions.push({ $or: geoConditions });

  if (!orConditions.length) return null;

  // A match on any locality field satisfies the work-area condition.
  return { $or: orConditions };
}

/**
 * Resolves the requesting partner's registered service categories and
 * selected work areas from their profile. Strict — both conditions must
 * resolve to non-empty filters, otherwise the partner qualifies for no jobs.
 *
 * Returns null when the caller is not a resolvable partner (no profile, no
 * registered categories or no selected work areas) — callers must treat this
 * as "sees no Book Now jobs".
 */
export async function resolvePartnerMatchConditions(
  req: AuthenticatedRequest,
): Promise<{ category: Record<string, any>; workArea: Record<string, any> } | null> {
  // Gateway sends X-User-Id / X-Profile-Id. Auth middleware populates
  // req.user.uid and req.user.profileId from them.
  const uid = req.user?.uid || (req.headers['x-user-id'] as string | undefined);
  let profileId: mongoose.Types.ObjectId | undefined = req.user?.profileId;

  // If profileId wasn't resolved by auth middleware (gateway couldn't look it
  // up), fall back to querying the DB directly by uid.
  if (!profileId && uid) {
    const Profile = mongoose.connection.collection('profiles');
    const found = await Profile.findOne({ uid }, { projection: { _id: 1 } });
    if (found) {
      profileId = found._id as mongoose.Types.ObjectId;
    }
  }

  if (!profileId) return null;
  if (!mongoose.Types.ObjectId.isValid(String(profileId))) return null;

  const partnerOid =
    profileId instanceof mongoose.Types.ObjectId
      ? profileId
      : new mongoose.Types.ObjectId(profileId as string);

  const Profile = mongoose.connection.collection('profiles');
  const profile = await Profile.findOne(
    { _id: partnerOid },
    { projection: { partnerProfile: 1 } },
  );
  if (!profile) return null;

  const pp = (profile as Record<string, any>).partnerProfile as
    | { categories?: unknown; workAreas?: unknown }
    | undefined;

  const partnerCategories: unknown[] = Array.isArray(pp?.categories)
    ? pp.categories!
    : [];
  const partnerWorkAreas: unknown[] = Array.isArray(pp?.workAreas)
    ? pp.workAreas!
    : [];

  const category = buildPartnerCategoryFilter(partnerCategories);
  const workArea = buildPartnerWorkAreaFilter(partnerWorkAreas);

  // A partner without registered categories or without selected work areas
  // qualifies for no Book Now jobs.
  if (!category || !workArea) return null;

  return { category, workArea };
}

/**
 * Combine both conditions into a single Mongo filter fragment:
 * "category match AND work area match".
 */
export function buildPartnerVisibilityFilter(
  partnerMatch: { category: Record<string, any>; workArea: Record<string, any> },
): Record<string, any> {
  return { $and: [partnerMatch.category, partnerMatch.workArea] };
}
