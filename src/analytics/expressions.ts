import { ANALYTICS_GENUINE_STATUSES, TASK_APPLICATIONS_COLLECTION } from "./constants";

/** categorySlug → categoryLabel → category */
export function categoryFieldWithLabelFallback() {
  return {
    $ifNull: ["$categorySlug", { $ifNull: ["$categoryLabel", "$category"] }],
  };
}

/** categorySlug → category (poster analytics) */
export function categoryFieldSlugFallback() {
  return { $ifNull: ["$categorySlug", "$category"] };
}

export function categoryGroupId() {
  return { $ifNull: ["$category", "other"] };
}

export function matchCreatedSince(rangeStart: Date) {
  return { createdAt: { $gte: rangeStart } };
}

export function lookupTaskApplications() {
  return {
    $lookup: {
      from: TASK_APPLICATIONS_COLLECTION,
      localField: "_id",
      foreignField: "taskId",
      as: "applications",
    },
  };
}

export function genuineTaskCountSum() {
  return {
    $sum: {
      $cond: [{ $in: ["$status", ANALYTICS_GENUINE_STATUSES] }, 1, 0],
    },
  };
}

export function cancelledTaskCountSum() {
  return {
    $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
  };
}
