import { resolveParentCategory } from './bookNowClientCatalog';
import {
  BOOK_NOW_FIXED_PRICE_MIN_CHECKOUT_RUPEES,
  BOOK_NOW_MIN_CHECKOUT_NOT_MET_CODE,
  CATEGORY_MINIMUM_NOT_MET_CODE,
} from '../constants/bookNowCheckout';
import { PERSONAL_ASSISTANT_CATEGORY_SLUG } from '../constants/personalAssistantBooking';
import { BadRequestError } from '../errors/AppError';
import { isHourlyResolvedLine } from './hourlyBookingGuards';
import { isPaintingBookNowCheckoutLine } from './bookNowServiceFlowConfig';
import { DAILY_LABOUR_CATEGORY } from '../constants/dailyLabour';

export type BookNowMinimumCheckoutLine = {
  lineTotal: number;
  categorySlug?: string;
  categoryId?: string;
  catalogId?: string;
  packageId?: string;
  packageSlug?: string;
  pricingUnit?: string;
  serviceFlowType?: string;
  bookingKind?: string;
  serviceType?: string;
};

export type CategoryMinimumConfig = {
  categoryId?: string;
  categorySlug: string;
  categoryName?: string;
  minOrderValue?: number | null;
  hasExplicitConfig?: boolean;
};

export type CategoryMinimumEvaluation = {
  categoryId?: string;
  categorySlug: string;
  categoryName?: string;
  minRequired: number;
  currentSubtotal: number;
  shortfall: number;
  isMet: boolean;
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

export function isDailyLabourResolvedLine(line: {
  categorySlug?: string;
}): boolean {
  const slug = String(line.categorySlug || '')
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, '-');
  return slug === DAILY_LABOUR_CATEGORY.slug;
}

/** Check if an individual line is exempt from fixed-price category minimum rules. */
export function isLineExemptFromMinimum(line: BookNowMinimumCheckoutLine): boolean {
  return (
    isHourlyResolvedLine(line) ||
    isPersonalAssistantResolvedLine(line) ||
    isPaintingBookNowCheckoutLine(line) ||
    isDailyLabourResolvedLine(line)
  );
}

/** Hourly Helper, Personal Assistant, painting consultation, and Daily Labour checkouts skip the fixed-price minimum. */
export function shouldSkipBookNowFixedPriceMinimum(
  lines: BookNowMinimumCheckoutLine[],
): boolean {
  if (lines.length === 0) return true;
  return lines.every(isLineExemptFromMinimum);
}

/** Legacy / global fallback shortfall */
export function getBookNowFixedPriceMinimumShortfall(
  lines: BookNowMinimumCheckoutLine[],
  minimumRupees: number = BOOK_NOW_FIXED_PRICE_MIN_CHECKOUT_RUPEES,
): number {
  if (shouldSkipBookNowFixedPriceMinimum(lines)) return 0;
  const eligibleLines = lines.filter((line) => !isLineExemptFromMinimum(line));
  const serviceSubtotal = roundCurrency(
    eligibleLines.reduce((sum, line) => sum + Math.max(0, Number(line.lineTotal || 0)), 0),
  );
  return Math.max(0, roundCurrency(minimumRupees - serviceSubtotal));
}

/**
 * Resolve effective minimum for a category:
 * 1. If explicit config exists and is a valid finite non-negative number:
 *    - Use that value (e.g. 0 allows checkout with no minimum; 250 requires ₹250).
 * 2. If unconfigured, missing, null, undefined, or invalid (negative / NaN):
 *    - Fall back to the existing ₹199 safeguard.
 */
export function resolveEffectiveCategoryMinimum(
  config?: CategoryMinimumConfig | null,
  globalFallback: number = BOOK_NOW_FIXED_PRICE_MIN_CHECKOUT_RUPEES,
): number {
  if (
    config &&
    config.hasExplicitConfig &&
    typeof config.minOrderValue === 'number' &&
    Number.isFinite(config.minOrderValue) &&
    config.minOrderValue >= 0
  ) {
    return roundCurrency(config.minOrderValue);
  }
  return globalFallback;
}

/** Evaluate minimum pricing per category */
export function evaluateCategoryMinimums(
  lines: BookNowMinimumCheckoutLine[],
  categoryConfigs: Map<string, CategoryMinimumConfig> | Record<string, CategoryMinimumConfig>,
): CategoryMinimumEvaluation[] {
  const configMap =
    categoryConfigs instanceof Map
      ? categoryConfigs
      : new Map(Object.entries(categoryConfigs));

  if (lines.length === 0) return [];

  const grouped = new Map<string, { lines: BookNowMinimumCheckoutLine[]; subtotal: number }>();

  for (const line of lines) {
    const rawKey = String(line.categorySlug || line.catalogId || 'unknown').trim().toLowerCase();
    const parent = resolveParentCategory(rawKey);
    const key = parent.slug;
    const existing = grouped.get(key) || { lines: [], subtotal: 0 };
    existing.lines.push(line);
    existing.subtotal = roundCurrency(existing.subtotal + Math.max(0, Number(line.lineTotal || 0)));
    grouped.set(key, existing);
  }

  const evaluations: CategoryMinimumEvaluation[] = [];

  for (const [key, group] of grouped.entries()) {
    const config = configMap.get(key) ||
      [...configMap.values()].find((c) => c.categorySlug === key || c.categoryId === key) ||
      group.lines.map((l) => configMap.get(String(l.categorySlug || l.catalogId || ''))).find(Boolean);

    const isExemptFromGlobal = group.lines.every(isLineExemptFromMinimum);
    const minRequired =
      config && config.hasExplicitConfig && typeof config.minOrderValue === 'number' && Number.isFinite(config.minOrderValue) && config.minOrderValue >= 0
        ? roundCurrency(config.minOrderValue)
        : isExemptFromGlobal
          ? 0
          : BOOK_NOW_FIXED_PRICE_MIN_CHECKOUT_RUPEES;

    const shortfall = Math.max(0, roundCurrency(minRequired - group.subtotal));

    evaluations.push({
      categoryId: config?.categoryId,
      categorySlug: key,
      categoryName: config?.categoryName || resolveParentCategory(key).label || key,
      minRequired,
      currentSubtotal: group.subtotal,
      shortfall,
      isMet: shortfall === 0,
    });
  }

  return evaluations;
}

export class CategoryMinimumError extends BadRequestError {
  categoryId?: string;
  categoryName?: string;
  categorySlug: string;
  minRequired: number;
  currentSubtotal: number;
  shortfall: number;

  constructor(evaluation: CategoryMinimumEvaluation) {
    super(
      `Minimum order value for ${evaluation.categoryName || evaluation.categorySlug} is ₹${evaluation.minRequired}. Add ₹${evaluation.shortfall} more to continue.`,
      CATEGORY_MINIMUM_NOT_MET_CODE,
    );
    this.categoryId = evaluation.categoryId;
    this.categoryName = evaluation.categoryName;
    this.categorySlug = evaluation.categorySlug;
    this.minRequired = evaluation.minRequired;
    this.currentSubtotal = evaluation.currentSubtotal;
    this.shortfall = evaluation.shortfall;
  }
}

export function assertBookNowFixedPriceMinimumCheckout(
  lines: BookNowMinimumCheckoutLine[],
  categoryConfigs?: Map<string, CategoryMinimumConfig> | Record<string, CategoryMinimumConfig>,
  minimumRupees: number = BOOK_NOW_FIXED_PRICE_MIN_CHECKOUT_RUPEES,
): void {
  if (categoryConfigs) {
    const evaluations = evaluateCategoryMinimums(lines, categoryConfigs);
    const failed = evaluations.find((e) => !e.isMet);
    if (failed) {
      throw new CategoryMinimumError(failed);
    }
    return;
  }

  // Fallback to global checkout minimum check
  const shortfall = getBookNowFixedPriceMinimumShortfall(lines, minimumRupees);
  if (shortfall <= 0) return;

  throw new BadRequestError(
    `Minimum order value is ₹${minimumRupees}. Add ₹${shortfall} more to continue.`,
    BOOK_NOW_MIN_CHECKOUT_NOT_MET_CODE,
  );
}
