/**
 * Unit tests for Mongo ObjectId / booknow-pending guards.
 * Run: npx ts-node src/tests/isMongoObjectId.test.ts
 */
import assert from 'assert';
import {
  assertMongoObjectIdTaskId,
  isBookNowPendingTaskId,
  isMongoObjectId,
} from '../utils/isMongoObjectId';

assert.strictEqual(isMongoObjectId('507f1f77bcf86cd799439011'), true);
assert.strictEqual(isMongoObjectId('booknow-pending-5bbb85b5-72aa-4222-bb78-a37352dbee48'), false);
assert.strictEqual(isMongoObjectId('not-an-id'), false);
assert.strictEqual(isMongoObjectId(''), false);

assert.strictEqual(
  isBookNowPendingTaskId('booknow-pending-5bbb85b5-72aa-4222-bb78-a37352dbee48'),
  true,
);
assert.strictEqual(isBookNowPendingTaskId('507f1f77bcf86cd799439011'), false);

assert.doesNotThrow(() => assertMongoObjectIdTaskId('507f1f77bcf86cd799439011'));
assert.throws(
  () => assertMongoObjectIdTaskId('booknow-pending-abc'),
  /Task not found/,
);

console.log('isMongoObjectId.test.ts: all tests passed');
