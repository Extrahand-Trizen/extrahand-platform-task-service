import assert from 'assert';
import { resolveRescheduleEndTime } from '../utils/rescheduleSchedule';
import { assertHourlyScheduledSlotWithinOperatingHours } from '../utils/hourlyBookingGuards';

assert.strictEqual(resolveRescheduleEndTime('10:00 AM', 30), '10:30 AM');
assert.strictEqual(resolveRescheduleEndTime('10:00 AM', 45), '10:45 AM');
assert.strictEqual(resolveRescheduleEndTime('10:00 AM', 60), '11:00 AM');
assert.strictEqual(resolveRescheduleEndTime('6:15 PM', 45), '7:00 PM');

assert.doesNotThrow(() =>
  assertHourlyScheduledSlotWithinOperatingHours({
    scheduledTimeStart: '6:00 PM',
    durationMinutes: 60,
  }),
);
assert.throws(() =>
  assertHourlyScheduledSlotWithinOperatingHours({
    scheduledTimeStart: '6:30 PM',
    durationMinutes: 60,
  }),
);

console.log('hourlyRescheduleSchedule.test.ts: all tests passed');
