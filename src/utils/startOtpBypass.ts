/**
 * When the *poster* (task requester) is a test account, assignees can start with fixed OTP.
 *
 * TASK_START_OTP_BYPASS_UIDS = comma-separated poster Firebase UIDs.
 * If poster's uid is in that list, assignee may enter POSTER_DUMMY_START_OTP (no prior send required).
 *
 * Leave TASK_START_OTP_BYPASS_UIDS unset in production → normal OTP only.
 */

import { config } from '../config/env';

export const POSTER_DUMMY_START_OTP = '123123';

function parseUidList(raw: string | undefined): Set<string> {
  if (raw == null || !String(raw).trim()) return new Set();
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** True if poster Firebase uid is allowlisted and OTP matches dummy code. */
export function acceptsPosterDummyStartOtp(
  posterFirebaseUid: string | undefined | null,
  otpDigits: string
): boolean {
  const allow = parseUidList(config.TASK_START_OTP_BYPASS_UIDS);
  if (allow.size === 0) return false;

  if (!posterFirebaseUid || String(posterFirebaseUid).trim() === '') return false;
  if (!allow.has(String(posterFirebaseUid).trim())) return false;

  return otpDigits === POSTER_DUMMY_START_OTP;
}
