/**
 * Phone number detection utility
 *
 * Detects phone numbers in various formats — including obfuscated ones — to
 * prevent users from exchanging contact details outside the platform and
 * bypassing payment protection.
 *
 * Patterns covered:
 *   9876543210           — 10+ consecutive digits
 *   98765-43210          — digits separated by dashes
 *   +91 98765 43210      — country code with spaces
 *   (987) 654-3210       — bracketed area code
 *   98 76 54 32 10       — digit pairs spaced out
 *   9.8.7.6.5.4.3.2.1.0 — dots as separators
 *   9 8 7 6 5 4 3 2 1 0 — single digits spaced (evasion attempt)
 *   9-8-7-6-5-4-3-2-1-0 — single digits dashed (evasion attempt)
 */
export function containsPhoneNumber(text: string): boolean {
  if (!text || text.length < 7) return false;

  // Pattern 1: 10 or more raw consecutive digits — unambiguous phone number
  if (/\d{10,}/.test(text)) return true;

  // Pattern 2: Digit groups joined by common separators that yield ≥9 digits total.
  // Threshold of 9 avoids false positives from 8-digit date strings like "20260306".
  const segmentMatches = text.match(/(?:\+?\d[\d\s\-\.\(\)\/]{7,}\d)/g);
  if (segmentMatches) {
    for (const match of segmentMatches) {
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 9) return true;
    }
  }

  // Pattern 3: Single digits each separated by whitespace ("9 8 7 6 5 4 3 2 1 0").
  // Requires 8+ such single-digit tokens (= 8-digit number minimum).
  if (/(?<!\d)\d(?:\s+\d){7,}(?!\d)/.test(text)) return true;

  return false;
}

export const PHONE_NUMBER_ERROR =
  'Contact numbers are not allowed. Use ExtraHand\'s built-in messaging to communicate safely and keep your payment protected.';
