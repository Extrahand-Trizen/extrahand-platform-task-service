import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';

export class CompletionService {
  /**
   * Submit completion proof
   */
  static async submitCompletionProof(
    taskId: string,
    performerUid: string,
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

    // Check if user is the assigned performer
    const isAssignedPerformer = task.assigneeUid === performerUid;
    let hasAcceptedApplication = false;

    if (!isAssignedPerformer) {
      // Check if user has an accepted application
      const acceptedApplication = await TaskApplication.findOne({
        taskId: task._id,
        applicantUid: performerUid,
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
      uploadedBy: performerUid,
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

    logger.info(`Task ${taskId} completion proof submitted by user ${performerUid}`);
    return updatedTask;
  }

  /**
   * Approve completion
   */
  static async approveCompletion(taskId: string, taskOwnerUid: string): Promise<any> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is the task owner
    if (task.requesterId !== taskOwnerUid) {
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

    logger.info(`Task ${taskId} completion approved by poster ${taskOwnerUid}`);

    // Trigger payment release workflow (placeholder - will call Payment Service)
    try {
      if (task.assigneeUid && task.budget) {
        // TODO: Call Payment Service to release payment
        // await releasePayment(taskId, task.assigneeUid, task.budget, 'INR');
        logger.info(`Payment release initiated for task ${taskId}`);
      }
    } catch (paymentError) {
      // Log payment error but don't fail the request
      // Task is still marked as completed
      logger.error(`Error releasing payment for task ${taskId}:`, paymentError);
    }

    return updatedTask;
  }

  /**
   * Reject completion
   */
  static async rejectCompletion(
    taskId: string,
    taskOwnerUid: string,
    reason: string
  ): Promise<any> {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is the task owner
    if (task.requesterId !== taskOwnerUid) {
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

    logger.warn(`Task ${taskId} completion rejected by poster ${taskOwnerUid}. Reason: ${reason}`);
    return updatedTask;
  }
}

