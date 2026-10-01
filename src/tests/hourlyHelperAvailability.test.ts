import assert from 'node:assert/strict';
import {
  isEligibleHourlyHelperProfile,
  workAreasMatchExactArea,
} from '../services/HourlyHelperAvailabilityService';

function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    roles: ['tasker'],
    isActive: true,
    isAvailable: true,
    partnerProfile: {
      status: 'approved',
      categories: ['home_services'],
      workAreas: ['Uppal'],
      onLeave: false,
    },
    ...overrides,
  };
}

assert.equal(workAreasMatchExactArea(['Uppal'], 'Uppal'), true);
assert.equal(workAreasMatchExactArea(['Uppal'], 'Dilsukhnagar'), false);
assert.equal(workAreasMatchExactArea(['uppal'], 'UPPAL'), true);

assert.equal(isEligibleHourlyHelperProfile(profile(), 'Uppal'), true);
assert.equal(isEligibleHourlyHelperProfile(profile(), 'Dilsukhnagar'), false);
assert.equal(isEligibleHourlyHelperProfile(profile({ isActive: false }), 'Uppal'), false);
assert.equal(
  isEligibleHourlyHelperProfile(
    profile({ partnerProfile: { ...profile().partnerProfile as object, status: 'pending_review' } }),
    'Uppal',
  ),
  false,
);
assert.equal(
  isEligibleHourlyHelperProfile(
    profile({ partnerProfile: { ...profile().partnerProfile as object, onLeave: true } }),
    'Uppal',
  ),
  false,
);
assert.equal(
  isEligibleHourlyHelperProfile(
    profile({ partnerProfile: { ...profile().partnerProfile as object, categories: ['cleaning'] } }),
    'Uppal',
  ),
  true,
);
assert.equal(
  isEligibleHourlyHelperProfile(
    profile({
      helperWorkAreas: ['Uppal'],
      partnerProfile: { ...profile().partnerProfile as object, workAreas: [] },
    }),
    'Uppal',
  ),
  true,
);

console.log('hourlyHelperAvailability.test.ts passed');
