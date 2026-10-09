import mongoose from 'mongoose';
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
  eligibleHelperCount: number;
  area: string;
  candidates: string[];
  matchedAreas: string[];
};

export type EligibleHourlyHelper = {
  uid: string;
  matchedArea: string;
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

export class HourlyHelperAvailabilityService {
  static async findEligibleHelpers(
    areaCandidates: readonly string[],
  ): Promise<EligibleHourlyHelper[]> {
    if (areaCandidates.length === 0) return [];

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

    const eligible: EligibleHourlyHelper[] = [];
    for (const profile of profiles) {
      const record = profile as Record<string, unknown>;
      const uid = String(record.uid || '').trim();
      if (!uid) continue;
      const matchedArea = matchEligibleHourlyHelperArea(record, areaCandidates);
      if (matchedArea) eligible.push({ uid, matchedArea });
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
  ): Promise<HourlyHelperAvailabilityResult> {
    const isEnabled = await HourlyHelperLocationAvailabilityService.isHourlyHelperEnabledForAddress({
      areaName: input.area || undefined,
      cityName: input.city || undefined,
    });
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
