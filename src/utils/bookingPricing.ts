/** Default fee snapshot for checkout display; payment-service applies authoritative fee on escrow. */
const DEFAULT_PLATFORM_FEE_PERCENT = 0.05;
const DEFAULT_GST_PERCENT = 0.18;

export function computeBookingTotals(taskAmount: number): {
  subtotal: number;
  addonsTotal: number;
  platformFee: number;
  gst: number;
  total: number;
} {
  const subtotal = Math.round(taskAmount * 100) / 100;
  const addonsTotal = 0;
  const platformFee = Math.round(subtotal * DEFAULT_PLATFORM_FEE_PERCENT * 100) / 100;
  const gst = Math.round(platformFee * DEFAULT_GST_PERCENT * 100) / 100;
  const total = Math.round((subtotal + platformFee + gst) * 100) / 100;
  return { subtotal, addonsTotal, platformFee, gst, total };
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
