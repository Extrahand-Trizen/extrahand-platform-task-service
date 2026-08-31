/**
 * Unit tests for multi-day project execution helpers.
 * Run: npx ts-node src/tests/projectExecution.test.ts
 */
import assert from 'assert';
import mongoose from 'mongoose';
import {
  buildInitialProjectExecution,
  clampPlannedDays,
  estimateProjectDurationMinutes,
  isTerminalProjectExecution,
  normalizeDayProofUrls,
} from '../utils/projectExecution';

assert.strictEqual(clampPlannedDays(0), 1);
assert.strictEqual(clampPlannedDays(4), 4);
assert.strictEqual(clampPlannedDays(99), 30);

const quotationId = new mongoose.Types.ObjectId();
const initial = buildInitialProjectExecution({
  quotationId,
  estimatedTimelineDays: 4,
});
assert.strictEqual(initial.totalPlannedDays, 4);
assert.strictEqual(initial.days.length, 4);
assert.strictEqual(initial.days[0]?.status, 'planned');
assert.strictEqual(initial.days[3]?.dayNumber, 4);
assert.strictEqual(initial.completedDayCount, 0);
assert.strictEqual(initial.status, 'not_started');

assert.strictEqual(estimateProjectDurationMinutes(2), 2 * 480);
assert.strictEqual(isTerminalProjectExecution('completed'), true);
assert.strictEqual(isTerminalProjectExecution('active'), false);

assert.deepStrictEqual(
  normalizeDayProofUrls([' https://a ', '', 'https://b']),
  ['https://a', 'https://b'],
);

console.log('projectExecution.test.ts: all passed');
