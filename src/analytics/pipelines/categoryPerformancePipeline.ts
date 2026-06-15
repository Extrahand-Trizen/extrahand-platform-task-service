import { PipelineStage } from "mongoose";
import { ANALYTICS_ACTIVE_STATUSES } from "../constants";
import {
  categoryFieldWithLabelFallback,
  categoryGroupId,
  matchCreatedSince,
} from "../expressions";

export function buildTaskCategoryPerformancePipeline(rangeStart: Date): PipelineStage[] {
  return [
    { $match: matchCreatedSince(rangeStart) },
    {
      $project: {
        category: categoryFieldWithLabelFallback(),
        status: 1,
      },
    },
    {
      $group: {
        _id: categoryGroupId(),
        posted: { $sum: 1 },
        open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
        active: {
          $sum: {
            $cond: [{ $in: ["$status", ANALYTICS_ACTIVE_STATUSES] }, 1, 0],
          },
        },
        completed: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
        cancelled: {
          $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
        },
      },
    },
    { $sort: { posted: -1 } },
  ] as PipelineStage[];
}
