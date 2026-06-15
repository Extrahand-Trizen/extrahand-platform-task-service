import mongoose, { PipelineStage } from "mongoose";
import { ANALYTICS_ACTIVE_STATUSES } from "../constants";
import { lookupTaskApplications, matchCreatedSince } from "../expressions";

export function buildUserPosterStatsPipeline(
  profileObjectId: mongoose.Types.ObjectId,
  rangeStart: Date
): PipelineStage[] {
  return [
    {
      $match: {
        requesterId: profileObjectId,
        ...matchCreatedSince(rangeStart),
      },
    },
    lookupTaskApplications(),
    {
      $group: {
        _id: null,
        postedTasks: { $sum: 1 },
        totalBidsReceived: { $sum: { $size: "$applications" } },
        tasksWithAtLeastOneBid: {
          $sum: {
            $cond: [{ $gt: [{ $size: "$applications" }, 0] }, 1, 0],
          },
        },
        openTasks: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
        activeTasks: {
          $sum: {
            $cond: [{ $in: ["$status", ANALYTICS_ACTIVE_STATUSES] }, 1, 0],
          },
        },
        completedTasks: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
      },
    },
  ] as PipelineStage[];
}

export function buildUserTaskerStatsPipeline(
  profileObjectId: mongoose.Types.ObjectId,
  rangeStart: Date
): PipelineStage[] {
  return [
    {
      $match: {
        assigneeId: profileObjectId,
        ...matchCreatedSince(rangeStart),
      },
    },
    {
      $group: {
        _id: null,
        activeAssignedTasks: {
          $sum: {
            $cond: [{ $in: ["$status", ANALYTICS_ACTIVE_STATUSES] }, 1, 0],
          },
        },
        completedAssignedTasks: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
      },
    },
  ] as PipelineStage[];
}

export function buildUserApplicationStatsPipeline(
  profileObjectId: mongoose.Types.ObjectId,
  rangeStart: Date
): PipelineStage[] {
  return [
    {
      $match: {
        applicantId: profileObjectId,
        ...matchCreatedSince(rangeStart),
      },
    },
    {
      $group: {
        _id: null,
        applicationsPlaced: { $sum: 1 },
        acceptedApplications: {
          $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] },
        },
        pendingApplications: {
          $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
        },
      },
    },
  ] as PipelineStage[];
}
