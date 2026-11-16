import assert from 'node:assert/strict';
import test from 'node:test';
import { isRescheduleSlotTimeAllowed } from '../utils/rescheduleSchedule';

const date = '2026-01-01';
const now = new Date('2026-01-01T04:30:00.000Z'); // 10:00 AM in Asia/Kolkata

test('standard reschedule slots honor the three-hour lead time', () => {
  assert.equal(
    isRescheduleSlotTimeAllowed({
      date,
      scheduledTimeStart: '12:00 PM',
      hourly: false,
      now,
    }),
    false,
  );
  assert.equal(
    isRescheduleSlotTimeAllowed({
      date,
      scheduledTimeStart: '1:00 PM',
      hourly: false,
      now,
    }),
    true,
  );
});

test('standard reschedule slots match the booking operating hours', () => {
  assert.equal(
    isRescheduleSlotTimeAllowed({
      date,
      scheduledTimeStart: '8:00 PM',
      hourly: false,
      now,
    }),
    false,
  );
  assert.equal(
    isRescheduleSlotTimeAllowed({
      date,
      scheduledTimeStart: '7:30 PM',
      hourly: false,
      now,
    }),
    true,
  );
});

test('hourly reschedules do not inherit the standard three-hour lead time', () => {
  assert.equal(
    isRescheduleSlotTimeAllowed({
      date,
      scheduledTimeStart: '10:30 AM',
      hourly: true,
      now,
    }),
    true,
  );
});
