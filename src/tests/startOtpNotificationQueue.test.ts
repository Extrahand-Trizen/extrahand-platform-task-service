import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStartOtpNotificationJobKey,
  startOtpNotificationRetryDelayMs,
} from '../services/TaskStartOtpNotificationQueue';

test('start OTP notification job keys are stable for the same task issuance', () => {
  const requestedAt = new Date('2026-09-01T10:00:00.000Z');
  assert.equal(
    createStartOtpNotificationJobKey('task-1', requestedAt),
    createStartOtpNotificationJobKey('task-1', requestedAt),
  );
  assert.notEqual(
    createStartOtpNotificationJobKey('task-1', requestedAt),
    createStartOtpNotificationJobKey('task-2', requestedAt),
  );
});

test('start OTP notification retries use bounded exponential backoff', () => {
  assert.equal(startOtpNotificationRetryDelayMs(1), 1_000);
  assert.equal(startOtpNotificationRetryDelayMs(3), 4_000);
  assert.equal(startOtpNotificationRetryDelayMs(20), 60_000);
});
