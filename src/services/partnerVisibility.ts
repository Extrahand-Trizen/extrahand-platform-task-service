import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { normalizeLocationName } from '../constants/locations/isHardcodedSupportedLocation';

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
  repair: ['repair', 'plumbing', 'electrical', 'carpenter'],
  plumbing: ['plumbing', 'repair'],
  electrical: ['electrical', 'repair'],
  delivery: ['delivery', 'pickup', 'pick-drop'],
  assembly: ['assembly', 'furniture-assembly'],
  gardening: ['gardening', 'lawn-mowing'],
  petcare: ['petcare', 'pet-care'],
  'packers-movers': ['packers-movers', 'moving'],
  beautician: ['beautician', 'beauty', 'salon'],
  driver: ['driver', 'chauffeur', 'driving'],
  'home-cleaning': ['cleaning', 'home-cleaning'],
};

export function normalizeCategory(input: string): string {
  const lower = input.toLowerCase().replace(/[\s_-]+/g, '-');
  for (const [canonical, aliases] of Object.entries(CATEGORY_MAP)) {
    if (aliases.includes(lower) || canonical === lower) return canonical;
  }
  return lower;
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
  'pest-control': ['other'],
  'beauty-services': ['other'],
  'care-services': ['other'],
  'professional-services': ['other'],
  'event-services': ['other'],
};

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
    .map((c) => normalizeCategory(String(c || '')))
    .filter(Boolean);

  if (!normalized.length) return null;

  const taskCategories = new Set<string>();
  normalized.forEach((cat) => {
    const mapped = PARTNER_CATEGORY_TO_TASK_CATEGORIES[cat];
    if (mapped) mapped.forEach((tc) => taskCategories.add(tc));
    else taskCategories.add(cat);
  });

  if (!taskCategories.size) return null;

  return {
    $or: [
      { category: { $in: [...taskCategories] } },
      { categorySlug: { $in: normalized } },
      {
        categoryLabel: {
          $in: normalized.map((n) => new RegExp(`^${escapeRegExp(n)}$`, 'i')),
        },
      },
    ],
  };
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
  });

  const orConditions: Record<string, unknown>[] = [];
  if (exactFieldConditions.length) orConditions.push({ $or: exactFieldConditions });
  if (addressConditions.length) orConditions.push({ $or: addressConditions });

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