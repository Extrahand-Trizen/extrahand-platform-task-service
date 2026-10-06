import type { IServiceSku } from '../models/ServiceSku';

export type SkuPriceFields = Pick<IServiceSku, 'basePrice' | 'offerDiscountType' | 'offerDiscountValue' | 'isOfferActive'> &
  Partial<Pick<IServiceSku, 'offerPrice' | 'pricingUnit'>>;

/** Price a customer pays for a SKU when no location-specific price applies. */
/**
 * Unit price for a client-priced Book Now line once a location rule applies.
 * Variant lines keep their option price relative to the package: unit × locationPrice / globalPrice.
 */
export function locationAdjustedUnitPrice(params: {
  clientUnitPrice: number;
  locationPrice: number;
  globalPrice: number;
  isVariantLine: boolean;
}): number {
  if (!params.isVariantLine) return params.locationPrice;
  if (params.globalPrice <= 0) return params.clientUnitPrice;
  return Math.round((params.clientUnitPrice * params.locationPrice) / params.globalPrice);
}

export function getSkuOfferPrice(sku: SkuPriceFields): number {
  const base = Math.max(0, Number(sku.basePrice || 0));
  const configuredOffer = Number(sku.offerPrice || 0);
  if (configuredOffer > 0) return Math.round(configuredOffer);
  if (sku.pricingUnit === 'hourly') return base;
  if (!sku.isOfferActive) return base;
  const discountValue = Math.max(0, Number(sku.offerDiscountValue || 0));
  const discountType = sku.offerDiscountType || 'percent';

  if (discountType === 'flat') {
    return Math.max(0, Math.round(base - discountValue));
  }

  return Math.max(0, Math.round(base * (1 - discountValue / 100)));
}
