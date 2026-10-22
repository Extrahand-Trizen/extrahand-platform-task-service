import assert from 'node:assert/strict';
import { partnerCategoryMatchesBookNowTask } from '../services/partnerVisibility';

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
assert.equal(partnerCategoryMatchesBookNowTask(['other'], dailyLabourTask), true);
assert.equal(partnerCategoryMatchesBookNowTask(['daily-labour'], dailyLabourTask), true);
assert.equal(partnerCategoryMatchesBookNowTask(['cleaning'], dailyLabourTask), false);

const legacyPaintingTask = {
  category: 'other',
  subcategory: 'painting-consultation-exterior-full',
};

assert.equal(
  partnerCategoryMatchesBookNowTask(['painting'], legacyPaintingTask),
  true,
);

console.log('partnerCategoryMatchesBookNowTask.test.ts passed');
