import mongoose from 'mongoose';
import { partnerCategoryMatchesBookNowTask } from './partnerVisibility';

const HOURLY_TASK_HINTS = {
  category: 'other',
  categorySlug: 'hourly-helper',
  categoryLabel: 'Hourly Helper',
  budget: { type: 'hourly' },
} as const;

export type HourlyHelperAvailabilityResult = {
  available: boolean;
  eligibleHelperCount: number;
  area: string;
};

function normalizeArea(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
}

export function workAreasMatchExactArea(
  workAreas: unknown,
  selectedArea: string,
): boolean {
  const selected = normalizeArea(selectedArea);
  if (!selected || !Array.isArray(workAreas)) return false;

  return workAreas.some((workArea) => normalizeArea(workArea) === selected);
}

export function isEligibleHourlyHelperProfile(
  profile: Record<string, unknown>,
  selectedArea: string,
): boolean {
  if (profile.isActive !== true) return false;

  const partnerProfile =
    (profile.partnerProfile as Record<string, unknown> | undefined) || {};
  if (partnerProfile.status !== 'approved') return false;
  if (partnerProfile.onLeave === true) return false;
  if (profile.isAvailable === false) return false;

  const roles = Array.isArray(profile.roles)
    ? profile.roles.map((role) => String(role).trim().toLowerCase())
    : [];
  if (roles.length > 0 && !roles.some((role) => ['tasker', 'both', 'helper'].includes(role))) {
    return false;
  }

  const categories = Array.isArray(partnerProfile.categories)
    ? partnerProfile.categories
    : [];
  if (!partnerCategoryMatchesBookNowTask(categories, HOURLY_TASK_HINTS)) {
    return false;
  }

  const workAreas =
    Array.isArray(partnerProfile.workAreas) && partnerProfile.workAreas.length > 0
      ? partnerProfile.workAreas
      : profile.helperWorkAreas;
  return workAreasMatchExactArea(workAreas, selectedArea);
}

export class HourlyHelperAvailabilityService {
  static async getExactAreaAvailability(
    area: string,
  ): Promise<HourlyHelperAvailabilityResult> {
    const normalizedArea = String(area || '').trim();
    if (!normalizedArea) {
      return { available: false, eligibleHelperCount: 0, area: '' };
    }

    const profiles = await mongoose.connection
      .collection('profiles')
      .find(
        {
          isActive: true,
          'partnerProfile.status': 'approved',
        },
        {
          projection: {
            roles: 1,
            isActive: 1,
            isAvailable: 1,
            partnerProfile: 1,
            helperWorkAreas: 1,
          },
        },
      )
      .toArray();

    const eligibleHelperCount = profiles.filter((profile) =>
      isEligibleHourlyHelperProfile(profile as Record<string, unknown>, normalizedArea),
    ).length;

    return {
      available: eligibleHelperCount > 0,
      eligibleHelperCount,
      area: normalizedArea,
    };
  }
}
