/**
 * Unit tests for customer cancellation notification payload formatting and event keys.
 * Run: npx ts-node src/tests/taskCancellationPartnerNotify.test.ts
 */
import assert from 'assert';
import { NOTIFICATION_EVENT_KEYS } from '../constants/notifications';

function formatCancellationCopy(title?: string) {
  const cancelTitle = 'Work cancelled';
  const taskTitle = (title || '').trim();
  const cancelTaskTitle = taskTitle || 'your work';
  const cancelBody = taskTitle
    ? `Customer cancelled this work: "${taskTitle}".`
    : 'Customer cancelled this work.';

  return { cancelTitle, cancelTaskTitle, cancelBody };
}

function testFormattedCopy() {
  const withTitle = formatCancellationCopy('Deep Cleaning Service');
  assert.strictEqual(withTitle.cancelTitle, 'Work cancelled');
  assert.strictEqual(withTitle.cancelTaskTitle, 'Deep Cleaning Service');
  assert.strictEqual(withTitle.cancelBody, 'Customer cancelled this work: "Deep Cleaning Service".');

  const withoutTitle = formatCancellationCopy('');
  assert.strictEqual(withoutTitle.cancelTitle, 'Work cancelled');
  assert.strictEqual(withoutTitle.cancelTaskTitle, 'your work');
  assert.strictEqual(withoutTitle.cancelBody, 'Customer cancelled this work.');
}

function testNotificationEventKey() {
  assert.strictEqual(NOTIFICATION_EVENT_KEYS.TASK_CANCELLED_HELPER, 'TASK_CANCELLED_HELPER');
}

testFormattedCopy();
testNotificationEventKey();
console.log('taskCancellationPartnerNotify.test.ts: all tests passed');
