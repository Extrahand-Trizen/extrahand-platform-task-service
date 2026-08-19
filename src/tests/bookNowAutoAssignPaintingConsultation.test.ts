import assert from 'node:assert/strict';
import { resolveBookNowServiceFlowConfig } from '../utils/bookNowServiceFlowConfig';

const paintingConsultationFlow = resolveBookNowServiceFlowConfig({
  categorySlug: 'painting',
  packageId: 'painting-consultation-interior-1-room',
});

assert.equal(paintingConsultationFlow.serviceFlowType, 'consultation_project');
assert.equal(paintingConsultationFlow.bookingKind, 'consultation');
assert.equal(paintingConsultationFlow.serviceType, 'painting');
assert.equal(paintingConsultationFlow.consultationEnabled, true);

const inferredPaintingFlow = resolveBookNowServiceFlowConfig({
  catalogId: 'painting',
  skuSlug: 'painting-consultation-exterior-full',
});

assert.equal(inferredPaintingFlow.bookingKind, 'consultation');
assert.equal(inferredPaintingFlow.serviceType, 'painting');

console.log('bookNowAutoAssignPaintingConsultation.test.ts passed');
