import Task from '../models/Task';
import type { PartnerExecutionStatus } from '../types/supply';
import { BadRequestError, NotFoundError } from '../errors/AppError';

const STATUS_TO_TASK_STATUS: Partial<Record<PartnerExecutionStatus, string>> = {
  assigned: 'assigned',
  started: 'started',
  in_progress: 'in_progress',
  proof_submitted: 'review',
  completed: 'completed',
  cancelled: 'cancelled',
};

export class TaskTransitionService {
  static async setPartnerExecution(
    taskId: string,
    status: PartnerExecutionStatus,
    extras?: {
      offeredAt?: Date;
      offerExpiresAt?: Date;
      arrivedAt?: Date;
      otpRequestedAt?: Date;
      otpVerifiedAt?: Date;
      proofSubmittedAt?: Date;
      cancellationReason?: 'customer' | 'partner' | 'expired' | 'ops';
    },
  ) {
    const task = await Task.findById(taskId);
    if (!task) throw new NotFoundError('Task not found');

    const now = new Date();
    task.partnerExecution = {
      ...(task.partnerExecution ?? {}),
      status,
      updatedAt: now,
      ...extras,
    };

    const mappedTaskStatus = STATUS_TO_TASK_STATUS[status];
    if (mappedTaskStatus && task.status !== mappedTaskStatus) {
      task.status = mappedTaskStatus as typeof task.status;
      if (status === 'assigned') task.assignedAt = task.assignedAt ?? now;
      if (status === 'started') task.startedAt = task.startedAt ?? now;
      if (status === 'in_progress') task.inProgressAt = task.inProgressAt ?? now;
      if (status === 'proof_submitted') task.completionSubmittedAt = task.completionSubmittedAt ?? now;
      if (status === 'completed') task.completedAt = task.completedAt ?? now;
      if (status === 'cancelled') task.cancelledAt = task.cancelledAt ?? now;
    }

    await task.save();
    return task;
  }

  static async setPartnerMilestone(taskId: string, milestone: PartnerExecutionStatus) {
    if (taskId === undefined) throw new BadRequestError('taskId required');
    return this.setPartnerExecution(taskId, milestone);
  }
}
