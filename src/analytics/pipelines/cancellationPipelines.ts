import { PipelineStage } from "mongoose";
import {
  cancelledTaskCountSum,
  categoryFieldWithLabelFallback,
  categoryGroupId,
  matchCreatedSince,
} from "../expressions";

export function buildCancellationSummaryPipeline(rangeStart: Date): PipelineStage[] {
  return [
    { $match: matchCreatedSince(rangeStart) },
    {
      $group: {
        _id: null,
        totalTasks: { $sum: 1 },
        cancelledTasks: cancelledTaskCountSum(),
        cancelledBeforeAssignment: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "cancelled"] },
                  { $eq: ["$assigneeId", null] },
                ],
              },
              1,
              0,
            ],
          },
        },
        cancelledAfterAssignment: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "cancelled"] },
                  { $ne: ["$assigneeId", null] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ] as PipelineStage[];
}

export function buildCancellationByCategoryPipeline(rangeStart: Date): PipelineStage[] {
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
        totalTasks: { $sum: 1 },
        cancelledTasks: cancelledTaskCountSum(),
      },
    },
    { $sort: { totalTasks: -1 } },
  ] as PipelineStage[];
}

export function buildCancellationTrendPipeline(rangeStart: Date): PipelineStage[] {
  return [
    { $match: matchCreatedSince(rangeStart) },
    {
      $project: {
        day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        status: 1,
      },
    },
    {
      $group: {
        _id: "$day",
        totalTasks: { $sum: 1 },
        cancelledTasks: cancelledTaskCountSum(),
      },
    },
    { $sort: { _id: 1 } },
  ] as PipelineStage[];
}
