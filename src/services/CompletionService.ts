import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { NotFoundError, BadRequestError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { NotificationClient } from './NotificationClient';
import { EmailServiceClient } from '../clients/EmailServiceClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';
import { taskOpenAppButton } from '../utils/whatsappTaskButtons';
import { UserServiceClient } from '../clients/UserServiceClient';
import { config } from '../config/env';
import { emitProofSubmitted, emitProofApproved, emitProofRejected } from '../socket/socketHandlers';
import { TaskService } from './TaskService';
import { RecurringVisitService } from './RecurringVisitService';
import { notifyHelperRevisionRequested } from './revisionRequestedNotifications';
import { ITask } from '../models/Task';
import { PaymentClient } from './PaymentClient';

export class CompletionService {
  /**
   * Submit completion proof
   */
  static async submitCompletionProof(
    taskId: string,
    performerProfileId: string,
    proofData: {
      proofUrls: string[];
      notes?: string;
    }
  ): Promise<any> {
    const { proofUrls, notes } = proofData;

    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is the assigned performer - compare using profile IDs (MongoDB ObjectIds)
    const isAssignedPerformer = task.assigneeId?.toString() === performerProfileId;
    let hasAcceptedApplication = false;

    if (!isAssignedPerformer) {
      // Check if user has an accepted application (using profile ID)
      const acceptedApplication = await TaskApplication.findOne({
        taskId: task._id,
        applicantId: performerProfileId,
        status: 'accepted',
      });
      hasAcceptedApplication = !!acceptedApplication;
    }

    if (!isAssignedPerformer && !hasAcceptedApplication) {
      throw new ForbiddenError('Only the assigned performer can submit completion proof');
    }

    const allowedSubmitStatuses = ['in_progress', 'started', 'review'];
    const isRevisionResubmit =
      task.completionStatus === 'revision_requested' &&
      String(task.status) === 'in_progress';
    if (!allowedSubmitStatuses.includes(String(task.status)) && !isRevisionResubmit) {
      throw new BadRequestError(
        'Completion proof can only be submitted while work is in progress or under revision'
      );
    }

    const normalizedProofUrls = Array.isArray(proofUrls)
      ? proofUrls.map((url) => String(url || '').trim()).filter(Boolean)
      : [];

    // TEMP DISABLED: selfie + work-photo specific requirement.
    // if (normalizedProofUrls.length < 2) {
    //   throw new BadRequestError('Please upload both selfie and work photo before submission');
    // }

    if (normalizedProofUrls.length < 1) {
      throw new BadRequestError('Please upload at least one proof image before submission');
    }

    const completionProof = normalizedProofUrls.map(url => ({
      url,
      filename: url.split('/').pop() || 'proof.jpg',
      uploadedAt: new Date(),
      uploadedBy: performerProfileId,
    }));
    const submittedAt = new Date();

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        status: 'review',
        completionProof,
        completionNotes: notes || '',
        completionStatus: 'pending_approval',
        reviewAt: submittedAt,
        completionSubmittedAt: submittedAt,
        updatedAt: submittedAt,
      },
      { new: true, runValidators: true }
    ).lean();

    logger.info(`Task ${taskId} completion proof submitted by profile ${performerProfileId}`);

    // Emit real-time proof submission
    emitProofSubmitted(taskId, updatedTask);

    // Email: completion proof submitted → requester
    try {
      const Profile = mongoose.connection.collection('profiles');
      const requesterProfile = await Profile.findOne({ _id: task.requesterId });
      const assigneeProfile = task.assigneeId
        ? await Profile.findOne({ _id: task.assigneeId })
        : null;
      const approvalPath = `/tasks/${taskId}/track?pendingApproval=1`;
      const approvalUrl = `${config.WEB_APP_URL}${approvalPath}`;

      if (requesterProfile?.uid) {
        await NotificationClient.send({
          eventKey: 'TASK_UPDATED',
          category: 'taskUpdates',
          actorId: performerProfileId,
          recipients: [requesterProfile.uid],
          entity: { type: 'task', id: taskId },
          title: 'Task ready for your approval',
          body: `${assigneeProfile?.name || 'Your tasker'} submitted completion for "${task.title}". Approve or request changes.`,
          data: {
            taskId,
            status: 'review',
            action: 'approve_completion',
            actionUrl: approvalPath,
            taskUrl: approvalUrl,
          },
        });
      }

      await InAppNotificationClient.send({
        userId: task.requesterId.toString(),
        title: 'Task ready for your approval',
        body: `${assigneeProfile?.name || 'Your tasker'} submitted completion for "${task.title}". Approve or request changes.`,
        type: 'info',
        category: 'taskUpdates',
        data: {
          taskId,
          status: 'review',
          action: 'approve_completion',
          actionUrl: approvalPath,
          taskUrl: approvalUrl,
        },
      });

      if (requesterProfile?.email) {
        EmailServiceClient.sendCompletionProofSubmitted(requesterProfile.email, {
          requesterName: requesterProfile.name || 'There',
          assigneeName: assigneeProfile?.name || 'Your tasker',
          taskTitle: task.title,
          submittedAt: new Date().toLocaleString(),
          taskUrl: approvalUrl,
          userId: requesterProfile.uid,
        }).catch((err) =>
          logger.error('Error sending completion_proof_submitted email', {
            taskId,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        );
      }
    } catch (error) {
      logger.error('Error sending completion_proof_submitted email', {
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    TaskService.invalidateTaskCache(taskId);
    return updatedTask;
  }

  /**
   * Approve completion
   */
  static async approveCompletion(taskId: string, taskOwnerProfileId: string): Promise<any> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is the task owner
    if (task.requesterId?.toString() !== taskOwnerProfileId) {
      throw new ForbiddenError('Only the task owner can approve completion');
    }

    // Check if task is in review status
    if (task.status !== 'review' || task.completionStatus !== 'pending_approval') {
      throw new BadRequestError('Task is not pending approval');
    }

    // Update task status
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        status: 'completed',
        completionStatus: 'approved',
        completedAt: new Date(),
        completionApprovedAt: new Date(),
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    logger.info(`Task ${taskId} completion approved by poster ${taskOwnerProfileId}`);

    if (updatedTask?.parentTaskId && updatedTask?.recurringVisitId) {
      try {
        await RecurringVisitService.onChildVisitCompleted(updatedTask as unknown as ITask);
      } catch (err) {
        logger.error(
          '[CompletionService] Failed to advance recurring visit plan after child completion',
          {
            taskId,
            parentTaskId: String(updatedTask.parentTaskId),
            recurringVisitId: updatedTask.recurringVisitId,
            error: err,
          },
        );
      }
    }

    // EMIT: TASK_COMPLETED and REVIEW_REQUEST notifications
    try {
      const Profiles = mongoose.connection.collection('profiles');
      const assigneeProfile = updatedTask?.assigneeId
        ? await Profiles.findOne({ _id: new mongoose.Types.ObjectId(updatedTask.assigneeId) })
        : null;
      const requesterProfile = updatedTask?.requesterId
        ? await Profiles.findOne({ _id: new mongoose.Types.ObjectId(updatedTask.requesterId) })
        : null;

      const assigneeUid = assigneeProfile?.uid;
      const requesterUid = requesterProfile?.uid || taskOwnerProfileId;
      const taskTitle = updatedTask?.title;

      // TASK_COMPLETED - Notify requester that task is done
      await NotificationClient.send(
        {
          eventKey: 'TASK_COMPLETED',
          category: 'taskUpdates',
          actorId: requesterUid,
          recipients: [requesterUid],
          entity: { type: 'task', id: taskId },
          title: `Task Completed: ${taskTitle}`,
          body: `Your task has been completed successfully. Thank you for using ExtraHand!`,
          data: {
            taskId,
            status: 'completed'
          }
        }
      );

      // TASK_COMPLETED_FOR_TASKER - Notify performer that poster approved
      if (assigneeUid) {
        await NotificationClient.send({
          eventKey: 'TASK_COMPLETED_TASKER',
          category: 'taskUpdates',
          actorId: requesterUid,
          recipients: [assigneeUid],
          entity: { type: 'task', id: taskId },
          title: 'Task approved',
          body: `Your work on "${taskTitle}" was approved. Great job!`,
          data: {
            taskId,
            status: 'completed'
          }
        });

        await InAppNotificationClient.send({
          userId: assigneeUid,
          title: 'Task approved',
          body: `Your work on "${taskTitle}" was approved. Great job!`,
          category: 'taskUpdates',
          type: 'success',
          data: {
            taskId,
            status: 'completed'
          }
        });

        fireWhatsAppNotify({
          uid: assigneeUid,
          templateKey: 'wa_work_completed_helper',
          category: 'taskUpdates',
          templateBody: { var_1: taskTitle || 'your task' },
          templateButtons: taskOpenAppButton(taskId),
          idempotencyKey: `completed-helper:${taskId}`,
          metadata: { workId: taskId, recipientRole: 'helper' },
        });
      }

      if (requesterUid) {
        fireWhatsAppNotify({
          uid: requesterUid,
          templateKey: 'wa_work_completed_customer',
          category: 'taskUpdates',
          templateBody: { var_1: taskTitle || 'your task' },
          idempotencyKey: `completed-poster:${taskId}`,
          metadata: { workId: taskId, recipientRole: 'customer' },
        });
      }

      if (!assigneeUid) {
        logger.warn('[CompletionService] Skipping TASK_COMPLETED reward event — missing performer Firebase uid', {
          taskId,
          assigneeProfileId: updatedTask?.assigneeId?.toString(),
        });
      } else if (requesterUid) {
        const taskAmount =
          typeof updatedTask?.budget === 'number'
            ? updatedTask.budget
            : Number(updatedTask?.budget) || 0;
        UserServiceClient.processRewardEvent({
          eventType: 'TASK_COMPLETED',
          payload: {
            taskId,
            performerUid: assigneeUid,
            posterUid: requesterUid,
            taskAmountInr: taskAmount,
            refereeUid: assigneeUid,
          },
          correlationId: taskId,
        }).catch(() => undefined);
      }

      // REVIEW_REQUEST - Prompt requester to review the tasker
      await NotificationClient.send(
        {
          eventKey: 'REVIEW_REQUEST',
          category: 'taskUpdates',
          actorId: requesterUid,
          recipients: [requesterUid],
          entity: { type: 'task', id: taskId },
          title: `Please review your tasker`,
          body: `Share your experience with the tasker who completed "${taskTitle}". Your review helps the community!`,
          data: {
            taskId,
            assigneeUid,
            actionUrl: `/tasks/${taskId}/review`
          }
        }
      );
    } catch (error) {
      logger.error('Error sending completion notifications', {
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Email: task_completed (to requester + assignee), review_request (to requester)
    try {
      const Profile = mongoose.connection.collection('profiles');
      const requesterProfile = task.requesterId
        ? await Profile.findOne({ _id: task.requesterId })
        : null;
      const assigneeProfile = task.assigneeId
        ? await Profile.findOne({ _id: task.assigneeId })
        : null;
      const completedDateStr = new Date().toLocaleDateString();
      const taskUrl = `${config.WEB_APP_URL}/tasks/${taskId}/track`;
      const reviewUrl = `${config.WEB_APP_URL}/tasks/${taskId}/track`;

      if (requesterProfile?.email) {
        EmailServiceClient.sendTaskCompleted(requesterProfile.email, {
          recipientName: requesterProfile.name || 'There',
          taskTitle: updatedTask?.title || task.title,
          isTasker: false,
          completedDate: completedDateStr,
          reviewUrl,
          taskUrl,
          userId: requesterProfile.uid,
        }).catch((err) =>
          logger.error('Error sending task_completed email to requester', {
            taskId,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        );
        EmailServiceClient.sendReviewRequest(requesterProfile.email, {
          reviewerName: requesterProfile.name || 'There',
          revieweeName: assigneeProfile?.name || 'Your tasker',
          taskTitle: updatedTask?.title || task.title,
          isRequester: true,
          completedDate: completedDateStr,
          reviewUrl,
          userId: requesterProfile.uid,
        }).catch((err) =>
          logger.error('Error sending review_request email', {
            taskId,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        );
      }
      if (assigneeProfile?.email) {
        EmailServiceClient.sendTaskCompleted(assigneeProfile.email, {
          recipientName: assigneeProfile.name || 'There',
          taskTitle: updatedTask?.title || task.title,
          isTasker: true,
          completedDate: completedDateStr,
          amount: task.budget?.amount,
          reviewUrl,
          taskUrl,
          userId: assigneeProfile.uid,
        }).catch((err) =>
          logger.error('Error sending task_completed email to assignee', {
            taskId,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        );
      }
    } catch (error) {
      logger.error('Error sending completion emails', {
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Auto-request payout immediately after task approved
    const performerUid = updatedTask?.assigneeUid || task.assigneeUid;
    if (updatedTask?.assigneeId && performerUid) {
      try {
        const payoutAmount = typeof task.budget === 'object' ? task.budget.amount : Number(task.budget);
        logger.info(`[Auto-Payout] Initiating auto-payout for task ${taskId}, performer: ${performerUid}, amount: ${payoutAmount}`);
        const payoutResult = await PaymentClient.processTaskCompletionPayout({
          taskId,
          performerUid,
          amount: payoutAmount,
          taskTitle: updatedTask.title || task.title,
          visitId: updatedTask.recurringVisitId ? String(updatedTask.recurringVisitId) : undefined,
        });
        logger.info(`[Auto-Payout] Payout result for task ${taskId}:`, payoutResult);
        
        await InAppNotificationClient.send({
          userId: updatedTask.assigneeId.toString(),
          title: payoutResult.success ? 'Payout Initiated' : 'Payout Initiation Failed',
          body: payoutResult.success
            ? `Task approved. Payout of ₹${payoutAmount} has been initiated automatically.`
            : `Task approved. Payout initiation failed: ${payoutResult.error || 'Please request manually'}.`,
          type: 'info',
          category: 'payments',
          data: {
            taskId,
            actionUrl: '/profile?section=payments',
          },
        });
      } catch (paymentError: any) {
        logger.error(`[Auto-Payout] Error processing auto-payout for task ${taskId}:`, paymentError);
      }
    } else {
      logger.warn('[Auto-Payout] Skipping auto-payout: assignee details missing', { taskId });
    }

    // Emit real-time proof approval
    emitProofApproved(taskId, updatedTask);

    TaskService.invalidateTaskCache(taskId);

    // Update performer profile stats (increment completedTasks & totalTasks)
    if (updatedTask?.assigneeId) {
      UserServiceClient.updatePerformerStats(updatedTask.assigneeId.toString()).catch(err => {
        logger.error(`Error updating performer stats for task ${taskId}:`, err);
      });
    }

    return updatedTask;
  }

  /**
   * Reject completion
   */
  static async rejectCompletion(
    taskId: string,
    taskOwnerProfileId: string,
    reason: string
  ): Promise<any> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is the task owner
    if (task.requesterId?.toString() !== taskOwnerProfileId) {
      throw new ForbiddenError('Only the task owner can reject completion');
    }

    // Check if task is in review status
    if (task.status !== 'review' || task.completionStatus !== 'pending_approval') {
      throw new BadRequestError('Task is not pending approval');
    }

    // Move to in_progress + revision_requested — performer stays assigned and cannot withdraw.
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        status: 'in_progress',
        completionStatus: 'revision_requested',
        completionRejectedReason: reason,
        completionRejectedAt: new Date(),
        $push: {
          feedback: {
            message: reason,
            createdById: new mongoose.Types.ObjectId(taskOwnerProfileId),
            createdAt: new Date(),
          },
        },
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    logger.warn(`Task ${taskId} completion rejected by poster ${taskOwnerProfileId}. Reason: ${reason}`);

    // Emit real-time proof rejection
    emitProofRejected(taskId, { task: updatedTask, reason });

    // Send notifications to tasker about rejection and request to resubmit
    try {
      await notifyHelperRevisionRequested({
        taskId,
        taskTitle: task.title,
        message: reason,
        assigneeId: task.assigneeId,
        assigneeUid: task.assigneeUid,
        posterProfileId: taskOwnerProfileId,
      });
    } catch (error) {
      logger.error('Error sending rejection notification', {
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    TaskService.invalidateTaskCache(taskId);
    return updatedTask;
  }
}
