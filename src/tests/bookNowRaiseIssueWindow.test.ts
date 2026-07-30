/**
 * Unit tests for Book Now 1-hour raise-issue window (firstCompletedAt clock).
 * Run: npx ts-node src/tests/bookNowRaiseIssueWindow.test.ts
 */
import assert from 'assert';
import {
  BOOK_NOW_RAISE_ISSUE_WINDOW_MS,
  assertBookNowRaiseIssueAllowed,
  canBookNowRaiseIssue,
  getBookNowRaiseIssueRemainingMs,
} from '../utils/bookNowRaiseIssueWindow';

const HOUR = BOOK_NOW_RAISE_ISSUE_WINDOW_MS;

function testWithinWindow() {
  const firstCompletedAt = new Date(Date.now() - 30 * 60 * 1000);
  const task = {
    bookingSource: 'book_now' as const,
    status: 'completed',
    firstCompletedAt,
    completedAt: new Date(),
  };
  assert.strictEqual(canBookNowRaiseIssue(task), true);
  assert.ok(getBookNowRaiseIssueRemainingMs(task) > 0);
  assert.doesNotThrow(() => assertBookNowRaiseIssueAllowed(task));
}

function testOutsideWindow() {
  const firstCompletedAt = new Date(Date.now() - HOUR - 60_000);
  const task = {
    bookingSource: 'book_now' as const,
    status: 'completed',
    firstCompletedAt,
    completedAt: new Date(), // re-complete does not reset the clock
  };
  assert.strictEqual(canBookNowRaiseIssue(task), false);
  assert.strictEqual(getBookNowRaiseIssueRemainingMs(task), 0);
  assert.throws(() => assertBookNowRaiseIssueAllowed(task), /1-hour window/);
}

function testRecompleteDoesNotResetClock() {
  const firstCompletedAt = new Date(Date.now() - 50 * 60 * 1000);
  const task = {
    bookingSource: 'book_now' as const,
    status: 'completed',
    firstCompletedAt,
    completedAt: new Date(), // just re-completed after revision
  };
  const remaining = getBookNowRaiseIssueRemainingMs(task);
  assert.ok(remaining > 0 && remaining <= 10 * 60 * 1000 + 1000);
}

function testLegacyFallbackToCompletedAt() {
  const completedAt = new Date(Date.now() - 20 * 60 * 1000);
  const task = {
    bookingSource: 'book_now' as const,
    status: 'completed',
    completedAt,
  };
  assert.strictEqual(canBookNowRaiseIssue(task), true);
}

function testLegacyReviewAllowed() {
  const task = {
    bookingSource: 'book_now' as const,
    status: 'review',
  };
  assert.strictEqual(canBookNowRaiseIssue(task), true);
  assert.doesNotThrow(() => assertBookNowRaiseIssueAllowed(task));
}

function testMarketplaceIgnored() {
  const task = {
    bookingSource: 'marketplace' as const,
    status: 'completed',
    firstCompletedAt: new Date(),
    completedAt: new Date(),
  };
  assert.strictEqual(canBookNowRaiseIssue(task), false);
}

testWithinWindow();
testOutsideWindow();
testRecompleteDoesNotResetClock();
testLegacyFallbackToCompletedAt();
testLegacyReviewAllowed();
testMarketplaceIgnored();
console.log('bookNowRaiseIssueWindow.test.ts: all tests passed');
