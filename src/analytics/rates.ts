export function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Percentage rate rounded to `decimals` places; returns 0 when denominator is 0. */
export function calcRatePercent(
  numerator: number,
  denominator: number,
  decimals = 1
): number {
  if (denominator <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.round((numerator / denominator) * 100 * factor) / factor;
}
