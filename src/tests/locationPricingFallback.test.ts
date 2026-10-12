import assert from 'node:assert/strict';
import { buildLocationPriceCandidateOrder, skuMatchesSection } from '../services/LocationPricingService';
import { getSkuOfferPrice, locationAdjustedUnitPrice } from '../utils/skuPricing';

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

assert.equal(
  getSkuOfferPrice({ basePrice: 999, offerPrice: 0, isOfferActive: true, offerDiscountType: 'percent', offerDiscountValue: 20, pricingUnit: 'fixed' }),
  799,
  'fixed SKUs without a configured offer price should use the active percent discount as their global price',
);
assert.equal(
  getSkuOfferPrice({ basePrice: 599, offerPrice: 0, isOfferActive: true, offerDiscountType: 'percent', offerDiscountValue: 20, pricingUnit: 'hourly' }),
  599,
  'hourly SKUs should ignore discount fields and keep the base price',
);

assert.equal(
  locationAdjustedUnitPrice({ clientUnitPrice: 799, locationPrice: 899, globalPrice: 799, isVariantLine: false }),
  899,
  'a non-variant line should be charged exactly the location price',
);
assert.equal(
  locationAdjustedUnitPrice({ clientUnitPrice: 1299, locationPrice: 900, globalPrice: 1000, isVariantLine: true }),
  1169,
  'a variant line should scale its option price by locationPrice / globalPrice',
);
assert.equal(
  locationAdjustedUnitPrice({ clientUnitPrice: 1299, locationPrice: 900, globalPrice: 0, isVariantLine: true }),
  1299,
  'a variant line should keep the client price when the global price is unknown',
);

assert.equal(skuMatchesSection({ name: 'AC Uninstallation', slug: 'ac-uninstallation' }, 'uninstall'), true);
assert.equal(skuMatchesSection({ name: 'AC Uninstallation', slug: 'ac-uninstallation' }, 'install'), false);
assert.equal(skuMatchesSection({ name: 'Foam Jet AC Service', slug: 'foam-jet-ac-service' }, 'servicing'), true);
assert.equal(skuMatchesSection({ name: 'Foam Jet AC Service', slug: 'foam-jet-ac-service' }, 'repair'), false);
assert.equal(skuMatchesSection({ name: 'Bathroom Cleaning', slug: 'bathroom-cleaning' }, ''), true);

console.log('✅ locationPricingFallback.test.ts passed');
