import assert from 'node:assert/strict';
import {
  buildOrderedWorkAreasForDispatch,
  filterTeamPostedOfferTiers,
  filterTeamPostedRecipientUids,
  getBookNowScheduledStartAt,
  getAllBookNowOfferRecipients,
  getBookNowNotificationTiers,
  getFirstAvailableOfferStage,
  getPartnerCategoryValues,
  getPartnerWorkAreaValues,
  isBookNowOfferBeforeScheduledStart,
  mergeActiveOfferRecipients,
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

assert.deepStrictEqual(
  getPartnerCategoryValues([], { plumbing: ['water_tank_motor_installation'] }),
  ['plumbing'],
  'Partner skill groups must count as registered categories',
);
assert.deepStrictEqual(
  getPartnerWorkAreaValues(
    [{ id: 'tadepalligudem', label: 'Tadepalligudem' }],
    ['Kadakatla'],
  ),
  ['Tadepalligudem', 'Kadakatla'],
  'Object and legacy work-area values must both be eligible inputs',
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
assert.deepStrictEqual(
  mergeActiveOfferRecipients(
    ['current-recipient'],
    [partner('current-recipient', '1111111111'), partner('area-rule-partner', '2222222222')],
    [partner('area-rule-partner', '2222222222')],
  ).map(({ uid }) => uid),
  ['current-recipient', 'area-rule-partner'],
  'Adding area-rule partners should preserve current offers and avoid duplicate recipients',
);
assert.deepStrictEqual(
  getAllBookNowOfferRecipients({
    preferred: [partner('preferred-partner', '1111111111')],
    area_rule: [partner('area-rule-partner', '2222222222')],
    all: [partner('other-partner', '3333333333')],
  }).map(({ uid }) => uid),
  ['preferred-partner', 'area-rule-partner', 'other-partner'],
  'Offer restoration should collect partners from every eligible tier',
);
assert.equal(
  getFirstAvailableOfferStage({
    preferred: [partner('preferred-partner', '1111111111')],
    area_rule: [partner('area-rule-partner', '2222222222')],
    all: [partner('other-partner', '3333333333')],
  }),
  'preferred',
  'Preferred partners must be the first offer stage when available',
);
assert.equal(
  getFirstAvailableOfferStage({
    preferred: [],
    area_rule: [partner('area-rule-partner', '2222222222')],
    all: [partner('other-partner', '3333333333')],
  }),
  'area_rule',
  'Area-rule partners are first when no preferred partners are eligible',
);
const scheduledTask = {
  scheduledDate: new Date('2026-10-27T00:00:00.000+05:30'),
  scheduledTimeStart: '2:30 PM',
} as any;
assert.equal(
  getBookNowScheduledStartAt(scheduledTask)?.toISOString(),
  '2026-10-27T09:00:00.000Z',
);
assert.equal(
  isBookNowOfferBeforeScheduledStart(
    scheduledTask,
    new Date('2026-10-27T08:59:00.000Z'),
  ),
  true,
);
assert.equal(
  isBookNowOfferBeforeScheduledStart(
    scheduledTask,
    new Date('2026-10-27T09:00:00.000Z'),
  ),
  false,
);
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
