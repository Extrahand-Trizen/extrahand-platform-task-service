import mongoose from 'mongoose';
import { HOURLY_HELPER_PARTNER_CATEGORIES } from '../constants/hourlyBooking';
import {
  buildHourlyServiceAreaCandidates,
  canonicalServiceAreaName,
  matchWorkAreaToServiceAreaCandidates,
  partnerHasHourlyHelperCategory,
  resolvePartnerWorkAreas,
  type HourlyServiceAddressInput,
} from '../utils/hourlyHelperServiceArea';
import { HourlyHelperLocationAvailabilityService } from './HourlyHelperLocationAvailabilityService';

export type HourlyHelperAvailabilityResult = {
  available: boolean;
  eligibleHelperCount?: number;
  area: string;
  candidates: string[];
  matchedAreas: string[];
};

export type EligibleHourlyHelper = {
  uid: string;
  matchedArea: string;
  workShifts: string[];
  gender?: string;
};

export function workAreasMatchExactArea(
  workAreas: unknown,
  selectedArea: string,
): boolean {
  const selected = canonicalServiceAreaName(selectedArea);
  if (!selected) return false;
  return matchWorkAreaToServiceAreaCandidates(workAreas, [selected]) !== null;
}

/** Returns the matched work area when the profile is an eligible Hourly Helper for these areas. */
export function matchEligibleHourlyHelperArea(
  profile: Record<string, unknown>,
  areaCandidates: readonly string[],
): string | null {
  if (profile.isActive !== true) return null;

  const partnerProfile =
    (profile.partnerProfile as Record<string, unknown> | undefined) || {};
  if (partnerProfile.status !== 'approved') return null;
  if (partnerProfile.onLeave === true) return null;
  if (profile.isAvailable === false) return null;

  const roles = Array.isArray(profile.roles)
    ? profile.roles.map((role) => String(role).trim().toLowerCase())
    : [];
  if (roles.length > 0 && !roles.some((role) => ['tasker', 'both', 'helper'].includes(role))) {
    return null;
  }

  if (!partnerHasHourlyHelperCategory(partnerProfile.categories)) return null;

  return matchWorkAreaToServiceAreaCandidates(resolvePartnerWorkAreas(profile), areaCandidates);
}

export function isEligibleHourlyHelperProfile(
  profile: Record<string, unknown>,
  selectedArea: string | readonly string[],
): boolean {
  const candidates = (Array.isArray(selectedArea) ? selectedArea : [selectedArea])
    .map((area) => canonicalServiceAreaName(area))
    .filter(Boolean);
  return matchEligibleHourlyHelperArea(profile, candidates) !== null;
}

const AVAILABILITY_CACHE_MS = 10_000;
const availabilityCache = new Map<string, { available: boolean; expiresAt: number }>();
const pendingAvailability = new Map<string, Promise<boolean>>();
const ELIGIBLE_HELPERS_CACHE_MS = 10_000;
const eligibleHelpersCache = new Map<
  string,
  { helpers: EligibleHourlyHelper[]; expiresAt: number }
>();
const pendingEligibleHelpers = new Map<string, Promise<EligibleHourlyHelper[]>>();

export function buildHourlyHelperAreaQueryRegex(area: string): RegExp {
  const canonical = canonicalServiceAreaName(area);
  const escaped = canonical
    .split('')
    .map((character) => /[a-z0-9]/.test(character) ? character : '[\\s._-]*')
    .join('');
  const spellingVariant = escaped.replace(/pally$/, 'pall[eyi]');
  return new RegExp(`^${spellingVariant}(?:\\s*\\([^)]*\\))?$`, 'i');
}

export class HourlyHelperAvailabilityService {
  static async hasEligibleHelper(areaCandidates: readonly string[]): Promise<boolean> {
    const candidates = Array.from(
      new Set(areaCandidates.map((area) => canonicalServiceAreaName(area)).filter(Boolean)),
    );
    if (candidates.length === 0) return false;

    const cacheKey = candidates.slice().sort().join('|');
    const cached = availabilityCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.available;
    const pending = pendingAvailability.get(cacheKey);
    if (pending) return pending;

    const areaPatterns = candidates.map(buildHourlyHelperAreaQueryRegex);
    const categoryFilters = HOURLY_HELPER_PARTNER_CATEGORIES.flatMap((category) => [
      { 'partnerProfile.categories': category },
      { 'partnerProfile.categories.id': category },
      { 'partnerProfile.categories.slug': category },
      { 'partnerProfile.categories.category': category },
      { 'partnerProfile.categories.value': category },
    ]);

    const check = (async () => {
      const cursor = mongoose.connection.collection('profiles').find(
        {
        isActive: true,
        'partnerProfile.status': 'approved',
        'partnerProfile.onLeave': { $ne: true },
        isAvailable: { $ne: false },
        $and: [
          {
            $or: [
              { 'partnerProfile.workAreas': { $in: areaPatterns } },
              { helperWorkAreas: { $in: areaPatterns } },
            ],
          },
          { $or: categoryFilters },
        ],
      },
      {
        projection: {
          uid: 1,
          roles: 1,
          isActive: 1,
          isAvailable: 1,
          partnerProfile: 1,
          helperWorkAreas: 1,
        },
      },
      );
      let available = false;
      try {
        for await (const profile of cursor) {
          if (matchEligibleHourlyHelperArea(profile as Record<string, unknown>, candidates)) {
            available = true;
            break;
          }
        }
      } finally {
        await cursor.close();
      }

      availabilityCache.set(cacheKey, {
        available,
        expiresAt: Date.now() + AVAILABILITY_CACHE_MS,
      });
      return available;
    })().finally(() => {
      pendingAvailability.delete(cacheKey);
    });

    pendingAvailability.set(cacheKey, check);
    return check;
  }

  static async countEligibleHelpersByArea(
    areaNames: readonly string[],
  ): Promise<Map<string, number>> {
    const uniqueAreaNames = Array.from(new Set(areaNames.map((name) => canonicalServiceAreaName(name)).filter(Boolean)));
    const counts = new Map(uniqueAreaNames.map((name) => [name, 0]));
    if (uniqueAreaNames.length === 0) return counts;

    const profiles = await mongoose.connection
      .collection('profiles')
      .find(
        {
          isActive: true,
          'partnerProfile.status': 'approved',
        },
        {
          projection: {
            uid: 1,
            roles: 1,
            isActive: 1,
            isAvailable: 1,
            partnerProfile: 1,
            helperWorkAreas: 1,
          },
        },
      )
      .toArray();

    for (const profile of profiles) {
      const record = profile as Record<string, unknown>;
      if (!String(record.uid || '').trim()) continue;
      for (const areaName of uniqueAreaNames) {
        if (matchEligibleHourlyHelperArea(record, [areaName])) {
          counts.set(areaName, (counts.get(areaName) || 0) + 1);
        }
      }
    }
    return counts;
  }

  static async findEligibleHelpers(
    areaCandidates: readonly string[],
  ): Promise<EligibleHourlyHelper[]> {
    const candidates = Array.from(
      new Set(areaCandidates.map((area) => canonicalServiceAreaName(area)).filter(Boolean)),
    );
    if (candidates.length === 0) return [];

    const cacheKey = candidates.slice().sort().join('|');
    const cached = eligibleHelpersCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.helpers;
    const pending = pendingEligibleHelpers.get(cacheKey);
    if (pending) return pending;

    const lookup = this.loadEligibleHelpers(candidates)
      .then((helpers) => {
        const now = Date.now();
        for (const [key, value] of eligibleHelpersCache) {
          if (value.expiresAt <= now) eligibleHelpersCache.delete(key);
        }
        if (eligibleHelpersCache.size >= 500) {
          const oldestKey = eligibleHelpersCache.keys().next().value;
          if (oldestKey) eligibleHelpersCache.delete(oldestKey);
        }
        eligibleHelpersCache.set(cacheKey, {
          helpers,
          expiresAt: now + ELIGIBLE_HELPERS_CACHE_MS,
        });
        return helpers;
      })
      .finally(() => {
        pendingEligibleHelpers.delete(cacheKey);
      });
    pendingEligibleHelpers.set(cacheKey, lookup);
    return lookup;
  }

  private static async loadEligibleHelpers(
    candidates: readonly string[],
  ): Promise<EligibleHourlyHelper[]> {
    const areaPatterns = candidates.map(buildHourlyHelperAreaQueryRegex);
    const categoryFilters = HOURLY_HELPER_PARTNER_CATEGORIES.flatMap((category) => [
      { 'partnerProfile.categories': category },
      { 'partnerProfile.categories.id': category },
      { 'partnerProfile.categories.slug': category },
      { 'partnerProfile.categories.category': category },
      { 'partnerProfile.categories.value': category },
    ]);

    const profiles = await mongoose.connection
      .collection('profiles')
      .find(
        {
          isActive: true,
          'partnerProfile.status': 'approved',
          'partnerProfile.onLeave': { $ne: true },
          isAvailable: { $ne: false },
          $and: [
            {
              $or: [
                { 'partnerProfile.workAreas': { $in: areaPatterns } },
                { helperWorkAreas: { $in: areaPatterns } },
              ],
            },
            { $or: categoryFilters },
          ],
        },
        {
          projection: {
            uid: 1,
            roles: 1,
            isActive: 1,
            isAvailable: 1,
            'partnerProfile.status': 1,
            'partnerProfile.onLeave': 1,
            'partnerProfile.categories': 1,
            'partnerProfile.workAreas': 1,
            'partnerProfile.workShifts': 1,
            'partnerProfile.gender': 1,
            gender: 1,
            helperWorkAreas: 1,
          },
        },
      )
      .toArray();

    const eligible: EligibleHourlyHelper[] = [];
    for (const profile of profiles) {
      const record = profile as Record<string, unknown>;
      const uid = String(record.uid || '').trim();
      if (!uid) continue;
      const matchedArea = matchEligibleHourlyHelperArea(record, candidates);
      if (matchedArea) {
        const partnerProfile = (record.partnerProfile as Record<string, unknown>) || {};
        eligible.push({
          uid,
          matchedArea,
          workShifts: Array.isArray(partnerProfile.workShifts)
            ? partnerProfile.workShifts.map(String)
            : [],
          gender: String(record.gender ?? partnerProfile.gender ?? '').trim() || undefined,
        });
      }
    }
    return eligible;
  }

  static async getAvailabilityForCandidates(
    candidates: string[],
  ): Promise<HourlyHelperAvailabilityResult> {
    const helpers = await HourlyHelperAvailabilityService.findEligibleHelpers(candidates);
    const matchedAreas = Array.from(new Set(helpers.map((helper) => helper.matchedArea)));
    return {
      available: helpers.length > 0,
      eligibleHelperCount: helpers.length,
      area: matchedAreas[0] || candidates[0] || '',
      candidates,
      matchedAreas,
    };
  }

  /** Availability for the customer's own address (named areas only, no radius). */
  static async getAvailabilityForAddress(
    input: HourlyServiceAddressInput,
    options: { fastAvailabilityCheck?: boolean } = {},
  ): Promise<HourlyHelperAvailabilityResult> {
    const [isEnabled, slotSettings] = await Promise.all([
      HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
        areaName: input.area || undefined,
        cityName: input.city || undefined,
        stateName: input.state || undefined,
        address: input.address || undefined,
      }),
      HourlyHelperLocationAvailabilityService.getSlotSettingsForAddress({
        areaName: input.area || undefined,
        cityName: input.city || undefined,
        stateName: input.state || undefined,
        address: input.address || undefined,
      }),
    ]);
    if (!isEnabled) {
      return {
        available: false,
        eligibleHelperCount: 0,
        area: input.area || input.address || '',
        candidates: buildHourlyServiceAreaCandidates(input),
        matchedAreas: [],
      };
    }
    const candidates = buildHourlyServiceAreaCandidates(input);
    if (slotSettings.mode === 'managed_schedule') {
      return {
        available: true,
        eligibleHelperCount: 0,
        area: input.area || input.address || candidates[0] || '',
        candidates,
        matchedAreas: [],
      };
    }
    if (options.fastAvailabilityCheck) {
      const available = await HourlyHelperAvailabilityService.hasEligibleHelper(candidates);
      return {
        available,
        area: candidates[0] || input.area || input.address || '',
        candidates,
        matchedAreas: available ? [candidates[0]] : [],
      };
    }
    const helpers = await HourlyHelperAvailabilityService.findEligibleHelpers(candidates);
    const matchedAreas = Array.from(new Set(helpers.map((helper) => helper.matchedArea)));
    return {
      available: true,
      eligibleHelperCount: helpers.length,
      area: matchedAreas[0] || input.area || input.address || candidates[0] || '',
      candidates,
      matchedAreas,
    };
  }

  /** Legacy clients that only send a single area name. */
  static async getExactAreaAvailability(
    area: string,
  ): Promise<HourlyHelperAvailabilityResult> {
    return HourlyHelperAvailabilityService.getAvailabilityForAddress({ area });
  }
}
