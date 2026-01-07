import TaskReport, { ITaskReport, ReportReason } from '../models/TaskReport';
import Task from '../models/Task';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';

export class ReportService {
  /**
   * Report a task
   */
  static async reportTask(
    taskId: string,
    userId: string,
    reason: ReportReason,
    description?: string
  ): Promise<ITaskReport> {
    const validReasons: ReportReason[] = [
      'spam',
      'inappropriate_content',
      'fraudulent',
      'duplicate',
      'wrong_category',
      'other'
    ];

    if (!reason || !validReasons.includes(reason)) {
      throw new BadRequestError('Invalid reason');
    }

    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user already reported this task
    const existingReport = await TaskReport.findOne({ userId, taskId });
    if (existingReport) {
      throw new BadRequestError('You have already reported this task');
    }

    // Create report
    const report = await TaskReport.create({
      userId,
      taskId,
      reason,
      description: description || '',
      status: 'pending'
    });

    logger.warn(`Task ${taskId} reported by user ${userId}. Reason: ${reason}`);
    return report;
  }

  /**
   * Get reports for a task (admin/task owner only)
   */
  static async getTaskReports(taskId: string, userId: string): Promise<ITaskReport[]> {
    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Only task owner can see reports (admin check can be added later)
    if (task.requesterId.toString() !== userId) {
      throw new ForbiddenError('Not authorized to view reports');
    }

    const reports = await TaskReport.find({ taskId })
      .sort({ createdAt: -1 })
      .lean();

    return reports as unknown as ITaskReport[];
  }
}

