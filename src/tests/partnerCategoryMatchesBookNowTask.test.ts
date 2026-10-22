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
