import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { NotFoundError, BadRequestError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { NotificationClient } from './NotificationClient';
import { EmailServiceClient } from '../clients/EmailServiceClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';
import { fireWhatsAppNotify } from '../clients/WhatsAppClient';
import { fireDialogWhatsAppForUser } from '../clients/fireDialogWhatsAppForUser';
import { taskOpenAppButton } from '../utils/whatsappTaskButtons';
import { UserServiceClient } from '../clients/UserServiceClient';
import { config } from '../config/env';
import { emitProofSubmitted, emitProofApproved, emitProofRejected } from '../socket/socketHandlers';
import { TaskService } from './TaskService';
import { RecurringVisitService } from './RecurringVisitService';
import { notifyHelperRevisionRequested } from './revisionRequestedNotifications';
import { ITask } from '../models/Task';
import { PaymentClient } from './PaymentClient';
import { notifyPosterOnTaskCompleted } from './taskCompletionPosterNotify';
import { isBookNowTaskForCompletion } from '../utils/isBookNowTaskForCompletion';
import { assertBookNowRaiseIssueAllowed } from '../utils/bookNowRaiseIssueWindow';

export class CompletionService {
  /**
   * Submit completion proof.
   * Book Now: auto-completes (payout + notify). Marketplace: review + pending_approval.
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

    const isAssignedPerformer = task.assigneeId?.toString() === performerProfileId;
    let hasAcceptedApplication = false;

    if (!isAssignedPerformer) {
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
    const bookNow = isBookNowTaskForCompletion(task);

    if (bookNow) {
      const updateFields: Record<string, unknown> = {
        status: 'completed',
        completionProof,
        completionNotes: notes || '',
        completionStatus: 'approved',
        reviewAt: submittedAt,
        completionSubmittedAt: submittedAt,
        completedAt: submittedAt,
        completionApprovedAt: submittedAt,
        updatedAt: submittedAt,
      };
      // Persist once — raise-issue 1h window is anchored to first completion.
      if (!task.firstCompletedAt) {
        updateFields.firstCompletedAt = submittedAt;
      }

      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        updateFields,
        { new: true, runValidators: true }
      ).lean();

      logger.info(
        `Book Now task ${taskId} auto-completed on proof submit by profile ${performerProfileId}`
      );

      await this.runApprovedCompletionSideEffects(
        taskId,
        task,
        updatedTask,
        performerProfileId
      );

      TaskService.invalidateTaskCache(taskId);
      return updatedTask;
    }

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
    emitProofSubmitted(taskId, updatedTask);

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
          title: 'work ready for your approval',
          body: `${assigneeProfile?.name || 'Your tasker'} submitted completion for "${task.title}". Approve or request changes.`,
          data: {
            taskId,
            status: 'review',
            action: 'approve_completion',
            actionUrl: approvalPath,
            taskUrl: approvalUrl,
          },
        });

        await InAppNotificationClient.send({
          userId: requesterProfile.uid,
          title: 'work ready for your approval',
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
      }

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
   * Approve completion (marketplace). Book Now blocked — auto-completes on proof submit.
   */
  static async approveCompletion(taskId: string, taskOwnerProfileId: string): Promise<any> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    if (task.requesterId?.toString() !== taskOwnerProfileId) {
      throw new ForbiddenError('Only the task owner can approve completion');
    }

    if (isBookNowTaskForCompletion(task)) {
      throw new BadRequestError(
        'Book Now tasks are completed automatically when the helper submits proof. Customer approval is not required.'
      );
    }

    if (task.status !== 'review' || task.completionStatus !== 'pending_approval') {
      throw new BadRequestError('Task is not pending approval');
    }

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

    await this.runApprovedCompletionSideEffects(
      taskId,
      task,
      updatedTask,
      taskOwnerProfileId
    );

    TaskService.invalidateTaskCache(taskId);
    return updatedTask;
  }

  private static async runApprovedCompletionSideEffects(
    taskId: string,
    previousTask: any,
    updatedTask: any,
    _actorProfileId: string
  ): Promise<void> {
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

    try {
      const Profiles = mongoose.connection.collection('profiles');
      const assigneeProfile = updatedTask?.assigneeId
        ? await Profiles.findOne({ _id: new mongoose.Types.ObjectId(updatedTask.assigneeId) })
        : null;
      const requesterProfile = updatedTask?.requesterId
        ? await Profiles.findOne({ _id: new mongoose.Types.ObjectId(updatedTask.requesterId) })
        : null;

      const assigneeUid = assigneeProfile?.uid;
      const requesterUid = requesterProfile?.uid || String(previousTask.requesterId || '');
      const taskTitle = updatedTask?.title;

      if (assigneeUid) {
        const helperTitle = 'Task completed';
        const helperBody = `Your work on "${taskTitle}" is complete. Great job!`;
        const helperData = {
          taskId,
          taskTitle: taskTitle || 'your task',
          status: 'completed',
          eventKey: 'TASK_COMPLETED_TASKER',
          entityType: 'task',
        };

        await NotificationClient.send({
          eventKey: 'TASK_COMPLETED_TASKER',
          category: 'taskUpdates',
          actorId: requesterUid,
          recipients: [assigneeUid],
          entity: { type: 'task', id: taskId },
          title: helperTitle,
          body: helperBody,
          data: helperData,
        });

        await InAppNotificationClient.send({
          userId: assigneeUid,
          title: helperTitle,
          body: helperBody,
          category: 'taskUpdates',
          type: 'success',
          data: helperData,
        });

        const waMinute = Math.floor(Date.now() / 60000);
        fireDialogWhatsAppForUser({
          uid: assigneeUid,
          eventKey: 'TASK_COMPLETED_TASKER',
          category: 'taskUpdates',
          payload: {
            title: helperTitle,
            body: helperBody,
            taskTitle: taskTitle || 'your task',
            taskId,
            status: 'completed',
          },
          idempotencyKey:
            `eh-push:${assigneeUid}:TASK_COMPLETED_TASKER:${taskId}:${waMinute}`.slice(0, 200),
        });

        fireWhatsAppNotify({
          uid: assigneeUid,
          templateKey: 'wa_work_completed_helper',
          category: 'taskUpdates',
          templateBody: { var_1: taskTitle || 'your task' },
          templateButtons: taskOpenAppButton(taskId),
          idempotencyKey: `completed-helper:${taskId}`,
          metadata: {
            workId: taskId,
            recipientRole: 'helper',
            metaTemplateName: 'extrahand_work_completed_helper',
          },
        });
      }

      if (requesterUid) {
        await notifyPosterOnTaskCompleted({
          taskId: String(taskId),
          taskTitle: taskTitle || 'your work',
          posterUid: requesterUid,
          assigneeUid: assigneeUid ? String(assigneeUid) : undefined,
          actorUid: requesterUid,
        });
      }

      if (assigneeUid && requesterUid) {
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
    } catch (error) {
      logger.error('Error sending completion notifications', {
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    try {
      const Profile = mongoose.connection.collection('profiles');
      const requesterProfile = previousTask.requesterId
        ? await Profile.findOne({ _id: previousTask.requesterId })
        : null;
      const assigneeProfile = previousTask.assigneeId
        ? await Profile.findOne({ _id: previousTask.assigneeId })
        : null;
      const completedDateStr = new Date().toLocaleDateString();
      const taskUrl = `${config.WEB_APP_URL}/tasks/${taskId}/track`;
      const reviewUrl = taskUrl;

      if (requesterProfile?.email) {
        EmailServiceClient.sendTaskCompleted(requesterProfile.email, {
          recipientName: requesterProfile.name || 'There',
          taskTitle: updatedTask?.title || previousTask.title,
          isTasker: false,
          completedDate: completedDateStr,
          reviewUrl,
          taskUrl,
          userId: requesterProfile.uid,
        }).catch(() => undefined);
        EmailServiceClient.sendReviewRequest(requesterProfile.email, {
          reviewerName: requesterProfile.name || 'There',
          revieweeName: assigneeProfile?.name || 'Your tasker',
          taskTitle: updatedTask?.title || previousTask.title,
          isRequester: true,
          completedDate: completedDateStr,
          reviewUrl,
          userId: requesterProfile.uid,
        }).catch(() => undefined);
      }
      if (assigneeProfile?.email) {
        EmailServiceClient.sendTaskCompleted(assigneeProfile.email, {
          recipientName: assigneeProfile.name || 'There',
          taskTitle: updatedTask?.title || previousTask.title,
          isTasker: true,
          completedDate: completedDateStr,
          amount: previousTask.budget?.amount,
          reviewUrl,
          taskUrl,
          userId: assigneeProfile.uid,
        }).catch(() => undefined);
      }
    } catch (error) {
      logger.error('Error sending completion emails', {
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const performerUid = updatedTask?.assigneeUid || previousTask.assigneeUid;
    const hasAssigneeId = !!updatedTask?.assigneeId;
    logger.info('[PAYOUT_DEBUG] Checking auto-payout eligibility', {
      taskId,
      hasAssigneeId,
      performerUid,
      assigneeId_fromUpdated: updatedTask?.assigneeId?.toString(),
      assigneeUid_fromUpdated: updatedTask?.assigneeUid,
      assigneeUid_fromPrevious: previousTask?.assigneeUid,
      taskStatus: updatedTask?.status,
      completionStatus: updatedTask?.completionStatus,
      budget: typeof previousTask.budget === 'object' ? previousTask.budget.amount : Number(previousTask.budget),
      isBookNow: isBookNowTaskForCompletion(previousTask),
    });
    if (hasAssigneeId && performerUid) {
      try {
        const payoutAmount =
          typeof previousTask.budget === 'object'
            ? previousTask.budget.amount
            : Number(previousTask.budget);
        logger.info(`[PAYOUT_DEBUG] Initiating auto-payout for task ${taskId}, performer: ${performerUid}, amount: ${payoutAmount}`);
        const payoutResult = await PaymentClient.processTaskCompletionPayout({
          taskId,
          performerUid,
          amount: payoutAmount,
          taskTitle: updatedTask.title || previousTask.title,
          visitId: updatedTask.recurringVisitId ? String(updatedTask.recurringVisitId) : undefined,
        });
        logger.info(`[PAYOUT_DEBUG] Payout result for task ${taskId}:`, {
          success: payoutResult.success,
          requiresBankAccount: payoutResult.requiresBankAccount,
          error: payoutResult.error,
          payoutId: payoutResult.payout?.payoutId,
          payoutStatus: payoutResult.payout?.status,
          fullResult: JSON.stringify(payoutResult).substring(0, 1000),
        });

        await InAppNotificationClient.send({
          userId: updatedTask.assigneeId.toString(),
          title: payoutResult.success ? 'Payout Initiated' : 'Payout Initiation Failed',
          body: payoutResult.success
            ? `Task completed. Payout of ₹${payoutAmount} has been initiated automatically.`
            : `Task completed. Payout initiation failed: ${payoutResult.error || 'Please request manually'}.`,
          type: 'info',
          category: 'payments',
          data: {
            taskId,
            actionUrl: '/profile?section=payments',
            eventKey: payoutResult.success ? 'PAYOUT_INITIATED' : 'PAYOUT_FAILED',
            entityType: 'payout',
            category: 'payments',
          },
        });
      } catch (paymentError: any) {
        logger.error(`[PAYOUT_DEBUG] Exception processing auto-payout for task ${taskId}:`, {
          message: paymentError?.message,
          stack: paymentError?.stack?.substring(0, 500),
          error: paymentError,
        });
      }
    } else {
      logger.warn('[PAYOUT_DEBUG] Skipping auto-payout: assignee details missing', {
        taskId,
        hasAssigneeId,
        hasPerformerUid: !!performerUid,
        performerUid,
      });
    }

    emitProofApproved(taskId, updatedTask);

    if (updatedTask?.assigneeId) {
      UserServiceClient.updatePerformerStats(updatedTask.assigneeId.toString()).catch(err => {
        logger.error(`Error updating performer stats for task ${taskId}:`, err);
      });
    }
  }

  /**
   * Reject / raise issue.
   * Marketplace: from review. Book Now: from completed (or legacy review) → in_progress.
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

    if (task.requesterId?.toString() !== taskOwnerProfileId) {
      throw new ForbiddenError('Only the task owner can reject completion');
    }

    const bookNow = isBookNowTaskForCompletion(task);
    if (bookNow) {
      assertBookNowRaiseIssueAllowed(task);
    } else if (task.status !== 'review' || task.completionStatus !== 'pending_approval') {
      throw new BadRequestError('Task is not pending approval');
    }

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        status: 'in_progress',
        completionStatus: 'revision_requested',
        completionRejectedReason: reason,
        completionRejectedAt: new Date(),
        // Clear current completion markers so Work Progress shows Work Started.
        // Do NOT clear firstCompletedAt — raise-issue window stays anchored.
        completedAt: null,
        completionApprovedAt: null,
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
    emitProofRejected(taskId, { task: updatedTask, reason });

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
