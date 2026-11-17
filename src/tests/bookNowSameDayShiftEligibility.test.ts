import assert from 'node:assert/strict';
import {
  BookNowAutoAssignService,
  isEligiblePartnerForBookNowTask,
} from '../services/BookNowAutoAssignService';

const task = {
  category: 'ac_service',
  categorySlug: 'ac-servicing',
  scheduledDate: new Date('2026-11-17T00:00:00.000+05:30'),
  scheduledTimeStart: '4:30 PM',
  location: {
    taskArea: 'Gachibowli',
    city: 'Hyderabad',
  },
};

function partnerWithShift(shift: string) {
  return {
    isActive: true,
    isAvailable: true,
    partnerProfile: {
      status: 'approved',
      categories: ['ac_service'],
      workAreas: ['Gachibowli'],
      workShifts: [shift],
    },
  };
}

assert.equal(
  isEligiblePartnerForBookNowTask(partnerWithShift('morning_full_time'), task as any),
  true,
  'AC partners selecting Full-Time (7 AM–8 PM) must qualify for a same-day 4:30 PM slot',
);
assert.equal(
  isEligiblePartnerForBookNowTask(partnerWithShift('morning_rush'), task as any),
  false,
  'Partners whose selected shift ends at 1 PM must remain ineligible for a 4:30 PM slot',
);
assert.equal(
  isEligiblePartnerForBookNowTask(partnerWithShift('afternoon_block'), task as any),
  true,
  'AC partners selecting the 2 PM–8 PM shift must qualify for a 4:30 PM slot',
);

const refreshedLogs = BookNowAutoAssignService.mergeEligiblePartnersIntoDispatchLog(
  task as any,
  [{
    area: 'Gachibowli',
    distanceKm: 0,
    matchedCategoryCount: 1,
    eligibleCount: 1,
    notifiedCount: 0,
    candidates: [{
      partnerUid: 'full-time-partner',
      name: 'Full-Time Partner',
      status: 'eligible',
      shiftTiming: '8am-4pm',
      details: 'shift 8am-4pm, 2 km away',
    }],
  }],
  [{
    uid: 'full-time-partner',
    profileId: 'full-time-profile',
    name: 'Full-Time Partner',
    distKm: 2,
    workArea: 'Gachibowli',
    workAreaDistKm: 0,
    shiftTiming: '7am-8pm',
  }],
);
assert.equal(
  refreshedLogs[0].candidates[0].shiftTiming,
  '7am-8pm',
  'Refreshing dispatch logs must replace the saved legacy shift label',
);
assert.equal(
  refreshedLogs[0].candidates[0].details,
  'shift 7am-8pm, 2 km away',
  'Refreshing dispatch log details must use the current partner shift label',
);

console.log('bookNowSameDayShiftEligibility.test.ts: all tests passed');
