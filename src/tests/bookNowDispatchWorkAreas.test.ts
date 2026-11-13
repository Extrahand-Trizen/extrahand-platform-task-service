import assert from 'node:assert/strict';
import {
  BookNowAutoAssignService,
  buildOrderedWorkAreasForDispatch,
  canStartAllOfferStage,
  filterTeamPostedOfferTiers,
  filterTeamPostedRecipientUids,
  getBookNowScheduledStartAt,
  getAllBookNowOfferRecipients,
  getBookNowNotificationTiers,
  getFirstAvailableOfferStage,
  hasAcceptedPreferredOffer,
  getPartnerCategoryValues,
  getPartnerWorkAreaValues,
  isConfiguredOfferPartner,
  isApplicableAreaRuleForTask,
  isEligiblePartnerForBookNowTask,
  isBookNowOfferBeforeScheduledStart,
  mergeActiveOfferRecipients,
  IDispatchAreaLog,
} from '../services/BookNowAutoAssignService';
import { ITask } from '../models/Task';
import {
  isHourlyPartnerOfferTask,
  isPartnerOfferTask,
  partnerOfferTaskMongoFilter,
} from '../utils/partnerOfferTasks';

assert.equal(
  isHourlyPartnerOfferTask({ categoryLabel: 'Hourly Based' }),
  true,
  'Hourly Based tasks must use partner offers',
);
assert.equal(
  isConfiguredOfferPartner(
    {
      uid: 'firebase-partner-uid',
      profileId: 'mongo-profile-id',
      name: 'Karthik',
      distKm: 1,
      workArea: 'Siddipet',
      workAreaDistKm: 0,
    },
    { uid: 'mongo-profile-id', profileId: 'mongo-profile-id' },
  ),
  true,
  'Configured preferred partners must match by saved profile ID as well as Firebase UID',
);
const staleDispatchProgress: NonNullable<ITask['dispatchProgress']> = {
  currentStage: 'all',
  startedAt: new Date('2026-11-13T10:00:00.000Z'),
  stages: [
    { stage: 'preferred', status: 'skipped', eligibleCount: 0, notifiedCount: 0, acceptedCount: 0, rejectedCount: 0, timedOutCount: 0 },
    { stage: 'area_rule', status: 'skipped', eligibleCount: 0, notifiedCount: 0, acceptedCount: 0, rejectedCount: 0, timedOutCount: 0 },
    { stage: 'all', status: 'in_progress', eligibleCount: 15, notifiedCount: 1, acceptedCount: 0, rejectedCount: 0, timedOutCount: 0 },
  ],
  supportEscalation: {
    status: 'pending',
    dueAt: new Date('2026-11-13T11:00:00.000Z'),
  },
};
const refreshedDispatchLogs: IDispatchAreaLog[] = [{
  area: 'Siddipet',
  distanceKm: 0,
  matchedCategoryCount: 3,
  eligibleCount: 3,
  notifiedCount: 1,
  candidates: [
    { partnerUid: 'preferred-1', name: 'Preferred 1', status: 'eligible', dispatchStage: 'area_rule' },
    { partnerUid: 'preferred-2', name: 'Preferred 2', status: 'eligible', dispatchStage: 'area_rule' },
    { partnerUid: 'other-1', name: 'Other 1', status: 'eligible', dispatchStage: 'all', notifiedAt: new Date() },
  ],
}];
const refreshedDispatchProgress = BookNowAutoAssignService.refreshDispatchProgressCounts(
  staleDispatchProgress,
  refreshedDispatchLogs,
);
assert.equal(
  refreshedDispatchProgress?.stages.find(({ stage }) => stage === 'area_rule')?.eligibleCount,
  2,
  'Task details must refresh preferred-stage counts from the recalculated partner list',
);
assert.equal(
  refreshedDispatchProgress?.stages.find(({ stage }) => stage === 'all')?.eligibleCount,
  1,
  'Refreshing counts must not include preferred partners in the other-eligible stage',
);
assert.equal(
  refreshedDispatchProgress?.currentStage,
  'all',
  'Refreshing task-detail counts must preserve the active dispatch stage',
);
assert.equal(
  isPartnerOfferTask({ bookingSource: 'marketplace', budget: { type: 'hourly' } }),
  true,
  'Hourly marketplace tasks must use partner offers',
);
assert.equal(
  isPartnerOfferTask({ bookingSource: 'marketplace', budget: { type: 'fixed' } }),
  false,
  'Fixed-price marketplace tasks must not enter the partner offer flow',
);
assert.ok(
  JSON.stringify(partnerOfferTaskMongoFilter()).includes('budget.type'),
  'Scheduler and offer queries must include hourly-budget tasks',
);
const siddipetBookNowCleaningTask = {
  bookingSource: 'book_now',
  category: 'cleaning',
  categorySlug: 'full-house',
  budget: { type: 'hourly' },
  location: { taskArea: 'Siddipet', city: 'Siddipet' },
} as any;
assert.equal(
  isApplicableAreaRuleForTask(siddipetBookNowCleaningTask, {
    area: 'Siddipet',
    category: 'cleaning',
    workTypes: ['book_now'],
  }),
  true,
  'Hourly-priced Book Now cleaning must match its Siddipet Book Now preference rule',
);
assert.equal(
  isApplicableAreaRuleForTask(siddipetBookNowCleaningTask, {
    area: 'Siddipet',
    category: 'plumbing',
    workTypes: ['book_now'],
  }),
  false,
  'Book Now preferences configured for a different category must not be used',
);
assert.equal(
  isApplicableAreaRuleForTask(
    {
      ...siddipetBookNowCleaningTask,
      location: { taskArea: 'Kukatpally', city: 'Hyderabad' },
    },
    {
      area: 'Hyderabad',
      category: 'cleaning',
      workTypes: ['book_now'],
    },
  ),
  true,
  'City-level preferences must apply when the work area is a neighborhood in that city',
);

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

const dispatchPartner = {
  isActive: true,
  isAvailable: true,
  partnerProfile: {
    status: 'approved',
    categories: [],
    skills: { cleaning: ['deep_cleaning'] },
    workAreas: ['Madhapur'],
    workShifts: [],
  },
};
const bookNowCleaningTask = {
  category: 'cleaning',
  categorySlug: 'full-house',
  location: hyderabadTask.location,
} as any;
assert.equal(
  isEligiblePartnerForBookNowTask(dispatchPartner, bookNowCleaningTask),
  true,
  'Partners matched through saved skill groups and nearby dispatch areas must be able to accept offers',
);
assert.equal(
  isEligiblePartnerForBookNowTask(
    {
      ...dispatchPartner,
      partnerProfile: { ...dispatchPartner.partnerProfile, onLeave: true },
    },
    bookNowCleaningTask,
  ),
  false,
  'Partners who are on leave must not be able to accept offers',
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
  'area_rule',
  'Area-rule partners must be notified before other eligible partners',
);
assert.equal(
  getFirstAvailableOfferStage({
    preferred: [partner('preferred-partner', '1111111111')],
    area_rule: [],
    all: [partner('other-partner', '3333333333')],
  }),
  'all',
  'Other eligible partners are the fallback when no area-rule partners are eligible',
);
const preferredNotAllowlisted = {
  preferred: [],
  area_rule: [partner('preferred-not-allowlisted', '1111111111')],
  all: [partner('team-allowlisted-other', '9999999999')],
};
const teamFilteredPreferred = getBookNowNotificationTiers(
  preferredNotAllowlisted,
  true,
  ['9999999999'],
);
assert.deepStrictEqual(
  teamFilteredPreferred.area_rule,
  [],
  'Team-posted preferred partners outside the allowlist must not receive notifications',
);
assert.equal(
  getFirstAvailableOfferStage(preferredNotAllowlisted),
  'area_rule',
  'The preferred acceptance window must start even when team filtering leaves no preferred notification recipients',
);
const preferredDeadline = new Date('2026-11-13T10:45:00.000Z');
assert.equal(
  canStartAllOfferStage(
    true,
    preferredDeadline,
    new Date('2026-11-13T10:44:59.999Z'),
  ),
  false,
  'Other eligible partners must remain blocked before the preferred window expires',
);
assert.equal(
  canStartAllOfferStage(true, preferredDeadline, preferredDeadline),
  true,
  'Other eligible partners may be notified once the preferred window expires',
);
assert.equal(
  canStartAllOfferStage(false, undefined, new Date('2026-11-13T10:00:00.000Z')),
  true,
  'Other eligible partners remain an immediate fallback when no preferred partners are eligible',
);
assert.equal(
  hasAcceptedPreferredOffer([
    {
      area: 'Kareemabad',
      distanceKm: 0,
      matchedCategoryCount: 1,
      eligibleCount: 1,
      notifiedCount: 1,
      candidates: [
        {
          partnerUid: 'accepted-preferred',
          name: 'Preferred Partner',
          status: 'eligible',
          dispatchStage: 'area_rule',
          responseStatus: 'accepted',
        },
      ],
    },
  ]),
  true,
  'An accepted preferred offer must prevent the later notification stage',
);
assert.equal(
  hasAcceptedPreferredOffer([
    {
      area: 'Kareemabad',
      distanceKm: 0,
      matchedCategoryCount: 1,
      eligibleCount: 1,
      notifiedCount: 1,
      candidates: [
        {
          partnerUid: 'accepted-other',
          name: 'Other Partner',
          status: 'eligible',
          dispatchStage: 'all',
          responseStatus: 'accepted',
        },
      ],
    },
  ]),
  false,
  'An acceptance from another stage is not a preferred acceptance',
);
assert.equal(
  getFirstAvailableOfferStage({
    preferred: [partner('preferred-partner', '1111111111')],
    area_rule: [],
    all: [],
  }),
  undefined,
  'The global preferred-partner list must not start a Book Now offer stage',
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
