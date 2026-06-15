/** Task statuses counted as genuine (assigned through completed). */
export const ANALYTICS_GENUINE_STATUSES = [
  "assigned",
  "started",
  "in_progress",
  "review",
  "completed",
] as const;

/** Task statuses considered in-flight (not open, not terminal). */
export const ANALYTICS_ACTIVE_STATUSES = [
  "assigned",
  "started",
  "in_progress",
  "review",
] as const;

export const ANALYTICS_DEFAULT_RANGE = "30d" as const;

export const TASK_APPLICATIONS_COLLECTION = "taskapplications";

export const MAX_SUBCATEGORIES_PER_CATEGORY = 10;
