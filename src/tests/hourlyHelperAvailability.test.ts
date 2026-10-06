import assert from 'node:assert/strict';
import {
  isEligibleHourlyHelperProfile,
  matchEligibleHourlyHelperArea,
  workAreasMatchExactArea,
} from '../services/HourlyHelperAvailabilityService';
import {
  buildHourlyServiceAreaCandidates,
  canonicalServiceAreaName,
  partnerHasHourlyHelperCategory,
} from '../utils/hourlyHelperServiceArea';

function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    roles: ['tasker'],
    isActive: true,
    isAvailable: true,
    partnerProfile: {
      status: 'approved',
      categories: ['cleaning'],
      workAreas: ['Uppal'],
      onLeave: false,
    },
    ...overrides,
  };
}

function withPartnerProfile(patch: Record<string, unknown>): Record<string, unknown> {
  return profile({ partnerProfile: { ...(profile().partnerProfile as object), ...patch } });
}

assert.equal(workAreasMatchExactArea(['Uppal'], 'Uppal'), true);
assert.equal(workAreasMatchExactArea(['Uppal'], 'Dilsukhnagar'), false);
assert.equal(workAreasMatchExactArea(['uppal'], 'UPPAL'), true);
assert.equal(workAreasMatchExactArea(['moti-nagar'], 'Moti Nagar'), true);
assert.equal(workAreasMatchExactArea(['Lingampally'], 'Serilingampally'), false);

assert.equal(isEligibleHourlyHelperProfile(profile(), 'Uppal'), true);
assert.equal(isEligibleHourlyHelperProfile(profile(), 'Dilsukhnagar'), false);
assert.equal(isEligibleHourlyHelperProfile(profile({ isActive: false }), 'Uppal'), false);
assert.equal(isEligibleHourlyHelperProfile(withPartnerProfile({ status: 'pending_review' }), 'Uppal'), false);
assert.equal(isEligibleHourlyHelperProfile(withPartnerProfile({ onLeave: true }), 'Uppal'), false);
assert.equal(isEligibleHourlyHelperProfile(profile({ isAvailable: false }), 'Uppal'), false);
assert.equal(
  isEligibleHourlyHelperProfile(
    profile({ helperWorkAreas: ['Uppal'], partnerProfile: { ...(profile().partnerProfile as object), workAreas: [] } }),
    'Uppal',
  ),
  true,
);

// Only the helper-app "Cleaning" category qualifies as Hourly Helper.
assert.equal(partnerHasHourlyHelperCategory(['cleaning']), true);
assert.equal(partnerHasHourlyHelperCategory([' Cleaning ']), true);
assert.equal(partnerHasHourlyHelperCategory([{ id: 'cleaning' }]), true);
assert.equal(partnerHasHourlyHelperCategory(['home_services']), false);
assert.equal(partnerHasHourlyHelperCategory(['pest_control', 'painting']), false);
assert.equal(partnerHasHourlyHelperCategory(['other', 'hourly-helper']), false);
assert.equal(isEligibleHourlyHelperProfile(withPartnerProfile({ categories: ['home_services'] }), 'Uppal'), false);
assert.equal(isEligibleHourlyHelperProfile(withPartnerProfile({ categories: ['pest_control'] }), 'Uppal'), false);
assert.equal(isEligibleHourlyHelperProfile(withPartnerProfile({ categories: ['electrician', 'cleaning'] }), 'Uppal'), true);

// Spelling aliases (same place only).
assert.equal(canonicalServiceAreaName('Serilingampalle (M)'), 'serilingampally');
assert.equal(canonicalServiceAreaName('Serilingampalli'), 'serilingampally');
assert.equal(canonicalServiceAreaName('Hi-Tech City'), 'hitec city');
assert.equal(canonicalServiceAreaName('L.B. Nagar'), 'lb nagar');
assert.equal(canonicalServiceAreaName('lb-nagar'), 'lb nagar');

// Real Serilingampalle booking address: named areas only, no snapping to Gachibowli.
const serilingampalleCandidates = buildHourlyServiceAreaCandidates({
  city: 'Serilingampalle (M)',
  state: 'Telangana',
  address: 'F8CQ+258, Sri Maruthi Nagar Colony, Serilingampalle (M), Hyderabad, Telangana 500084, India',
});
assert.deepEqual(serilingampalleCandidates, ['serilingampally', 'sri maruthi nagar colony']);
const gachibowliCleaner = withPartnerProfile({ workAreas: ['gachibowli', 'kondapur', 'yousufguda'] });
assert.equal(matchEligibleHourlyHelperArea(gachibowliCleaner, serilingampalleCandidates), null);
const serilingampallyCleaner = withPartnerProfile({ workAreas: ['serilingampally'] });
assert.equal(matchEligibleHourlyHelperArea(serilingampallyCleaner, serilingampalleCandidates), 'serilingampally');
const serilingampallyPainter = withPartnerProfile({ categories: ['painting'], workAreas: ['serilingampally'] });
assert.equal(matchEligibleHourlyHelperArea(serilingampallyPainter, serilingampalleCandidates), null);

// City/state/country and nicknames are never service areas.
assert.deepEqual(
  buildHourlyServiceAreaCandidates({
    area: 'Home',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Flat 12, Brigade Citadel, Moti Nagar, Hyderabad, Telangana 500018, India',
  }),
  ['brigade citadel', 'moti nagar'],
);
assert.deepEqual(buildHourlyServiceAreaCandidates({ city: 'Hyderabad' }), []);
assert.equal(
  matchEligibleHourlyHelperArea(
    withPartnerProfile({ workAreas: ['Central Hyderabad', 'Hyderabad'] }),
    buildHourlyServiceAreaCandidates({ city: 'Hyderabad', address: 'Uppal, Hyderabad, Telangana 500039, India' }),
  ),
  null,
);

console.log('hourlyHelperAvailability.test.ts passed');
