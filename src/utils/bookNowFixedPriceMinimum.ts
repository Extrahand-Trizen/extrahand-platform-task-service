import {
  BOOK_NOW_FIXED_PRICE_MIN_CHECKOUT_RUPEES,
  BOOK_NOW_MIN_CHECKOUT_NOT_MET_CODE,
} from '../constants/bookNowCheckout';
import { PERSONAL_ASSISTANT_CATEGORY_SLUG } from '../constants/personalAssistantBooking';
import { BadRequestError } from '../errors/AppError';
import { isHourlyResolvedLine } from './hourlyBookingGuards';
import { isPaintingBookNowCheckoutLine } from './bookNowServiceFlowConfig';

export type BookNowMinimumCheckoutLine = {
  lineTotal: number;
  categorySlug?: string;
  catalogId?: string;
  packageId?: string;
  packageSlug?: string;
  pricingUnit?: string;
  serviceFlowType?: string;
  bookingKind?: string;
  serviceType?: string;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isPersonalAssistantResolvedLine(line: {
  categorySlug?: string;
}): boolean {
  const slug = String(line.categorySlug || '')
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, '-');
  return slug === PERSONAL_ASSISTANT_CATEGORY_SLUG;
}

/** Hourly Helper, Personal Assistant, and painting consultation checkouts skip the fixed-price minimum. */
export function shouldSkipBookNowFixedPriceMinimum(
  lines: BookNowMinimumCheckoutLine[],
): boolean {
  if (lines.length === 0) return true;
  return lines.every(
    (line) =>
      isHourlyResolvedLine(line) ||
      isPersonalAssistantResolvedLine(line) ||
      isPaintingBookNowCheckoutLine(line),
  );
}

export function getBookNowFixedPriceMinimumShortfall(
  lines: BookNowMinimumCheckoutLine[],
  minimumRupees: number = BOOK_NOW_FIXED_PRICE_MIN_CHECKOUT_RUPEES,
): number {
  if (shouldSkipBookNowFixedPriceMinimum(lines)) return 0;
  const serviceSubtotal = roundCurrency(
    lines.reduce((sum, line) => sum + Math.max(0, Number(line.lineTotal || 0)), 0),
  );
  return Math.max(0, roundCurrency(minimumRupees - serviceSubtotal));
}

export function assertBookNowFixedPriceMinimumCheckout(
  lines: BookNowMinimumCheckoutLine[],
  minimumRupees: number = BOOK_NOW_FIXED_PRICE_MIN_CHECKOUT_RUPEES,
): void {
  const shortfall = getBookNowFixedPriceMinimumShortfall(lines, minimumRupees);
  if (shortfall <= 0) return;

  throw new BadRequestError(
    `Minimum order value is ₹${minimumRupees}. Add ₹${shortfall} more to continue.`,
    BOOK_NOW_MIN_CHECKOUT_NOT_MET_CODE,
  );
}
