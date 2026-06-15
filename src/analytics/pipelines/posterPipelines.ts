import mongoose, { PipelineStage } from "mongoose";
import {
  categoryFieldSlugFallback,
  categoryGroupId,
  genuineTaskCountSum,
  lookupTaskApplications,
  matchCreatedSince,
} from "../expressions";

export function buildPosterAnalyticsPipeline(
  requesterObjectId: mongoose.Types.ObjectId,
  rangeStart: Date
): PipelineStage[] {
  return [
    {
      $match: {
        requesterId: requesterObjectId,
        ...matchCreatedSince(rangeStart),
      },
    },
    lookupTaskApplications(),
    {
      $project: {
        category: categoryFieldSlugFallback(),
        status: 1,
        bidCount: { $size: "$applications" },
      },
    },
    {
      $facet: {
        metrics: [
          {
            $group: {
              _id: null,
              postedTasks: { $sum: 1 },
              totalBids: { $sum: "$bidCount" },
              genuineTaskCount: genuineTaskCountSum(),
            },
          },
        ],
        categories: [
          {
            $group: {
              _id: categoryGroupId(),
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $project: { _id: 0, category: "$_id", count: 1 } },
        ],
      },
    },
  ] as PipelineStage[];
}

export function buildPosterSummaryPipeline(rangeStart: Date): PipelineStage[] {
  return [
    { $match: matchCreatedSince(rangeStart) },
    lookupTaskApplications(),
    {
      $project: {
        requesterId: 1,
        status: 1,
        bidCount: { $size: "$applications" },
      },
    },
    {
      $group: {
        _id: "$requesterId",
        taskCount: { $sum: 1 },
        bidCount: { $sum: "$bidCount" },
        genuineTaskCount: genuineTaskCountSum(),
      },
    },
    {
      $project: {
        _id: 0,
        requesterId: { $toString: "$_id" },
        taskCount: 1,
        bidCount: 1,
        genuineTaskCount: 1,
      },
    },
  ] as PipelineStage[];
}
