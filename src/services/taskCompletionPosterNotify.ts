import mongoose from 'mongoose';
import logger from '../config/logger';
import { NotificationClient } from './NotificationClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';

export interface NotifyPosterOnTaskCompletedParams {
  taskId: string;
  taskTitle: string;
  posterUid: string;
  assigneeUid?: string;
  actorUid?: string;
}

/**
 * Blinkit-style completion confirmation for the customer (poster):
 * thank-you line + "Work completed" + rate-helper CTA in push/in-app payload.
 */
export async function notifyPosterOnTaskCompleted(
  params: NotifyPosterOnTaskCompletedParams
): Promise<void> {
  const { taskId, taskTitle, posterUid, assigneeUid, actorUid } = params;
  const title = 'Work completed ✓';
  const thankYouLine = 'Thank you for choosing ExtraHand!';
  const safeTitle = (taskTitle || 'your task').trim();
  const body = `Your helper finished "${safeTitle}". How was your experience?`;
  const notifData = {
    taskId,
    taskTitle,
    status: 'completed',
    eventKey: 'REVIEW_REQUEST',
    entityType: 'task',
    action: 'rate_task',
    actionUrl: `/tasks/${taskId}/track?openReview=1`,
    thankYouLine,
    title,
    body,
    recipientRole: 'customer',
    assigneeUid: assigneeUid || '',
    openReview: '1',
  };

  await NotificationClient.send({
    eventKey: 'REVIEW_REQUEST',
    category: 'taskUpdates',
    // Prefer helper as actor so poster still gets push even if actorUid === posterUid.
    actorId: assigneeUid || actorUid || 'system',
    recipients: [posterUid],
    entity: { type: 'task', id: taskId },
    title,
    body,
    data: notifData,
  });

  await InAppNotificationClient.send({
    userId: posterUid,
    title,
    body: `${thankYouLine} ${body}`,
    type: 'success',
    category: 'taskUpdates',
    data: notifData,
  });

  try {
    fireWhatsAppNotify({
      uid: posterUid,
      templateKey: 'wa_work_completed_customer',
      category: 'taskUpdates',
      templateBody: { var_1: taskTitle || 'your work' },
      idempotencyKey: `completed-poster:${taskId}`,
      metadata: { workId: taskId, recipientRole: 'customer' },
    });
  } catch (err) {
    logger.warn('[notifyPosterOnTaskCompleted] WhatsApp notify failed', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Resolve poster + helper Firebase uids from a task document. */
export async function resolveTaskParticipantUids(task: {
  requesterId?: mongoose.Types.ObjectId;
  assigneeId?: mongoose.Types.ObjectId;
}): Promise<{ posterUid: string; assigneeUid: string }> {
  const Profile = mongoose.connection.collection('profiles');
  const [requesterProfile, assigneeProfile] = await Promise.all([
    task.requesterId ? Profile.findOne({ _id: task.requesterId }) : null,
    task.assigneeId ? Profile.findOne({ _id: task.assigneeId }) : null,
  ]);
  return {
    posterUid: requesterProfile?.uid ? String(requesterProfile.uid) : '',
    assigneeUid: assigneeProfile?.uid ? String(assigneeProfile.uid) : '',
  };
}
