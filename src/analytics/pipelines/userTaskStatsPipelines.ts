import mongoose, { PipelineStage } from "mongoose";

export function buildAssigneeStatsPipeline(
  profileObjectId: mongoose.Types.ObjectId
): PipelineStage[] {
  return [
    { $match: { assigneeId: profileObjectId } },
    {
      $group: {
        _id: null,
        totalTasks: { $sum: 1 },
        completedTasks: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
      },
    },
  ] as PipelineStage[];
}

export function buildPosterPostedCountPipeline(
  profileObjectId: mongoose.Types.ObjectId
): PipelineStage[] {
  return [
    { $match: { requesterId: profileObjectId } },
    { $count: "postedTasks" },
  ] as PipelineStage[];
}
