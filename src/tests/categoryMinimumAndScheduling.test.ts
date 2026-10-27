import assert from 'node:assert/strict';
import {
  evaluateCategoryMinimums,
  assertBookNowFixedPriceMinimumCheckout,
  CategoryMinimumError,
  resolveEffectiveCategoryMinimum,
  type BookNowMinimumCheckoutLine,
  type CategoryMinimumConfig,
} from '../utils/bookNowFixedPriceMinimum';
import {
  collectCategoryBookNowSlotChecks,
  type BookNowSchedulableLine,
} from '../utils/bookNowScheduleResolution';

console.log('Running Category Minimum & Scheduling unit tests...');

// 1. Fallback & Configuration tests
// Case 1: Unconfigured category (missing/undefined config) defaults to fallback ₹199
assert.equal(resolveEffectiveCategoryMinimum(undefined), 199);
assert.equal(resolveEffectiveCategoryMinimum(null), 199);
assert.equal(resolveEffectiveCategoryMinimum({ categorySlug: 'test', minOrderValue: undefined, hasExplicitConfig: false }), 199);

// Case 2: Explicitly configured with zero minOrderValue
assert.equal(resolveEffectiveCategoryMinimum({ categorySlug: 'test', minOrderValue: 0, hasExplicitConfig: true }), 0);

// Case 3: Explicitly configured with positive value
assert.equal(resolveEffectiveCategoryMinimum({ categorySlug: 'test', minOrderValue: 299, hasExplicitConfig: true }), 299);

// Case 4: Invalid/malformed configuration (negative or NaN) defaults to fallback ₹199
assert.equal(resolveEffectiveCategoryMinimum({ categorySlug: 'test', minOrderValue: -50, hasExplicitConfig: true }), 199);
assert.equal(resolveEffectiveCategoryMinimum({ categorySlug: 'test', minOrderValue: NaN, hasExplicitConfig: true }), 199);

// 2. Category minimum pricing tests
const cleaningConfig: CategoryMinimumConfig = {
  categoryId: 'cat-cleaning-1',
  categorySlug: 'home-cleaning',
  categoryName: 'Home Cleaning',
  minOrderValue: 399,
  hasExplicitConfig: true,
};

const repairConfig: CategoryMinimumConfig = {
  categoryId: 'cat-repair-2',
  categorySlug: 'appliance-repair',
  categoryName: 'Appliance Repair',
  minOrderValue: 249,
  hasExplicitConfig: true,
};

const zeroMinConfig: CategoryMinimumConfig = {
  categoryId: 'cat-zero-3',
  categorySlug: 'zero-min-cat',
  categoryName: 'Zero Min Category',
  minOrderValue: 0,
  hasExplicitConfig: true,
};

const configs = new Map<string, CategoryMinimumConfig>([
  ['home-cleaning', cleaningConfig],
  ['appliance-repair', repairConfig],
  ['zero-min-cat', zeroMinConfig],
]);

// Test A: Below minimum in one category
const linesBelow: BookNowMinimumCheckoutLine[] = [
  { lineTotal: 200, categorySlug: 'home-cleaning' },
];
const evalBelow = evaluateCategoryMinimums(linesBelow, configs);
assert.equal(evalBelow.length, 1);
assert.equal(evalBelow[0].isMet, false);
assert.equal(evalBelow[0].shortfall, 199);
assert.equal(evalBelow[0].currentSubtotal, 200);

assert.throws(
  () => assertBookNowFixedPriceMinimumCheckout(linesBelow, configs),
  (err: any) => {
    assert.ok(err instanceof CategoryMinimumError);
    assert.equal(err.categorySlug, 'home-cleaning');
    assert.equal(err.minRequired, 399);
    assert.equal(err.shortfall, 199);
    return true;
  },
);

// Test B: Exactly equal to minimum
const linesExact: BookNowMinimumCheckoutLine[] = [
  { lineTotal: 399, categorySlug: 'home-cleaning' },
];
const evalExact = evaluateCategoryMinimums(linesExact, configs);
assert.equal(evalExact[0].isMet, true);
assert.equal(evalExact[0].shortfall, 0);
assert.doesNotThrow(() => assertBookNowFixedPriceMinimumCheckout(linesExact, configs));

// Test C: Above minimum
const linesAbove: BookNowMinimumCheckoutLine[] = [
  { lineTotal: 250, categorySlug: 'home-cleaning' },
  { lineTotal: 200, categorySlug: 'home-cleaning' },
];
const evalAbove = evaluateCategoryMinimums(linesAbove, configs);
assert.equal(evalAbove[0].isMet, true);
assert.equal(evalAbove[0].currentSubtotal, 450);
assert.equal(evalAbove[0].shortfall, 0);

// Test D: Deliberate Zero minimum allows checkout freely
const linesZero: BookNowMinimumCheckoutLine[] = [
  { lineTotal: 50, categorySlug: 'zero-min-cat' },
];
const evalZero = evaluateCategoryMinimums(linesZero, configs);
assert.equal(evalZero[0].isMet, true);
assert.equal(evalZero[0].minRequired, 0);
assert.equal(evalZero[0].shortfall, 0);
assert.doesNotThrow(() => assertBookNowFixedPriceMinimumCheckout(linesZero, configs));

// Test E: Unconfigured category falls back to 199 protection
const linesUnconfigured: BookNowMinimumCheckoutLine[] = [
  { lineTotal: 150, categorySlug: 'unconfigured-cat' },
];
const evalUnconfigured = evaluateCategoryMinimums(linesUnconfigured, configs);
assert.equal(evalUnconfigured[0].minRequired, 199);
assert.equal(evalUnconfigured[0].shortfall, 49);
assert.equal(evalUnconfigured[0].isMet, false);

// Test F: Two categories - combined passes 199 (400 total), but one fails its category minimum
const linesTwoCats: BookNowMinimumCheckoutLine[] = [
  { lineTotal: 350, categorySlug: 'home-cleaning' }, // fails 399 (shortfall 49)
  { lineTotal: 250, categorySlug: 'appliance-repair' }, // passes 249
];
const evalTwoCats = evaluateCategoryMinimums(linesTwoCats, configs);
assert.equal(evalTwoCats.length, 2);
const cleaningEval = evalTwoCats.find((e) => e.categorySlug === 'home-cleaning');
const repairEval = evalTwoCats.find((e) => e.categorySlug === 'appliance-repair');
assert.equal(cleaningEval?.isMet, false);
assert.equal(cleaningEval?.shortfall, 49);
assert.equal(repairEval?.isMet, true);

// 3. Category scheduling & combined duration tests
const slotA: BookNowSchedulableLine = {
  categorySlug: 'home-cleaning',
  durationMinutes: 45,
  quantity: 2, // 45 * 2 = 90 mins
  schedule: {
    scheduledDate: '2026-10-30',
    scheduledDateValue: new Date('2026-10-30T00:00:00Z'),
    scheduledTimeStart: '10:00 AM',
    timeSlot: 'morning',
    durationMinutes: 45,
  },
};

const slotB: BookNowSchedulableLine = {
  categorySlug: 'home-cleaning',
  durationMinutes: 30,
  quantity: 1, // 30 mins
  schedule: {
    scheduledDate: '2026-10-30',
    scheduledDateValue: new Date('2026-10-30T00:00:00Z'),
    scheduledTimeStart: '10:00 AM',
    timeSlot: 'morning',
    durationMinutes: 30,
  },
};

const slotC_DifferentCategory: BookNowSchedulableLine = {
  categorySlug: 'appliance-repair',
  durationMinutes: 60,
  quantity: 1,
  schedule: {
    scheduledDate: '2026-10-30',
    scheduledDateValue: new Date('2026-10-30T00:00:00Z'),
    scheduledTimeStart: '10:00 AM',
    timeSlot: 'morning',
    durationMinutes: 60,
  },
};

// When slotA and slotB are same category and same slot, durations combine (90 + 30 = 120 mins)
const combinedCleaningChecks = collectCategoryBookNowSlotChecks([slotA, slotB]);
assert.equal(combinedCleaningChecks.length, 1);
assert.equal(combinedCleaningChecks[0].durationMinutes, 120);

// When slotC is different category at the same slot, it has its own separate duration and check!
const multiCatChecks = collectCategoryBookNowSlotChecks([slotA, slotB, slotC_DifferentCategory]);
assert.equal(multiCatChecks.length, 2);
const cleaningCheck = multiCatChecks.find((c) => c.durationMinutes === 120);
const repairCheck = multiCatChecks.find((c) => c.durationMinutes === 60);
assert.ok(cleaningCheck, 'Cleaning check must have combined 120 mins duration');
assert.ok(repairCheck, 'Repair check must have independent 60 mins duration');


// Test G: Subcategories under 'home-cleaning' (full-house + kitchen) pool together towards parent minimum
const subcategoryLines: BookNowMinimumCheckoutLine[] = [
  { lineTotal: 2199, categorySlug: 'full-house' },
  { lineTotal: 999, categorySlug: 'kitchen' },
];
const homeCleaningMin5000 = new Map<string, CategoryMinimumConfig>([
  ['home-cleaning', {
    categoryId: 'cat-cleaning-5000',
    categorySlug: 'home-cleaning',
    categoryName: 'Home Cleaning',
    minOrderValue: 5000,
    hasExplicitConfig: true,
  }],
]);
const subcatEval = evaluateCategoryMinimums(subcategoryLines, homeCleaningMin5000);
assert.equal(subcatEval.length, 1, 'full-house and kitchen must group into 1 parent Home Cleaning evaluation');
assert.equal(subcatEval[0].categorySlug, 'home-cleaning');
assert.equal(subcatEval[0].currentSubtotal, 3198);
assert.equal(subcatEval[0].minRequired, 5000);
assert.equal(subcatEval[0].shortfall, 1802);
assert.equal(subcatEval[0].isMet, false);

// Adding another service in home-cleaning to meet 5000
const subcategoryLinesMet: BookNowMinimumCheckoutLine[] = [
  { lineTotal: 2199, categorySlug: 'full-house' },
  { lineTotal: 999, categorySlug: 'kitchen' },
  { lineTotal: 2000, categorySlug: 'bathroom' },
];
const subcatEvalMet = evaluateCategoryMinimums(subcategoryLinesMet, homeCleaningMin5000);
assert.equal(subcatEvalMet.length, 1);
assert.equal(subcatEvalMet[0].currentSubtotal, 5198);
assert.equal(subcatEvalMet[0].shortfall, 0);
assert.equal(subcatEvalMet[0].isMet, true);
assert.doesNotThrow(() => assertBookNowFixedPriceMinimumCheckout(subcategoryLinesMet, homeCleaningMin5000));

// Test H: Personal Assistance, Hourly Helper, and Painting enforce explicit configured minimums
const customMinimumConfigs = new Map<string, CategoryMinimumConfig>([
  ['personal-assistance', {
    categorySlug: 'personal-assistance',
    categoryName: 'Personal Assistance',
    minOrderValue: 1000,
    hasExplicitConfig: true,
  }],
  ['hourly-helper', {
    categorySlug: 'hourly-helper',
    categoryName: 'Hourly Helper',
    minOrderValue: 500,
    hasExplicitConfig: true,
  }],
  ['painting', {
    categorySlug: 'painting',
    categoryName: 'Painting',
    minOrderValue: 1000,
    hasExplicitConfig: true,
  }],
]);

// Personal Assistance under 1000 fails
const paEval = evaluateCategoryMinimums([{ lineTotal: 149, categorySlug: 'personal-assistance' }], customMinimumConfigs);
assert.equal(paEval.length, 1);
assert.equal(paEval[0].isMet, false);
assert.equal(paEval[0].minRequired, 1000);
assert.equal(paEval[0].shortfall, 851);
assert.throws(() => assertBookNowFixedPriceMinimumCheckout([{ lineTotal: 149, categorySlug: 'personal-assistance' }], customMinimumConfigs));

// Hourly Helper under 500 fails
const hourlyEval = evaluateCategoryMinimums([{ lineTotal: 99, categorySlug: 'hourly-helper' }], customMinimumConfigs);
assert.equal(hourlyEval.length, 1);
assert.equal(hourlyEval[0].isMet, false);
assert.equal(hourlyEval[0].minRequired, 500);
assert.equal(hourlyEval[0].shortfall, 401);
assert.throws(() => assertBookNowFixedPriceMinimumCheckout([{ lineTotal: 99, categorySlug: 'hourly-helper' }], customMinimumConfigs));

// Painting under 1000 fails
const paintingEval = evaluateCategoryMinimums([{ lineTotal: 99, categorySlug: 'painting' }], customMinimumConfigs);
assert.equal(paintingEval.length, 1);
assert.equal(paintingEval[0].isMet, false);
assert.equal(paintingEval[0].minRequired, 1000);
assert.equal(paintingEval[0].shortfall, 901);
assert.throws(() => assertBookNowFixedPriceMinimumCheckout([{ lineTotal: 99, categorySlug: 'painting' }], customMinimumConfigs));

// When unconfigured, all three default to 0 min and pass without throwing
const emptyConfigs = new Map<string, CategoryMinimumConfig>();
const unconfigPaEval = evaluateCategoryMinimums([{ lineTotal: 149, categorySlug: 'personal-assistance' }], emptyConfigs);
assert.equal(unconfigPaEval[0].minRequired, 0);
assert.equal(unconfigPaEval[0].isMet, true);
assert.doesNotThrow(() => assertBookNowFixedPriceMinimumCheckout([{ lineTotal: 149, categorySlug: 'personal-assistance' }], emptyConfigs));

console.log('✅ All Category Minimum & Scheduling unit tests passed successfully!');
