/**
 * Hardcoded Hourly Helper cancellation policy constants.
 * Not remote-configurable — change values here only.
 */

export const HOURLY_CANCELLATION_POLICY = {
  /** Free cancel if more than this many minutes before scheduled start. */
  FREE_WINDOW_MINUTES: 120,
  /** F lat late fee before arrival (paise). Clamped to paid amount. */
  LATE_CANCEL_FEE_PAISE: 4900,
  /**
   * After helper arrived (OTP not verified): charge first-hour rate.
   * Effective fee = min(firstHourRatePaise, paidAmountPaise).
   */
  POST_ARRIVAL: 'FIRST_HOUR' as const,
} as const;
