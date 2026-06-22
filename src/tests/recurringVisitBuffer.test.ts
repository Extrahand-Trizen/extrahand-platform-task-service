/**
 * Unit tests for recurring visit buffer logic (no database required).
 * Run: npx ts-node src/tests/recurringVisitBuffer.test.ts
 */
import assert from 'assert';
import {
  DEFAULT_RECURRING_VISIT_BUFFER_SIZE,
  isBufferCountedVisitStatus,
} from '../config/recurringVisitConfig';
import {
  buildRecurringScheduleDates,
  countPlannedRecurringOccurrences,
  MAX_RECURRING_PLAN_OCCURRENCES,
  normalizeDateOnly,
  resolveMaterializationMissingCount,
  resolveNextMaterializedVisitDate,
  validateRecurringPlanOccurrences,
  type RecurringScheduleBuildConfig,
} from '../utils/recurringVisitScheduleBuilder';
import { VISIT_TERMINAL_STATUSES } from '../types/recurringVisitSchedule';

const JUN_1 = normalizeDateOnly(new Date('2026-06-01T00:00:00.000Z'));
const JUN_4 = normalizeDateOnly(new Date('2026-06-04T00:00:00.000Z'));

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function endOnDateConfig(
  pattern: RecurringScheduleBuildConfig['pattern'],
  selectedWeekdays: number[] = [],
): RecurringScheduleBuildConfig {
  return {
    pattern,
    selectedWeekdays,
    startDate: JUN_1,
    endType: 'end_on_date',
    endDate: JUN_4,
  };
}

/** Simulates collection buffer materialization without MongoDB. */
function simulateBufferMaterialization(
  config: RecurringScheduleBuildConfig,
  bufferSize = DEFAULT_RECURRING_VISIT_BUFFER_SIZE,
): Date[] {
  const totalPlanned =
    config.endType === 'end_on_date' ? countPlannedRecurringOccurrences(config) : undefined;
  const dates: Date[] = [];
  let advanceCursor: Date | null = null;
  let materializedCount = 0;

  while (true) {
    const missingCount = resolveMaterializationMissingCount({
      bufferSize,
      upcomingVisitCount: dates.length,
      endType: config.endType,
      totalPlannedOccurrences: totalPlanned,
      totalMaterializedOccurrences: materializedCount,
    });
    if (missingCount <= 0) break;

    const nextDate = resolveNextMaterializedVisitDate(
      config,
      advanceCursor,
      materializedCount,
    );
    if (!nextDate) break;
    if (
      config.endType === 'end_on_date' &&
      config.endDate &&
      normalizeDateOnly(nextDate).getTime() > normalizeDateOnly(config.endDate).getTime()
    ) {
      break;
    }

    dates.push(nextDate);
    advanceCursor = nextDate;
    materializedCount += 1;
  }

  return dates;
}

function testDefaultBufferSize(): void {
  assert.strictEqual(DEFAULT_RECURRING_VISIT_BUFFER_SIZE, 7);
}

function testBufferCountedStatuses(): void {
  assert.strictEqual(isBufferCountedVisitStatus('scheduled'), true);
  assert.strictEqual(isBufferCountedVisitStatus('payment_pending'), true);
  assert.strictEqual(isBufferCountedVisitStatus('completed'), false);
  assert.strictEqual(isBufferCountedVisitStatus('skipped_unpaid'), false);
}

function testDailyPlanGeneratesSevenDates(): void {
  const dates = buildRecurringScheduleDates(
    {
      pattern: 'daily',
      selectedWeekdays: [],
      startDate: JUN_1,
      endType: 'until_cancelled',
    },
    DEFAULT_RECURRING_VISIT_BUFFER_SIZE,
  );
  assert.strictEqual(dates.length, 7);
}

function testEndOnDateStopsAtEndDate(): void {
  const dates = buildRecurringScheduleDates(endOnDateConfig('daily'), MAX_RECURRING_PLAN_OCCURRENCES);
  assert.strictEqual(dates.length, 4);
  assert.deepStrictEqual(dates.map(dateKey), ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
}

function testSelectedWeekdays(): void {
  const dates = buildRecurringScheduleDates(
    {
      pattern: 'selected_weekdays',
      selectedWeekdays: [1, 3],
      startDate: JUN_1,
      endType: 'until_cancelled',
    },
    4,
  );
  assert.strictEqual(dates.length, 4);
  for (const d of dates) {
    const day = d.getUTCDay();
    assert.ok(day === 1 || day === 3, `expected Mon/Wed got ${day}`);
  }
}

function testTerminalStatuses(): void {
  assert.ok(VISIT_TERMINAL_STATUSES.has('completed'));
  assert.ok(VISIT_TERMINAL_STATUSES.has('skipped_unpaid'));
  assert.ok(!VISIT_TERMINAL_STATUSES.has('scheduled'));
}

function testFirstMaterializedDateIsStartDate(): void {
  const config = endOnDateConfig('daily');
  const first = resolveNextMaterializedVisitDate(config, null, 0);
  assert.strictEqual(dateKey(first!), '2026-06-01');
}

function testDailyJun1ToJun4MaterializesFourVisits(): void {
  const dates = simulateBufferMaterialization(endOnDateConfig('daily'));
  assert.strictEqual(dates.length, 4);
  assert.deepStrictEqual(dates.map(dateKey), ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
}

function testWeeklyJun1ToJun4MaterializesOneVisit(): void {
  const dates = simulateBufferMaterialization(endOnDateConfig('weekly'));
  assert.strictEqual(dates.length, 1);
  assert.strictEqual(dateKey(dates[0]), '2026-06-01');
}

function testBiweeklyJun1ToJun4MaterializesOneVisit(): void {
  const dates = simulateBufferMaterialization(endOnDateConfig('biweekly'));
  assert.strictEqual(dates.length, 1);
  assert.strictEqual(dateKey(dates[0]), '2026-06-01');
}

function testMonthlyJun1ToJun4MaterializesOneVisit(): void {
  const dates = simulateBufferMaterialization(endOnDateConfig('monthly'));
  assert.strictEqual(dates.length, 1);
  assert.strictEqual(dateKey(dates[0]), '2026-06-01');
}

function testWeekdaysJun1ToJun4MaterializesFourVisits(): void {
  const config = endOnDateConfig('selected_weekdays', [1, 2, 3, 4, 5]);
  const dates = simulateBufferMaterialization(config);
  assert.strictEqual(dates.length, 4);
  assert.deepStrictEqual(dates.map(dateKey), ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
}

function testBufferCapDoesNotExceedRemainingOccurrences(): void {
  const missing = resolveMaterializationMissingCount({
    bufferSize: 7,
    upcomingVisitCount: 0,
    endType: 'end_on_date',
    totalPlannedOccurrences: 4,
    totalMaterializedOccurrences: 0,
  });
  assert.strictEqual(missing, 4);
}

function testBufferCapAfterPartialMaterialization(): void {
  const missing = resolveMaterializationMissingCount({
    bufferSize: 7,
    upcomingVisitCount: 2,
    endType: 'end_on_date',
    totalPlannedOccurrences: 4,
    totalMaterializedOccurrences: 2,
  });
  assert.strictEqual(missing, 2);
}

function testNoReplacementWhenBufferFull(): void {
  const missing = resolveMaterializationMissingCount({
    bufferSize: 7,
    upcomingVisitCount: 7,
    endType: 'until_cancelled',
    totalMaterializedOccurrences: 10,
  });
  assert.strictEqual(missing, 0);
}

function testEndDateInclusive(): void {
  const config = endOnDateConfig('daily');
  const planned = buildRecurringScheduleDates(config, MAX_RECURRING_PLAN_OCCURRENCES);
  assert.strictEqual(dateKey(planned[planned.length - 1]), '2026-06-04');
}

function testValidateRecurringPlanOccurrencesStoresTotal(): void {
  const total = validateRecurringPlanOccurrences(endOnDateConfig('daily'));
  assert.strictEqual(total, 4);
}

function testValidateRejectsEmptySchedule(): void {
  assert.throws(
    () =>
      validateRecurringPlanOccurrences({
        pattern: 'selected_weekdays',
        selectedWeekdays: [0, 6],
        startDate: JUN_1,
        endType: 'end_on_date',
        endDate: JUN_4,
      }),
    /no dates/,
  );
}

function testValidateRejectsMoreThan366Occurrences(): void {
  const start = normalizeDateOnly(new Date('2026-01-01T00:00:00.000Z'));
  const end = normalizeDateOnly(new Date('2027-01-02T00:00:00.000Z'));
  assert.throws(
    () =>
      validateRecurringPlanOccurrences({
        pattern: 'daily',
        selectedWeekdays: [],
        startDate: start,
        endType: 'end_on_date',
        endDate: end,
      }),
    /maximum supported 366/,
  );
}

function testIdempotentNextDateResolution(): void {
  const config = endOnDateConfig('daily');
  const first = resolveNextMaterializedVisitDate(config, null, 0);
  const again = resolveNextMaterializedVisitDate(config, null, 0);
  assert.strictEqual(dateKey(first!), dateKey(again!));
}

function testLongDailyPlanMaterializesOnlyBufferSize(): void {
  const start = normalizeDateOnly(new Date('2026-06-01T00:00:00.000Z'));
  const end = normalizeDateOnly(new Date('2026-06-30T00:00:00.000Z'));
  const config: RecurringScheduleBuildConfig = {
    pattern: 'daily',
    selectedWeekdays: [],
    startDate: start,
    endType: 'end_on_date',
    endDate: end,
  };
  const dates = simulateBufferMaterialization(config);
  assert.strictEqual(dates.length, 7);
  assert.strictEqual(dateKey(dates[0]), '2026-06-01');
  assert.strictEqual(dateKey(dates[6]), '2026-06-07');
}

function testUntilCancelledUsesPlanIndexNotRescheduledCursor(): void {
  const config: RecurringScheduleBuildConfig = {
    pattern: 'weekly',
    selectedWeekdays: [],
    startDate: JUN_1,
    endType: 'until_cancelled',
  };

  const first = resolveNextMaterializedVisitDate(config, normalizeDateOnly(new Date('2026-06-03T00:00:00.000Z')), 0);
  const second = resolveNextMaterializedVisitDate(config, normalizeDateOnly(new Date('2026-06-03T00:00:00.000Z')), 1);

  assert.strictEqual(dateKey(first!), '2026-06-01');
  assert.strictEqual(dateKey(second!), '2026-06-08');
}

const tests = [
  testDefaultBufferSize,
  testBufferCountedStatuses,
  testDailyPlanGeneratesSevenDates,
  testEndOnDateStopsAtEndDate,
  testSelectedWeekdays,
  testTerminalStatuses,
  testFirstMaterializedDateIsStartDate,
  testDailyJun1ToJun4MaterializesFourVisits,
  testWeeklyJun1ToJun4MaterializesOneVisit,
  testBiweeklyJun1ToJun4MaterializesOneVisit,
  testMonthlyJun1ToJun4MaterializesOneVisit,
  testWeekdaysJun1ToJun4MaterializesFourVisits,
  testBufferCapDoesNotExceedRemainingOccurrences,
  testBufferCapAfterPartialMaterialization,
  testNoReplacementWhenBufferFull,
  testEndDateInclusive,
  testValidateRecurringPlanOccurrencesStoresTotal,
  testValidateRejectsEmptySchedule,
  testValidateRejectsMoreThan366Occurrences,
  testIdempotentNextDateResolution,
  testLongDailyPlanMaterializesOnlyBufferSize,
  testUntilCancelledUsesPlanIndexNotRescheduledCursor,
];

let passed = 0;
for (const t of tests) {
  t();
  passed += 1;
  console.log(`✓ ${t.name}`);
}
console.log(`\n${passed}/${tests.length} tests passed`);
