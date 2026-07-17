/**
 * Unit tests for Book Now per-item schedule resolution and slot dedupe (no database).
 * Run: npx ts-node src/tests/bookNowScheduleResolution.test.ts
 */
import assert from 'assert';
import {
  bookNowSlotWindowsOverlap,
  deriveBookNowTimeSlot,
  expandBlockedSlotsFromAnchor,
} from '../utils/bookNowSlotAvailability';
import {
  collectDistinctBookNowSlotChecks,
  finalizeBookNowLineSchedule,
  hasAnyBookNowScheduleFields,
  isCompleteResolvedBookNowSchedule,
  resolveBookNowLineDurationMinutes,
  resolveBookNowLineSchedule,
  usesPerItemBookNowScheduling,
} from '../utils/bookNowScheduleResolution';

function testResolveLineScheduleFromItemFields() {
  const schedule = resolveBookNowLineSchedule({
    lineSchedule: {
      scheduledDate: '2026-07-20',
      scheduledTimeStart: '10:00 AM',
      durationMinutes: 90,
    },
    catalogDurationMinutes: 60,
  });

  assert.ok(schedule);
  assert.strictEqual(schedule!.scheduledDate, '2026-07-20');
  assert.strictEqual(schedule!.scheduledTimeStart, '10:00 AM');
  assert.strictEqual(schedule!.scheduledTimeEnd, '11:30 AM');
  assert.strictEqual(schedule!.timeSlot, 'morning');
  assert.strictEqual(schedule!.durationMinutes, 90);
}

function testLegacyTopLevelFallback() {
  const schedule = resolveBookNowLineSchedule({
    lineSchedule: {},
    legacySchedule: {
      scheduledDate: '2026-07-21',
      timeSlot: 'evening',
    },
    catalogDurationMinutes: 60,
  });

  assert.ok(schedule);
  assert.strictEqual(schedule!.scheduledDate, '2026-07-21');
  assert.strictEqual(schedule!.scheduledTimeStart, '5:00 PM');
  assert.strictEqual(schedule!.timeSlot, 'evening');
  assert.strictEqual(schedule!.scheduledTimeEnd, '6:00 PM');
}

function testClientDurationOverrideIsCapped() {
  assert.strictEqual(resolveBookNowLineDurationMinutes(60, 45), 45);
  assert.strictEqual(resolveBookNowLineDurationMinutes(60, 0), 60);
  assert.strictEqual(resolveBookNowLineDurationMinutes(60, 99999), 24 * 60);
}

function testPerItemSchedulingDetection() {
  assert.strictEqual(usesPerItemBookNowScheduling([{}], 1), false);
  assert.strictEqual(usesPerItemBookNowScheduling([{}, {}], 2), true);
  assert.strictEqual(
    usesPerItemBookNowScheduling([{ scheduledDate: '2026-07-20' }], 1),
    true,
  );
  assert.strictEqual(hasAnyBookNowScheduleFields({ timeSlot: 'morning' }), true);
}

function testDistinctSlotChecksDedupeIdenticalSlots() {
  const lineA = finalizeBookNowLineSchedule(
    { scheduledDate: '2026-07-20', scheduledTimeStart: '2:00 PM' },
    60,
  );
  const lineB = finalizeBookNowLineSchedule(
    { scheduledDate: '2026-07-20', scheduledTimeStart: '2:00 PM' },
    90,
  );
  const lineC = finalizeBookNowLineSchedule(
    { scheduledDate: '2026-07-20', scheduledTimeStart: '4:00 PM' },
    60,
  );

  const checks = collectDistinctBookNowSlotChecks([lineA, lineB, lineC]);
  assert.strictEqual(checks.length, 2);
  assert.ok(isCompleteResolvedBookNowSchedule(lineA));
}

function testExactStartBlockingSemantics() {
  const blocked = expandBlockedSlotsFromAnchor('2:00 PM');
  assert.deepStrictEqual(blocked, ['2:00 PM']);
  assert.strictEqual(bookNowSlotWindowsOverlap('2:00 PM', '2:00 PM'), true);
  assert.strictEqual(bookNowSlotWindowsOverlap('2:00 PM', '2:30 PM'), false);
  assert.strictEqual(deriveBookNowTimeSlot('10:30 AM'), 'morning');
  assert.strictEqual(deriveBookNowTimeSlot('2:00 PM'), 'afternoon');
}

function run() {
  testResolveLineScheduleFromItemFields();
  testLegacyTopLevelFallback();
  testClientDurationOverrideIsCapped();
  testPerItemSchedulingDetection();
  testDistinctSlotChecksDedupeIdenticalSlots();
  testExactStartBlockingSemantics();
  console.log('bookNowScheduleResolution.test.ts: all tests passed');
}

run();
