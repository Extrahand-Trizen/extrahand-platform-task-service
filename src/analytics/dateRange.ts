import { ANALYTICS_DEFAULT_RANGE } from "./constants";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getRangeStart(range: string): Date {
  const now = Date.now();
  if (range === "7d") return new Date(now - 7 * MS_PER_DAY);
  if (range === "90d") return new Date(now - 90 * MS_PER_DAY);
  return new Date(now - 30 * MS_PER_DAY);
}

/** Normalizes query range and returns the matching createdAt lower bound. */
export function resolveAnalyticsRange(range?: string): {
  rangeValue: string;
  rangeStart: Date;
} {
  const rangeValue = range || ANALYTICS_DEFAULT_RANGE;
  return { rangeValue, rangeStart: getRangeStart(rangeValue) };
}
