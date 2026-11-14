import assert from 'node:assert/strict';
import {
  isHomeCleaningTask,
  partnerCategoryMatchesBookNowTask,
} from '../services/partnerVisibility';

const paintingConsultationTask = {
  category: 'other',
  categorySlug: 'painting',
  subcategory: 'painting-consultation-interior-1-room',
  serviceType: 'painting',
  serviceFlowType: 'consultation_project',
  bookingKind: 'consultation',
};

assert.equal(
  partnerCategoryMatchesBookNowTask(['painting'], paintingConsultationTask),
  true,
);
assert.equal(
  partnerCategoryMatchesBookNowTask([{ id: 'painting' }], paintingConsultationTask),
  true,
);
assert.equal(
  partnerCategoryMatchesBookNowTask(['interior-painting'], paintingConsultationTask),
  true,
);
assert.equal(
  partnerCategoryMatchesBookNowTask(['electrician'], paintingConsultationTask),
  false,
);

const dailyLabourTask = {
  category: 'other',
  categorySlug: 'daily-labour',
};
assert.equal(partnerCategoryMatchesBookNowTask(['other'], dailyLabourTask), false);
assert.equal(partnerCategoryMatchesBookNowTask(['daily-labour'], dailyLabourTask), true);
assert.equal(partnerCategoryMatchesBookNowTask(['cleaning'], dailyLabourTask), false);

const repairCategoryCases = [
  ['plumbing', 'plumbing-waste-pipe-installation', 'plumbing'],
  ['electrician', 'electrician-wiring', 'electrician'],
  ['carpentry', 'carpentry-furniture', 'carpenter'],
  ['ac_service', 'ac-services', 'ac-service'],
  ['appliance_repair', 'appliance-repair', 'appliance-repair-services'],
] as const;

for (const [partnerCategory, categorySlug, label] of repairCategoryCases) {
  const task = { category: 'repair', categorySlug, categoryLabel: label };
  assert.equal(
    partnerCategoryMatchesBookNowTask([partnerCategory], task),
    true,
    `${partnerCategory} should match its specific repair category`,
  );
  for (const [otherPartnerCategory] of repairCategoryCases) {
    if (otherPartnerCategory === partnerCategory) continue;
    assert.equal(
      partnerCategoryMatchesBookNowTask([otherPartnerCategory], task),
      false,
      `${otherPartnerCategory} should not match ${categorySlug}`,
    );
  }
}

assert.equal(
  partnerCategoryMatchesBookNowTask(['electrician'], { category: 'repair' }),
  false,
  'A broad repair task must not be sent to a service-specific partner without a matching category',
);
assert.equal(
  partnerCategoryMatchesBookNowTask(['repair'], { category: 'repair' }),
  true,
  'A broadly categorized repair partner may match a broad repair task',
);
assert.equal(
  partnerCategoryMatchesBookNowTask(['security-patrol'], {
    category: 'other',
    categorySlug: 'security-patrol',
  }),
  true,
  'Unmapped specific categories should still match partners registered under the same category',
);
assert.equal(
  partnerCategoryMatchesBookNowTask(['other'], {
    category: 'other',
    categorySlug: 'security-patrol',
  }),
  false,
  'Unmapped specific categories must not fall back to the broad other category',
);

const sharedTaskCategoryCases = [
  ['cleaning', 'full-house', 'cleaning', 'car_wash'],
  ['car_wash', 'car-wash-basic', 'cleaning', 'laundry'],
  ['laundry', 'laundry-wash-by-weight', 'cleaning', 'car_wash'],
  ['painting', 'painting-interior', 'other', 'pest_control'],
  ['pest_control', 'pest-control-termite', 'other', 'painting'],
  ['beauty_services', 'womens-beauty', 'other', 'professional_services'],
  ['delivery_logistics', 'delivery-logistics', 'delivery', 'driving'],
  ['driving', 'driver-chauffeur', 'delivery', 'delivery_logistics'],
] as const;

for (const [partnerCategory, categorySlug, category, otherPartnerCategory] of sharedTaskCategoryCases) {
  const task = { category, categorySlug };
  assert.equal(
    partnerCategoryMatchesBookNowTask([partnerCategory], task),
    true,
    `${partnerCategory} should match ${categorySlug}`,
  );
  assert.equal(
    partnerCategoryMatchesBookNowTask([otherPartnerCategory], task),
    false,
    `${otherPartnerCategory} should not match ${categorySlug}`,
  );
}

for (const [partnerCategory, categorySlug] of [
  ['laundry', 'laundry-wash-by-weight'],
  ['car_wash', 'car-wash-basic'],
]) {
  assert.equal(
    partnerCategoryMatchesBookNowTask([partnerCategory], {
      category: 'cleaning',
      categorySlug,
    }),
    true,
    `${partnerCategory} should match its Book Now service`,
  );
  assert.equal(
    partnerCategoryMatchesBookNowTask(['electrician'], {
      category: 'cleaning',
      categorySlug,
    }),
    false,
    `electrician should not match ${categorySlug}`,
  );
}

const bathroomCleaningTask = {
  category: 'cleaning',
  categorySlug: 'cleaning-bathroom',
  categoryLabel: 'Bathroom Cleaning',
};
const fullHouseCleaningTask = {
  category: 'cleaning',
  categorySlug: 'full-house-cleaning',
  categoryLabel: 'Full House Cleaning',
};

for (const partnerCategory of [
  'cleaning',
  'home-cleaning',
  'house-cleaning',
  'full-house-cleaning',
  'bathroom-cleaning',
  'cleaning-bathroom',
  'kitchen-cleaning',
  'deep-cleaning',
]) {
  assert.equal(
    partnerCategoryMatchesBookNowTask([partnerCategory], bathroomCleaningTask),
    true,
    `${partnerCategory} should match bathroom cleaning`,
  );
  assert.equal(
    partnerCategoryMatchesBookNowTask([partnerCategory], fullHouseCleaningTask),
    true,
    `${partnerCategory} should match full-house cleaning`,
  );
}

assert.equal(isHomeCleaningTask(bathroomCleaningTask), true);
assert.equal(isHomeCleaningTask(fullHouseCleaningTask), true);
assert.equal(isHomeCleaningTask({ category: 'repair', categoryLabel: 'Plumbing' }), false);

const legacyPaintingTask = {
  category: 'other',
  subcategory: 'painting-consultation-exterior-full',
};

assert.equal(
  partnerCategoryMatchesBookNowTask(['painting'], legacyPaintingTask),
  true,
);

console.log('partnerCategoryMatchesBookNowTask.test.ts passed');
