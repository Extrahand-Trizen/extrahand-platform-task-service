import assert from 'node:assert/strict';
import { buildOriginalScheduleFields, buildRescheduleHistoryEntry } from '../models/rescheduleHistory';

const previous = {
  scheduledDate: new Date('2026-10-06T00:00:00.000Z'),
  scheduledTimeStart: '10:00 AM',
  scheduledTimeEnd: '12:00 PM',
  timeSlot: 'morning',
};
const next = {
  scheduledDate: new Date('2026-10-08T00:00:00.000Z'),
  scheduledTimeStart: '04:00 PM',
  scheduledTimeEnd: '06:00 PM',
  timeSlot: 'afternoon',
};

const rescheduledAt = new Date('2026-10-05T06:00:00.000Z');
assert.deepEqual(
  buildRescheduleHistoryEntry({
    previous,
    next,
    rescheduledAt,
    rescheduledBy: 'customer-uid',
    actorRole: 'customer',
    reason: '  Not at home  ',
    chargeAmount: 99,
  }),
  {
    previousScheduledDate: previous.scheduledDate,
    previousScheduledTimeStart: '10:00 AM',
    previousScheduledTimeEnd: '12:00 PM',
    previousTimeSlot: 'morning',
    newScheduledDate: next.scheduledDate,
    newScheduledTimeStart: '04:00 PM',
    newScheduledTimeEnd: '06:00 PM',
    newTimeSlot: 'afternoon',
    rescheduledAt,
    rescheduledBy: 'customer-uid',
    actorRole: 'customer',
    reason: 'Not at home',
    chargeAmount: 99,
  },
);

const sparse = buildRescheduleHistoryEntry({
  previous: { scheduledDate: 'not-a-date', scheduledTimeStart: '' },
  next,
  rescheduledAt,
  reason: '   ',
  chargeAmount: 0,
});
assert.equal(sparse.previousScheduledDate, undefined);
assert.equal(sparse.previousScheduledTimeStart, undefined);
assert.equal(sparse.reason, undefined);
assert.equal(sparse.chargeAmount, undefined);

assert.deepEqual(buildOriginalScheduleFields(previous), {
  originalScheduledDate: previous.scheduledDate,
  originalScheduledTimeStart: '10:00 AM',
  originalScheduledTimeEnd: '12:00 PM',
});

console.log('rescheduleHistory tests passed');
