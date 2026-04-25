import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { NotFoundError, BadRequestError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { NotificationClient } from './NotificationClient';
import { PaymentClient } from '../services/PaymentClient';
import { EmailServiceClient } from '../clients/EmailServiceClient';
import { InAppNotificationClient } from '../clients/InAppNotificationClient';
import { UserServiceClient } from '../clients/UserServiceClient';
import { config } from '../config/env';
import { emitProofSubmitted, emitProofApproved, emitProofRejected } from '../socket/socketHandlers';
import { TaskService } from './TaskService';

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

    const normalizedProofUrls = Array.isArray(proofUrls) ? proofUrls : [];

    // Proof is optional: if no images are provided, still allow moving to review.
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

    // EMIT: TASK_COMPLETED and REVIEW_REQUEST notifications
    try {
      const Profiles = mongoose.connection.collection('profiles');
      const assigneeProfile = updatedTask?.assigneeId
        ? await Profiles.findOne({ _id: new mongoose.Types.ObjectId(updatedTask.assigneeId) })
        : null;
      const requesterProfile = updatedTask?.requesterId
        ? await Profiles.findOne({ _id: new mongoose.Types.ObjectId(updatedTask.requesterId) })
        : null;

      const assigneeUid = assigneeProfile?.uid || updatedTask?.assigneeId?.toString();
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

    // Trigger direct payout workflow (RazorpayX-only, non-escrow)
    try {
      const Profile = mongoose.connection.collection('profiles');
      const assigneeProfile = task.assigneeId
        ? await Profile.findOne({ _id: task.assigneeId })
        : null;

      const performerUid = assigneeProfile?.uid;
      const taskAmount = task.budget?.amount || 0;

      if (performerUid && taskAmount > 0) {
          logger.info(`🔔 Triggering task completion payout`, {
            taskId,
            performerUid,
            taskAmount,
            taskTitle: task.title,
          });
        const payoutResult = await PaymentClient.processTaskCompletionPayout({
          taskId,
          performerUid,
          amount: taskAmount,
          taskTitle: task.title,
        });

        if (payoutResult.success) {
          logger.info(`✅ Task completion payout processed for task ${taskId}`, {
            performerUid,
            payoutId: payoutResult.payout?.payoutId,
            netAmount: payoutResult.payout?.netAmount,
          });

          await InAppNotificationClient.send({
            userId: task.assigneeId!.toString(),
            title: 'Amount credited',
            body: `Rs ${payoutResult.payout?.netAmount || taskAmount} credited for \"${task.title}\".`,
            type: 'success',
            category: 'payments',
            data: {
              taskId,
              payoutId: payoutResult.payout?.payoutId,
              actionUrl: '/profile?section=payments',
            },
          });
        } else if (payoutResult.requiresBankAccount) {
          logger.warn(`Payout pending bank account for task ${taskId}`, {
            performerUid,
            error: payoutResult.error,
          });

          await InAppNotificationClient.send({
            userId: task.assigneeId!.toString(),
            title: 'Add account to get amount',
            body: 'Add and verify your bank account to receive your task payout.',
            type: 'warning',
            category: 'payments',
            data: {
              taskId,
              actionUrl: '/profile?section=bank-account',
            },
          });
        } else {
          logger.warn(`Task payout failed for task ${taskId}`, {
            performerUid,
            error: payoutResult.error,
          });
        }
      } else {
        logger.warn(`Payout skipped for task ${taskId}: performer UID or task amount missing`, {
          hasPerformerUid: Boolean(performerUid),
          taskAmount,
        });
      }
    } catch (paymentError) {
      logger.error(`Error processing payout for task ${taskId}:`, paymentError);
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

    // Update task status - move back to started so performer can revise and resubmit
    // and record feedback so both poster and tasker can see the requested changes
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        status: 'started',
        completionStatus: 'rejected',
        completionRejectedReason: reason,
        completionRejectedAt: new Date(),
        // Clear completion proof and notes so performer can resubmit
        $unset: {
          completionProof: '',
          completionNotes: ''
        },
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
      const Profile = mongoose.connection.collection('profiles');
      const assigneeProfile = task.assigneeId
        ? await Profile.findOne({ _id: task.assigneeId })
        : null;
      const resubmitUrl = `${config.WEB_APP_URL}/tasks/${taskId}/track`;

      // Notify tasker via FCM + in-app
      if (assigneeProfile?.uid) {
        // FCM Notification
        await NotificationClient.send({
          eventKey: 'TASK_UPDATED',
          category: 'taskUpdates',
          actorId: taskOwnerProfileId,
          recipients: [assigneeProfile.uid],
          entity: { type: 'task', id: taskId },
          title: 'Changes requested on your submission',
          body: `${reason || 'Please revise and resubmit your work.'}`,
          data: {
            taskId,
            status: 'started',
            action: 'resubmit_required',
            taskUrl: resubmitUrl,
          },
        });

        // In-app Notification
        await InAppNotificationClient.send({
       userId: task.assigneeId!.toString(),
          title: 'Changes requested on your submission',
          body: `${reason || 'Please revise and resubmit your work.'}`,
          type: 'warning',
          category: 'taskUpdates',
          data: {
            taskId,
            status: 'started',
            action: 'resubmit_required',
            taskUrl: resubmitUrl,
          },
        });
      }
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
