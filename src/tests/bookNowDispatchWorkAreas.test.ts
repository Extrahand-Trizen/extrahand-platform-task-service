import assert from 'node:assert/strict';
import {
  buildOrderedWorkAreasForDispatch,
  filterTeamPostedOfferTiers,
  filterTeamPostedRecipientUids,
  getBookNowNotificationTiers,
} from '../services/BookNowAutoAssignService';

const siddipetTask = {
  location: {
    taskArea: 'Shivaji Nagar',
    city: 'Siddipet',
    coordinates: [78.8525, 18.1018],
  },
} as any;

const siddipetAreas = buildOrderedWorkAreasForDispatch(siddipetTask);
assert.deepStrictEqual(
  siddipetAreas.map(({ area }) => area),
  ['Shivaji Nagar', 'Siddipet'],
  'Siddipet work should not expand into distant Hyderabad work areas',
);
assert.ok(
  !siddipetAreas.some(({ area }) => area === 'Secunderabad'),
  'Secunderabad partners must not be included for Siddipet work',
);

const hyderabadTask = {
  location: {
    taskArea: 'Gachibowli',
    city: 'Hyderabad',
    coordinates: [78.3489, 17.4401],
  },
} as any;
const hyderabadAreas = buildOrderedWorkAreasForDispatch(hyderabadTask);
assert.ok(hyderabadAreas.some(({ area }) => area === 'Gachibowli'));
assert.ok(
  hyderabadAreas.some(({ area }) => area === 'Madhapur'),
  'Nearby Hyderabad work areas should remain eligible',
);

const partner = (uid: string, phone: string) => ({
  uid,
  profileId: uid,
  name: uid,
  phone,
  distKm: 1,
  workArea: 'Gachibowli',
  workAreaDistKm: 0,
});
const teamTiers = {
  preferred: [partner('allowlisted-partner', '+91 99999 99999')],
  area_rule: [partner('other-area-partner', '8888888888')],
  all: [partner('other-eligible-partner', '7777777777')],
};
const teamNotificationTiers = filterTeamPostedOfferTiers(teamTiers, ['9999999999']);
assert.deepStrictEqual(
  teamNotificationTiers.preferred.map(({ uid }) => uid),
  ['allowlisted-partner'],
  'Team work should notify only partners whose phone matches the exclusions list',
);
assert.deepStrictEqual(teamNotificationTiers.area_rule, []);
assert.deepStrictEqual(teamNotificationTiers.all, []);
assert.deepStrictEqual(
  filterTeamPostedRecipientUids(
    ['allowlisted-partner', 'other-partner'],
    [
      { uid: 'allowlisted-partner', phoneNumber: '+91 99999 99999' },
      { uid: 'other-partner', phone: '8888888888' },
    ],
    ['9999999999'],
  ),
  ['allowlisted-partner'],
  'The notification handoff must suppress recipients outside the team phone allowlist',
);
const customerNotificationTiers = getBookNowNotificationTiers(
  teamTiers,
  false,
  ['9999999999'],
);
assert.deepStrictEqual(
  customerNotificationTiers,
  teamTiers,
  'Customer-posted work should retain all eligible partners in every notification stage',
);

console.log('bookNowDispatchWorkAreas.test.ts: all tests passed');
