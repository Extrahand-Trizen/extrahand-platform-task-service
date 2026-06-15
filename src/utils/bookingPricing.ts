/** Book Now: customer pays package price only — no platform fee or GST on top. */
export function computeBookingTotals(taskAmount: number): {
  subtotal: number;
  addonsTotal: number;
  platformFee: number;
  gst: number;
  total: number;
} {
  const subtotal = Math.round(taskAmount * 100) / 100;
  return {
    subtotal,
    addonsTotal: 0,
    platformFee: 0,
    gst: 0,
    total: subtotal,
  };
}

export function computeLinePrice(
  basePrice: number,
  variantPriceDelta = 0,
  addonPrices: number[] = [],
  quantity = 1
): number {
  const unit = basePrice + variantPriceDelta;
  const addons = addonPrices.reduce((sum, p) => sum + p, 0);
  return Math.round((unit + addons) * quantity * 100) / 100;
}
