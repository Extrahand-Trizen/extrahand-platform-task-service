import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { PaymentClient } from './PaymentClient';
import { NotificationClient } from './NotificationClient';

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

    // Validate proof URLs
    if (!proofUrls || !Array.isArray(proofUrls) || proofUrls.length === 0) {
      throw new BadRequestError('At least one proof image is required');
    }

    // Update task with completion proof
    const completionProof = proofUrls.map(url => ({
      url,
      filename: url.split('/').pop() || 'proof.jpg',
      uploadedAt: new Date(),
      uploadedBy: performerProfileId,
    }));

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        status: 'review',
        completionProof,
        completionNotes: notes || '',
        completionStatus: 'pending_approval',
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    logger.info(`Task ${taskId} completion proof submitted by profile ${performerProfileId}`);
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
      // Get assignee info for context
      const assigneeUid = updatedTask?.assigneeId?.toString();
      const taskTitle = updatedTask?.title;

      // TASK_COMPLETED - Notify requester that task is done
      await NotificationClient.send(
        {
          eventKey: 'TASK_COMPLETED',
          category: 'taskUpdates',
          actorId: taskOwnerProfileId,
          recipients: [taskOwnerProfileId],
          entity: { type: 'task', id: taskId },
          title: `Task Completed: ${taskTitle}`,
          body: `Your task has been completed successfully. Thank you for using ExtraHand!`,
          data: {
            taskId,
            status: 'completed'
          }
        }
      );

      // REVIEW_REQUEST - Prompt requester to review the tasker
      await NotificationClient.send(
        {
          eventKey: 'REVIEW_REQUEST',
          category: 'taskUpdates',
          actorId: taskOwnerProfileId,
          recipients: [taskOwnerProfileId],
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

    // Trigger payment auto-release workflow - Set auto-release date with grace period
    // This allows for revisions before automatic payout
    try {
      // First, check if there's an escrow for this task
      const escrow = await PaymentClient.getEscrowByTaskId(taskId);
      
      if (escrow && escrow.razorpayOrderId) {
        // Calculate auto-release date (grace period: 1 minute for testing, ideally 12 hours)
        // TODO: Make grace period configurable via environment variable
        const gracePeriodMinutes = 1; // For testing - should be 720 (12 hours) in production
        const autoReleaseDate = new Date();
        autoReleaseDate.setMinutes(autoReleaseDate.getMinutes() + gracePeriodMinutes);

        // Set auto-release date instead of immediate release
        const autoReleaseResult = await PaymentClient.setAutoReleaseDate(
          escrow.razorpayOrderId,
          autoReleaseDate
        );

        if (autoReleaseResult.success) {
          logger.info(`✅ Escrow auto-release date set successfully for task ${taskId}`, {
            escrowId: escrow.escrowId,
            razorpayOrderId: escrow.razorpayOrderId,
            amount: escrow.amountInRupees,
            autoReleaseDate: autoReleaseDate.toISOString(),
            gracePeriodMinutes,
          });
        } else {
          logger.warn(`⚠️ Failed to set auto-release date for task ${taskId}:`, autoReleaseResult.error);
          // Don't fail the request - task is still marked as completed
        }
      } else {
        logger.info(`No escrow found for task ${taskId} - skipping payment auto-release setup`);
      }
    } catch (paymentError) {
      // Log payment error but don't fail the request
      // Task is still marked as completed
      logger.error(`Error setting auto-release date for task ${taskId}:`, paymentError);
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

    // Update task status - move back to in_progress so performer can fix issues
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        status: 'in_progress',
        completionStatus: 'rejected',
        completionRejectedReason: reason,
        completionRejectedAt: new Date(),
        // Clear completion proof and notes so performer can resubmit
        $unset: { 
          completionProof: '',
          completionNotes: ''
        },
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).lean();

    logger.warn(`Task ${taskId} completion rejected by poster ${taskOwnerProfileId}. Reason: ${reason}`);
    return updatedTask;
  }
}

