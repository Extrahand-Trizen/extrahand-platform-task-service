import assert from 'node:assert/strict';
import test from 'node:test';
import BookingItem from '../models/BookingItem';
import BookingOrder from '../models/BookingOrder';
import Task from '../models/Task';

test('checkout attempts and booking lines have partial unique constraints', () => {
  const orderIndex = BookingOrder.schema.indexes().find(
    ([keys, options]) =>
      keys.customerUid === 1 &&
      keys.checkoutAttemptId === 1 &&
      options?.unique === true,
  );
  const lineIndex = BookingItem.schema.indexes().find(
    ([keys, options]) =>
      keys.orderId === 1 &&
      keys.checkoutLineIndex === 1 &&
      options?.unique === true,
  );

  assert.ok(orderIndex);
  assert.ok(lineIndex);
});

test('one materialized task is allowed per booking item', () => {
  const taskIndex = Task.schema.indexes().find(
    ([keys, options]) =>
      keys.bookingItemId === 1 &&
      options?.unique === true,
  );
  assert.ok(taskIndex);
});
