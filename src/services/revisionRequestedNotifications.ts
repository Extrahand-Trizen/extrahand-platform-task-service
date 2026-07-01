import mongoose from "mongoose";
import logger from "../config/logger";
import { config } from "../config/env";
import { ProfileUtils } from "../utils/ProfileUtils";
import { NotificationClient } from "./NotificationClient";
import { InAppNotificationClient } from "../clients/InAppNotificationClient";

export interface RevisionNotificationContext {
  taskId: string;
  taskTitle: string;
  message: string;
  assigneeId?: mongoose.Types.ObjectId | string | null;
  assigneeUid?: string | null;
  posterProfileId: mongoose.Types.ObjectId | string;
}

/**
 * Notify the assigned helper (FCM + in-app) when a poster requests revisions.
 */
export async function notifyHelperRevisionRequested(
  ctx: RevisionNotificationContext
): Promise<void> {
  const taskId = ctx.taskId;
  const message =
    ctx.message?.trim() || "Please revise and resubmit your work.";

  const taskerUid = await ProfileUtils.resolveAssigneeFirebaseUid({
    assigneeId: ctx.assigneeId,
    assigneeUid: ctx.assigneeUid,
  });

  if (!taskerUid) {
    logger.warn(
      "[notifyHelperRevisionRequested] Could not resolve tasker Firebase UID",
      {
        taskId,
        assigneeId: ctx.assigneeId ? String(ctx.assigneeId) : undefined,
        assigneeUid: ctx.assigneeUid || undefined,
      }
    );
    return;
  }

  const posterProfile = await ProfileUtils.getByProfileId(
    ctx.posterProfileId,
    "uid name fullName"
  );
  const requesterUid = String(posterProfile?.uid || "").trim();
  const posterName =
    ProfileUtils.resolveProfileDisplayName(posterProfile) || "The poster";

  const notifData = {
    taskId,
    changeMessage: message,
    status: "in_progress",
    action: "revision_requested",
    completionStatus: "revision_requested",
    eventKey: "TASK_UPDATED",
    entityType: "task",
    taskUrl: `${config.WEB_APP_URL}/tasks/${taskId}/track`,
  };

  const title = "Revision requested";
  const body = `${posterName} has requested changes on "${ctx.taskTitle}". Please review and resubmit.`;

  await NotificationClient.send({
    eventKey: "TASK_UPDATED",
    category: "taskUpdates",
    actorId: requesterUid || undefined,
    recipients: [taskerUid],
    entity: { type: "task", id: taskId },
    title,
    body,
    data: notifData,
  }).catch((err: Error) =>
    logger.error(
      "[notifyHelperRevisionRequested] Error sending push notification",
      {
        taskId,
        taskerUid,
        error: err instanceof Error ? err.message : "Unknown error",
      }
    )
  );

  await InAppNotificationClient.send({
    userId: taskerUid,
    title,
    body,
    type: "warning",
    category: "taskUpdates",
    data: notifData,
  }).catch((err: Error) =>
    logger.error(
      "[notifyHelperRevisionRequested] Error sending in-app notification",
      {
        taskId,
        taskerUid,
        error: err instanceof Error ? err.message : "Unknown error",
      }
    )
  );
}
