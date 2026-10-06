import { HOURLY_HELPER_PARTNER_CATEGORIES } from '../constants/hourlyBooking';

/** City/state/country-level names and address nicknames — never a service area. */
const NON_AREA_NAMES = new Set([
  'hyderabad',
  'greater hyderabad',
  'ghmc',
  'telangana',
  'india',
  'andhra pradesh',
  'rangareddy',
  'ranga reddy',
  'medchal',
  'medchal malkajgiri',
  'sangareddy',
  'home',
  'work',
  'other',
  'office',
  'default',
  'selected location',
  'current location',
]);

/** Same place, different spelling only. Keys/values are canonical names. */
const AREA_SPELLING_ALIASES: Record<string, string> = {
  'hitech city': 'hitec city',
  'hi tech city': 'hitec city',
  'l b nagar': 'lb nagar',
};

/**
 * Canonical service-area name for exact matching.
 * "Serilingampalle (M)" → "serilingampally", "moti-nagar" → "moti nagar".
 */
export function canonicalServiceAreaName(value: unknown): string {
  const base = String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (!base) return '';
  const spelled = base.replace(/pall[ei]\b/g, 'pally');
  return AREA_SPELLING_ALIASES[spelled] ?? spelled;
}

export type HourlyServiceAddressInput = {
  area?: string | null;
  city?: string | null;
  state?: string | null;
  /** Full formatted address (comma-separated). */
  address?: string | null;
};

/**
 * Named areas the customer's address belongs to: explicit area, city and the
 * named parts of the formatted address. Door numbers, plus codes, pincodes and
 * city/state/country names are excluded. No coordinate snapping.
 */
export function buildHourlyServiceAreaCandidates(input: HourlyServiceAddressInput): string[] {
  const excluded = new Set(NON_AREA_NAMES);
  const state = canonicalServiceAreaName(input.state);
  if (state) excluded.add(state);

  const candidates: string[] = [];
  const add = (raw: unknown) => {
    const name = canonicalServiceAreaName(raw);
    if (!name || name.length < 3 || excluded.has(name) || candidates.includes(name)) return;
    candidates.push(name);
  };

  add(input.area);
  add(input.city);
  for (const token of String(input.address || '').split(',')) {
    const part = token.trim();
    if (!part || part.includes('+') || /\d/.test(part)) continue;
    add(part);
  }
  return candidates;
}

/** First partner work area that exactly equals one of the customer's area candidates. */
export function matchWorkAreaToServiceAreaCandidates(
  workAreas: unknown,
  candidates: readonly string[],
): string | null {
  if (!Array.isArray(workAreas) || candidates.length === 0) return null;
  for (const workArea of workAreas) {
    const name = canonicalServiceAreaName(workArea);
    if (name && candidates.includes(name)) return name;
  }
  return null;
}

export function partnerHasHourlyHelperCategory(categories: unknown): boolean {
  if (!Array.isArray(categories)) return false;
  return categories.some((entry) => {
    const raw =
      entry && typeof entry === 'object'
        ? (entry as Record<string, unknown>).id ??
          (entry as Record<string, unknown>).slug ??
          (entry as Record<string, unknown>).category ??
          (entry as Record<string, unknown>).value
        : entry;
    return HOURLY_HELPER_PARTNER_CATEGORIES.includes(String(raw ?? '').trim().toLowerCase());
  });
}

export function resolvePartnerWorkAreas(profile: Record<string, unknown>): unknown[] {
  const partnerProfile = (profile.partnerProfile as Record<string, unknown> | undefined) || {};
  if (Array.isArray(partnerProfile.workAreas) && partnerProfile.workAreas.length > 0) {
    return partnerProfile.workAreas;
  }
  return Array.isArray(profile.helperWorkAreas) ? profile.helperWorkAreas : [];
}
