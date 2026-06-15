import { PipelineStage } from "mongoose";
import {
  categoryFieldWithLabelFallback,
  categoryGroupId,
  matchCreatedSince,
} from "../expressions";

export function buildCategoryCountPipeline(rangeStart: Date): PipelineStage[] {
  return [
    { $match: matchCreatedSince(rangeStart) },
    {
      $project: {
        category: categoryFieldWithLabelFallback(),
      },
    },
    {
      $group: {
        _id: categoryGroupId(),
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ] as PipelineStage[];
}

export function buildSubcategoryCountPipeline(rangeStart: Date): PipelineStage[] {
  return [
    { $match: matchCreatedSince(rangeStart) },
    {
      $project: {
        category: categoryFieldWithLabelFallback(),
        subcategory: { $ifNull: ["$subcategory", "unspecified"] },
      },
    },
    {
      $group: {
        _id: {
          category: categoryGroupId(),
          subcategory: { $ifNull: ["$subcategory", "unspecified"] },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ] as PipelineStage[];
}
