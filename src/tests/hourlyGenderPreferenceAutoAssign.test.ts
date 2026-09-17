import assert from 'node:assert/strict';
import {
  isHourlyTask,
} from '../services/BookNowAutoAssignService';

// Test 1: Verify isHourlyTask identifies all hourly variations
const hourlySlugTask = { categorySlug: 'hourly-helper' } as any;
const hourlyBasedSlugTask = { categorySlug: 'hourly-based' } as any;
const hourlyCategoryTask = { category: 'hourly-based' } as any;
const hourlyBudgetTypeTask = { budget: { type: 'hourly', amount: 200 } } as any;
const hourlyFlagTask = { hourlyHelper: true } as any;
const regularCleaningTask = { categorySlug: 'cleaning', category: 'cleaning', budget: { type: 'fixed', amount: 500 } } as any;

assert.strictEqual(isHourlyTask(hourlySlugTask), true, 'hourly-helper slug should be hourly');
assert.strictEqual(isHourlyTask(hourlyBasedSlugTask), true, 'hourly-based slug should be hourly');
assert.strictEqual(isHourlyTask(hourlyCategoryTask), true, 'hourly-based category should be hourly');
assert.strictEqual(isHourlyTask(hourlyBudgetTypeTask), true, 'hourly budget type should be hourly');
assert.strictEqual(isHourlyTask(hourlyFlagTask), true, 'hourlyHelper flag should be hourly');
assert.strictEqual(isHourlyTask(regularCleaningTask), false, 'regular cleaning should not be hourly');

console.log('✅ Test 1 Passed: isHourlyTask identifies all hourly variants');

// Test 2: Verify strict gender filtering behavior
interface MockPartner {
  uid: string;
  name: string;
  gender: string | null;
  distKm: number;
}

function simulateHourlyPartnerSelection(
  task: any,
  partners: MockPartner[],
): MockPartner | null {
  const isHourly = isHourlyTask(task);
  const rawPref = String(task.preferredHelperGender || '').trim().toLowerCase();
  const preferredGender = rawPref === 'female' || rawPref === 'woman' ? 'female' : rawPref === 'male' || rawPref === 'man' ? 'male' : null;

  const eligible = partners.filter((p) => {
    if (isHourly && preferredGender) {
      const pGender = p.gender ? p.gender.toLowerCase() : null;
      return pGender === preferredGender;
    }
    return true;
  });

  if (eligible.length === 0) return null;

  eligible.sort((a, b) => a.distKm - b.distKm);
  return eligible[0];
}

const maleNear: MockPartner = { uid: 'u1', name: 'Ravi M.', gender: 'male', distKm: 1.0 };
const femaleFar: MockPartner = { uid: 'u2', name: 'Sunita F.', gender: 'female', distKm: 3.5 };
const maleFar: MockPartner = { uid: 'u3', name: 'Kiran M.', gender: 'male', distKm: 4.0 };

// Scenario A: Hourly task + customer chooses 'female' -> must assign female partner only, even if male is closer
const taskFemalePref = {
  categorySlug: 'hourly-based',
  preferredHelperGender: 'female',
};
const resultA = simulateHourlyPartnerSelection(taskFemalePref, [maleNear, femaleFar]);
assert.ok(resultA, 'Should find female partner');
assert.strictEqual(resultA?.uid, 'u2', 'Must assign female partner Sunita F.');
assert.strictEqual(resultA?.gender, 'female');

// Scenario B: Hourly task + customer chooses 'female' -> if NO female partner exists, must return null (NEVER assign male)
const resultB = simulateHourlyPartnerSelection(taskFemalePref, [maleNear, maleFar]);
assert.strictEqual(resultB, null, 'Must return null when no female partner exists for female preference');

// Scenario C: Hourly task + customer chooses 'male' -> must assign male partner only, even if female is closer
const femaleNear: MockPartner = { uid: 'u4', name: 'Priya F.', gender: 'female', distKm: 0.8 };
const taskMalePref = {
  categorySlug: 'hourly-based',
  preferredHelperGender: 'male',
};
const resultC = simulateHourlyPartnerSelection(taskMalePref, [femaleNear, maleNear]);
assert.ok(resultC, 'Should find male partner');
assert.strictEqual(resultC?.uid, 'u1', 'Must assign male partner Ravi M.');
assert.strictEqual(resultC?.gender, 'male');

// Scenario D: Hourly task + customer chooses 'male' -> if NO male partner exists, must return null (NEVER assign female)
const resultD = simulateHourlyPartnerSelection(taskMalePref, [femaleNear, femaleFar]);
assert.strictEqual(resultD, null, 'Must return null when no male partner exists for male preference');

// Scenario E: Hourly task + customer chooses 'any' or not specified -> assigns nearest partner regardless of gender
const taskAnyPref = {
  categorySlug: 'hourly-based',
  preferredHelperGender: 'any',
};
const resultE = simulateHourlyPartnerSelection(taskAnyPref, [femaleNear, maleNear]);
assert.strictEqual(resultE?.uid, 'u4', 'Should assign nearest partner (femaleNear at 0.8km)');

const taskNoPref = {
  categorySlug: 'hourly-based',
};
const resultF = simulateHourlyPartnerSelection(taskNoPref, [femaleNear, maleNear]);
assert.strictEqual(resultF?.uid, 'u4', 'Should assign nearest partner (femaleNear at 0.8km)');

console.log('✅ Test 2 Passed: Strict gender filtering matches all scenarios perfectly');
console.log('hourlyGenderPreferenceAutoAssign.test.ts passed');
