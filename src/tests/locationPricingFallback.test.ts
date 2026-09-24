import assert from 'node:assert/strict';
import { buildLocationPriceCandidateOrder } from '../services/LocationPricingService';

const resolveFallbackHourlyPrice = (basePrice: number, offerPrice: number | null | undefined) => {
  const normalizedBase = Number(basePrice || 0);
  const configuredGlobalOffer = Number(offerPrice || 0);
  if (configuredGlobalOffer <= 0) return normalizedBase;
  return configuredGlobalOffer !== normalizedBase ? Math.round(configuredGlobalOffer) : normalizedBase;
};

// If no location-specific rule exists, the catalog should still show the normal price card.
const basePrice = 599;
const noLocationRule = null;
const fallbackPrice = resolveFallbackHourlyPrice(basePrice, noLocationRule);
assert.equal(fallbackPrice, basePrice, 'fallback should keep the normal hourly price when no location pricing exists');
assert.equal(fallbackPrice > 0, true, 'normal card should still render with a real positive price');

const overrideAboveBase = resolveFallbackHourlyPrice(59, 100);
assert.equal(overrideAboveBase, 100, 'an explicit hourly override above the base price should be preserved');

const bobbiliCandidates = buildLocationPriceCandidateOrder({
  areaId: 'area-1',
  pincodeId: 'pincode-1',
  cityId: 'city-1',
  areaName: 'Bobbili',
  cityName: 'Bobbili',
});
assert.deepEqual(
  bobbiliCandidates.map((candidate) => `${candidate.locationType}:${candidate.locationId}`),
  ['area:area-1', 'pincode:pincode-1', 'city:city-1'],
  'same-name Bobbili area and city matches should stay in the priority order while preserving the direct match order',
);

console.log('✅ locationPricingFallback.test.ts passed');
