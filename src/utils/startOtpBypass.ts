/**
 * Allowlisted fixed OTP for test/review performers (no prior send required).
 *
 * TASK_START_DUMMY_OTP=123123
 * TASK_START_OTP_BYPASS_UIDS=firebaseUid1,firebaseUid2
 *
 * Non-production: allowed when dummy + bypass list are set.
 * Production: also requires ALLOW_TASK_START_DUMMY_OTP=true.
 */

import { config } from '../config/env';

function parseUidList(raw: string | undefined): Set<string> {
  if (raw == null || !String(raw).trim()) return new Set();
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function isStartOtpDummyBypassEnabled(): boolean {
  if (config.NODE_ENV !== 'production') return true;
  return config.ALLOW_TASK_START_DUMMY_OTP === true;
}

export function acceptsStartOtpDummyCode(
  performerUid: string | undefined | null,
  otpDigits: string
): boolean {
  if (!performerUid || String(performerUid).trim() === '') return false;
  if (!isStartOtpDummyBypassEnabled()) return false;

  const dummy = String(config.TASK_START_DUMMY_OTP ?? '').replace(/\D/g, '');
  if (dummy.length !== 6) return false;
  if (otpDigits !== dummy) return false;

  const allow = parseUidList(config.TASK_START_OTP_BYPASS_UIDS);
  if (allow.size === 0) return false;

  return allow.has(String(performerUid).trim());
}
