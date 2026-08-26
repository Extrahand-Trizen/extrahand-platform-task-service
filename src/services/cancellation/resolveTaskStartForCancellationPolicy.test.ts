/**
 * Book Now cancellation start-time resolution.
 * Run: npx ts-node src/services/cancellation/resolveTaskStartForCancellationPolicy.test.ts
 */
import assert from 'assert';
import { resolveTaskStartForCancellationPolicy } from './cancellationContext';

function testAug28MorningIstFromUtcMidnightStorage(): void {
  // Mongo stores calendar day as UTC midnight (2026-08-27T18:30:00.000Z = Aug 28 00:00 IST)
  const scheduledDate = new Date('2026-08-27T18:30:00.000Z');
  const start = resolveTaskStartForCancellationPolicy({
    scheduledDate,
    scheduledTimeStart: '10:00 AM',
  });
  assert.strictEqual(start.toISOString(), '2026-08-28T04:30:00.000Z');
}

function testMoreThan24hBeforeAug28Morning(): void {
  const scheduledDate = new Date('2026-08-27T18:30:00.000Z');
  const start = resolveTaskStartForCancellationPolicy({
    scheduledDate,
    scheduledTimeStart: '10:00 AM',
  });
  const cancelledAt = new Date('2026-08-26T12:00:00.000Z'); // Aug 26 5:30 PM IST
  const hoursUntil = (start.getTime() - cancelledAt.getTime()) / (1000 * 60 * 60);
  assert.ok(hoursUntil > 24, `expected >24h, got ${hoursUntil}`);
}

function testDoesNotUseCreatedAtFallback(): void {
  const createdAt = new Date('2026-08-26T10:00:00.000Z');
  const start = resolveTaskStartForCancellationPolicy({
    scheduledDate: null,
    orderScheduledDate: null,
  });
  const hoursUntil = (start.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  assert.ok(hoursUntil > 900, 'missing schedule should not anchor to createdAt');
}

function main(): void {
  testAug28MorningIstFromUtcMidnightStorage();
  testMoreThan24hBeforeAug28Morning();
  testDoesNotUseCreatedAtFallback();
  console.log('resolveTaskStartForCancellationPolicy.test.ts: all tests passed');
}

main();
