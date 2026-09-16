import mongoose from 'mongoose';
import logger from '../config/logger';
import { config } from '../config/env';
import { NotificationClient } from './NotificationClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';
import { EmailServiceClient } from '../clients/EmailServiceClient';
import { fireDialogWhatsAppForUser } from '../clients/fireDialogWhatsAppForUser';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';
import { taskOpenAppButton } from '../utils/whatsappTaskButtons';
import type { ITask } from '../models/Task';

export interface NotifyPartnerOnTaskCancelledParams {
  task:
    | ITask
    | {
        _id: unknown;
        title?: string;
        assigneeId?: unknown;
        assigneeUid?: string | null;
        [key: string]: unknown;
      };
  cancellerUid?: string;
  reason?: string;
}

/**
 * Sends a cancellation notification to the assigned partner / helper
 * when a customer cancels an assigned task or booking.
 */
export async function notifyPartnerOnTaskCancelledByCustomer(
  params: NotifyPartnerOnTaskCancelledParams,
): Promise<void> {
  const { task, cancellerUid, reason } = params;
  const taskId = String((task as any)._id || '');
  if (!taskId) return;

  try {
    const Profile = mongoose.connection.collection('profiles');
    let partnerUid = task.assigneeUid ? String(task.assigneeUid).trim() : '';
    let partnerEmail: string | undefined;
    let partnerName: string | undefined;

    if (task.assigneeId) {
      const partnerProfile = await Profile.findOne({ _id: task.assigneeId });
      if (partnerProfile) {
        if (!partnerUid && partnerProfile.uid) {
          partnerUid = String(partnerProfile.uid);
        }
        partnerEmail = partnerProfile.email;
        partnerName = partnerProfile.name || partnerProfile.fullName;
      }
    } else if (partnerUid) {
      const partnerProfile = await Profile.findOne({ uid: partnerUid });
      if (partnerProfile) {
        partnerEmail = partnerProfile.email;
        partnerName = partnerProfile.name || partnerProfile.fullName;
      }
    }

    if (!partnerUid) {
      logger.info('[notifyPartnerOnTaskCancelledByCustomer] No assigned partner UID found to notify', {
        taskId,
      });
      return;
    }

    const cancelTitle = 'Work cancelled';
    const taskTitle = ((task as any).title || '').trim();
    const cancelTaskTitle = taskTitle || 'your work';
    const cancelBody = taskTitle
      ? `Customer cancelled this work: "${taskTitle}".`
      : 'Customer cancelled this work.';

    logger.info('[notifyPartnerOnTaskCancelledByCustomer] Sending cancellation notification to partner', {
      taskId,
      partnerUid,
      reason,
    });

    const notifData: Record<string, string> = {
      taskId,
      taskTitle: cancelTaskTitle,
      actionUrl: `/tasks/${taskId}/track`,
      eventKey: 'TASK_CANCELLED_HELPER',
      entityType: 'task',
      status: 'cancelled',
      cancelledBy: 'customer',
      recipientRole: 'helper',
      ...(reason ? { cancellationReason: reason } : {}),
    };

    // 1. In-app notification
    try {
      await InAppNotificationClient.send({
        userId: partnerUid,
        title: cancelTitle,
        body: cancelBody,
        type: 'warning',
        category: 'taskUpdates',
        data: notifData,
      });
    } catch (inAppErr) {
      logger.warn('[notifyPartnerOnTaskCancelledByCustomer] In-app notification failed', {
        taskId,
        partnerUid,
        error: inAppErr instanceof Error ? inAppErr.message : inAppErr,
      });
    }

    // 2. Push notification via NotificationClient (FCM + Dialog WhatsApp bridge)
    try {
      await NotificationClient.send({
        eventKey: 'TASK_CANCELLED_HELPER',
        category: 'taskUpdates',
        actorId: cancellerUid || 'customer',
        recipients: [partnerUid],
        entity: { type: 'task', id: taskId },
        title: cancelTitle,
        body: cancelBody,
        data: notifData,
      });
    } catch (pushErr) {
      logger.warn('[notifyPartnerOnTaskCancelledByCustomer] Push notification failed', {
        taskId,
        partnerUid,
        error: pushErr instanceof Error ? pushErr.message : pushErr,
      });
    }

    // 3. Email notification (if email is known)
    if (partnerEmail) {
      EmailServiceClient.sendTaskCancelled(partnerEmail, {
        recipientName: partnerName || 'There',
        taskTitle: cancelTaskTitle,
        cancelledByName: 'Customer',
        reason,
        browseUrl: `${config.WEB_APP_URL}/tasks`,
        userId: partnerUid,
      }).catch((emailErr) =>
        logger.error('[notifyPartnerOnTaskCancelledByCustomer] Email send failed', {
          taskId,
          partnerUid,
          error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
        }),
      );
    }

    // 4. WhatsApp notification (Direct + Fallback)
    const waMinute = Math.floor(Date.now() / 60000);
    try {
      fireDialogWhatsAppForUser({
        uid: partnerUid,
        eventKey: 'TASK_CANCELLED_HELPER',
        category: 'taskUpdates',
        payload: {
          title: cancelTitle,
          body: cancelBody,
          taskTitle: cancelTaskTitle,
          taskId,
        },
        idempotencyKey: `eh-push:${partnerUid}:TASK_CANCELLED_HELPER:${taskId}:${waMinute}`.slice(0, 200),
      });

      fireWhatsAppNotify({
        uid: partnerUid,
        templateKey: 'wa_work_cancelled_helper',
        category: 'taskUpdates',
        templateBody: { var_1: cancelTaskTitle },
        templateButtons: taskOpenAppButton(taskId),
        idempotencyKey: `cancel:${taskId}:${partnerUid}`,
        metadata: {
          workId: taskId,
          recipientRole: 'helper',
          metaTemplateName: 'extrahand_work_cancelled_helper',
        },
      });
    } catch (waErr) {
      logger.warn('[notifyPartnerOnTaskCancelledByCustomer] WhatsApp notify failed', {
        taskId,
        partnerUid,
        error: waErr instanceof Error ? waErr.message : waErr,
      });
    }
  } catch (error) {
    logger.error('[notifyPartnerOnTaskCancelledByCustomer] Unexpected error notifying partner', {
      taskId,
      error: error instanceof Error ? error.message : error,
    });
  }
}
