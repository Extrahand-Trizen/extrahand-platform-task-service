import assert from 'node:assert/strict';
import {
  buildHourlyScheduleCapacity,
  isHourlySlotAllowedBySettings,
  validateHourlySlotSettings,
  type HourlySlotSettings,
} from '../utils/hourlySlotPolicy';

const settings: HourlySlotSettings = {
  mode: 'managed_schedule',
  startTime: '08:00',
  endTime: '18:00',
  blockedHours: 2,
};
const now = new Date('2026-11-05T05:30:00.000Z'); // 11:00 Asia/Kolkata

assert.equal(
  isHourlySlotAllowedBySettings({
    date: '2026-11-05',
    slot: '12:30',
    durationMinutes: 60,
    settings,
    now,
  }),
  false,
);
assert.equal(
  isHourlySlotAllowedBySettings({
    date: '2026-11-05',
    slot: '13:00',
    durationMinutes: 60,
    settings,
    now,
  }),
  true,
);
assert.equal(
  isHourlySlotAllowedBySettings({
    date: '2026-11-05',
    slot: '17:30',
    durationMinutes: 60,
    settings,
    now,
  }),
  false,
);
assert.equal(
  isHourlySlotAllowedBySettings({
    date: '2026-11-06',
    slot: '08:00',
    durationMinutes: 60,
    settings,
    now,
  }),
  true,
);
assert.equal(
  buildHourlyScheduleCapacity({
    date: '2026-11-05',
    durationMinutes: 60,
    settings,
    now,
  })['1:00 PM'],
  1,
);
assert.throws(() =>
  validateHourlySlotSettings({ ...settings, startTime: '06:30' }),
);
assert.throws(() =>
  validateHourlySlotSettings({ ...settings, blockedHours: 1.25 }),
);

console.log('hourlySlotPolicy.test.ts passed');
