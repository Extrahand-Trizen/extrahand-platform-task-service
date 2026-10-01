/**
 * Unit tests for partner-capacity overlap, location matching, and shift coverage.
 * Run: npx ts-node src/utils/bookNowPartnerCapacity.test.ts
 */
import assert from 'assert';
import {
  countPartnersAvailableForInterval,
  hasPartnerCapacityForSlot,
  isHourlyCapacityCandidateWithinWindow,
  isPartnerTaskBlockingStatus,
  locationKeysForPartnerCapacity,
  partnerMatchesHourlyHelperCategory,
  partnerWorkAreasMatchLocationKeys,
  workShiftsCoverInterval,
} from './bookNowSlotAvailability';

function parseSlot(slot: string): number | null {
  const match = slot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

type Interval = { start: number; end: number };

function overlaps(occupied: Interval, candidateStart: number, candidateEnd: number): boolean {
  return candidateStart < occupied.end && occupied.start < candidateEnd;
}

function countFreePartners(
  partners: Interval[][],
  slotStart: string,
  durationMinutes: number,
): number {
  const start = parseSlot(slotStart)!;
  const end = start + durationMinutes;
  return partners.filter(
    (intervals) => !intervals.some((iv) => overlaps(iv, start, end)),
  ).length;
}

function interval(startSlot: string, endSlot: string): Interval {
  return { start: parseSlot(startSlot)!, end: parseSlot(endSlot)! };
}

{
  const A = [interval('10:00 AM', '12:00 PM')];
  const B = [interval('10:00 AM', '12:00 PM')];
  const C: Interval[] = [];
  assert.strictEqual(countFreePartners([A, B, C], '10:00 AM', 60), 1);
}

{
  const A = [interval('10:00 AM', '12:00 PM')];
  const B = [interval('10:00 AM', '12:00 PM')];
  const C = [interval('10:00 AM', '12:00 PM')];
  assert.strictEqual(countFreePartners([A, B, C], '10:00 AM', 60), 0);
}

{
  const A = [interval('10:00 AM', '12:00 PM')];
  const B = [interval('10:00 AM', '11:00 AM')];
  const C = [interval('10:00 AM', '12:00 PM')];
  assert.strictEqual(countFreePartners([A, B, C], '11:00 AM', 60), 1);
}

assert.strictEqual(countFreePartners([[interval('10:30 AM', '11:30 AM')]], '10:00 AM', 60), 0);
assert.strictEqual(countFreePartners([[interval('11:00 AM', '12:00 PM')]], '10:00 AM', 60), 1);
assert.strictEqual(countFreePartners([[interval('10:00 AM', '11:00 AM')]], '10:00 AM', 120), 0);
assert.strictEqual(countFreePartners([[]], '10:00 AM', 60), 1);
assert.strictEqual(countFreePartners([[interval('11:00 AM', '12:00 PM')]], '10:00 AM', 60), 1);
assert.strictEqual(countFreePartners([[interval('10:00 AM', '11:00 AM')]], '11:00 AM', 60), 1);

{
  const partner = [interval('10:30 AM', '11:30 AM')];
  assert.strictEqual(countFreePartners([partner], '10:00 AM', 60), 0);
  assert.strictEqual(countFreePartners([partner], '11:00 AM', 60), 0);
  assert.strictEqual(countFreePartners([partner], '11:30 AM', 60), 1);
}

{
  const partner = [interval('10:00 AM', '11:00 AM')];
  assert.strictEqual(countFreePartners([partner], '10:30 AM', 30), 0);
  assert.strictEqual(countFreePartners([partner], '11:00 AM', 30), 1);
  assert.strictEqual(countFreePartners([partner], '10:00 AM', 120), 0);
}

assert.strictEqual(
  partnerWorkAreasMatchLocationKeys(['Yapral', 'Sainikpuri'], ['Hyderabad', 'Yapral']),
  true,
);
assert.strictEqual(partnerWorkAreasMatchLocationKeys(['Yapral'], ['Bengaluru']), false);

{
  const keys = locationKeysForPartnerCapacity({
    city: 'Hyderabad',
    area: 'Yapral',
    lat: 17.5147,
    lng: 78.5369,
  });
  assert.ok(keys.some((key) => /yapral/i.test(key)));
  assert.ok(keys.some((key) => /sainikpuri/i.test(key)));
}

{
  const cityOnly = locationKeysForPartnerCapacity({ city: 'Hyderabad' });
  assert.ok(cityOnly.some((key) => /uppal/i.test(key)));
  assert.ok(cityOnly.some((key) => /secunderabad/i.test(key)));
}

{
  const uppalScoped = locationKeysForPartnerCapacity({
    city: 'Hyderabad',
    area: 'Uppal',
    lat: 17.4056,
    lng: 78.5594,
  });
  assert.ok(uppalScoped.some((key) => /uppal/i.test(key)));
  // Must stay scoped — Madhapur should not be pulled in for an Uppal booking.
  assert.ok(!uppalScoped.some((key) => /madhapur/i.test(key)));
}

{
  const homeOnly = locationKeysForPartnerCapacity({
    city: 'Hyderabad',
    area: 'Home',
  });
  assert.ok(homeOnly.some((key) => /uppal/i.test(key)));
  assert.ok(!homeOnly.some((key) => /^home$/i.test(key)));
}

{
  const morningFull = ['morning_full_time'];
  assert.strictEqual(workShiftsCoverInterval(morningFull, 15 * 60, 16 * 60), true);
  assert.strictEqual(workShiftsCoverInterval(morningFull, 16 * 60, 18 * 60), false);
  assert.strictEqual(workShiftsCoverInterval([], 16 * 60, 18 * 60), true);
  assert.strictEqual(workShiftsCoverInterval(morningFull, 7 * 60, 20 * 60, true), true);
  assert.strictEqual(workShiftsCoverInterval(['morning_rush'], 7 * 60, 13 * 60, true), true);
  assert.strictEqual(workShiftsCoverInterval(['morning_rush'], 13 * 60, 14 * 60, true), false);
  assert.strictEqual(workShiftsCoverInterval(['afternoon_block'], 14 * 60, 20 * 60, true), true);
  assert.strictEqual(workShiftsCoverInterval(['afternoon_block'], 13 * 60 + 30, 14 * 60, true), false);
}

{
  const partners = [
    { workShifts: [], occupiedIntervals: [{ start: 7 * 60, end: 8 * 60 }] },
    { workShifts: [], occupiedIntervals: [{ start: 7 * 60 + 30, end: 8 * 60 + 30 }] },
    { workShifts: [], occupiedIntervals: [{ start: 7 * 60 + 30, end: 9 * 60 }] },
  ];
  assert.strictEqual(countPartnersAvailableForInterval(partners, 7 * 60, 8 * 60), 0);
  assert.strictEqual(countPartnersAvailableForInterval(partners, 7 * 60 + 30, 8 * 60 + 30), 0);
  assert.strictEqual(countPartnersAvailableForInterval(partners, 8 * 60, 9 * 60), 1);
  assert.strictEqual(countPartnersAvailableForInterval(partners, 8 * 60 + 30, 9 * 60 + 30), 2);
  assert.strictEqual(countPartnersAvailableForInterval(partners, 9 * 60, 10 * 60), 3);
}

assert.strictEqual(
  countPartnersAvailableForInterval(
    [{ workShifts: ['morning_full_time'], occupiedIntervals: [] }],
    7 * 60,
    8 * 60,
  ),
  0,
);
assert.strictEqual(
  countPartnersAvailableForInterval(
    [{ workShifts: ['morning_full_time'], occupiedIntervals: [] }],
    8 * 60,
    9 * 60,
  ),
  1,
);
assert.strictEqual(
  countPartnersAvailableForInterval(
    [
      { workShifts: ['morning_rush'], occupiedIntervals: [] },
      { workShifts: ['afternoon_block'], occupiedIntervals: [] },
    ],
    7 * 60,
    8 * 60,
    true,
  ),
  1,
);
assert.strictEqual(
  countPartnersAvailableForInterval(
    [
      { workShifts: ['morning_rush'], occupiedIntervals: [] },
      { workShifts: ['afternoon_block'], occupiedIntervals: [] },
    ],
    14 * 60,
    15 * 60,
    true,
  ),
  1,
);
assert.strictEqual(countPartnersAvailableForInterval([], 10 * 60, 11 * 60), 0);
assert.strictEqual(
  countPartnersAvailableForInterval(
    [{ workShifts: [], occupiedIntervals: [] }],
    10 * 60,
    11 * 60,
  ),
  1,
);
assert.strictEqual(
  countPartnersAvailableForInterval(
    [{ workShifts: [], occupiedIntervals: [{ start: 10 * 60, end: 11 * 60 }] }],
    11 * 60,
    12 * 60,
  ),
  1,
);
assert.strictEqual(partnerMatchesHourlyHelperCategory(['cleaning']), true);
assert.strictEqual(partnerMatchesHourlyHelperCategory(['repair']), false);
assert.strictEqual(partnerMatchesHourlyHelperCategory(['hourly-helper']), true);
assert.strictEqual(hasPartnerCapacityForSlot({ '7:00 PM': 1 }, '7:00 PM'), true);
assert.strictEqual(hasPartnerCapacityForSlot({ '7:00 PM': 0 }, '7:00 PM'), false);
assert.strictEqual(hasPartnerCapacityForSlot({}, '7:00 PM'), false);
assert.strictEqual(isPartnerTaskBlockingStatus('assigned'), true);
assert.strictEqual(isPartnerTaskBlockingStatus('active', true), true);
assert.strictEqual(isPartnerTaskBlockingStatus('active'), false);
assert.strictEqual(isPartnerTaskBlockingStatus('in_progress'), true);
assert.strictEqual(isPartnerTaskBlockingStatus('started'), true);
assert.strictEqual(isPartnerTaskBlockingStatus('review'), true);
assert.strictEqual(isPartnerTaskBlockingStatus('cancelled'), false);
assert.strictEqual(isPartnerTaskBlockingStatus('completed'), false);
assert.strictEqual(isHourlyCapacityCandidateWithinWindow(7 * 60, 30), true);
assert.strictEqual(isHourlyCapacityCandidateWithinWindow(19 * 60, 30), true);
assert.strictEqual(isHourlyCapacityCandidateWithinWindow(19 * 60 + 30, 30), true);
assert.strictEqual(isHourlyCapacityCandidateWithinWindow(19 * 60 + 30, 45), false);
assert.strictEqual(isHourlyCapacityCandidateWithinWindow(20 * 60, 30), false);
assert.strictEqual(isHourlyCapacityCandidateWithinWindow(19 * 60 + 15, 30), false);

console.log('bookNowPartnerCapacity.test.ts: all tests passed');
