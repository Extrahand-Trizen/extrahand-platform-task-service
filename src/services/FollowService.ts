import TaskFollow, { ITaskFollow } from '../models/TaskFollow';
import Task from '../models/Task';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import logger from '../config/logger';

export class FollowService {
  /**
   * Follow a task
   */
  static async followTask(taskId: string, userId: string): Promise<ITaskFollow> {
    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if already following
    const existingFollow = await TaskFollow.findOne({ userId, taskId });
    if (existingFollow) {
      throw new BadRequestError('Already following this task');
    }

    // Create follow
    const follow = await TaskFollow.create({
      userId,
      taskId
    });

    logger.info(`User ${userId} followed task ${taskId}`);
    return follow;
  }

  /**
   * Unfollow a task
   */
  static async unfollowTask(taskId: string, userId: string): Promise<void> {
    const follow = await TaskFollow.findOneAndDelete({ userId, taskId });
    
    if (!follow) {
      throw new NotFoundError('Not following this task');
    }

    logger.info(`User ${userId} unfollowed task ${taskId}`);
  }

  /**
   * Check if user is following a task
   */
  static async checkFollowStatus(taskId: string, userId: string): Promise<{ isFollowing: boolean; follow: ITaskFollow | null }> {
    const follow = await TaskFollow.findOne({ userId, taskId });
    
    return {
      isFollowing: !!follow,
      follow: follow ? follow.toObject() : null
    };
  }

  /**
   * Get all tasks followed by user
   */
  static async getFollowedTasks(userId: string, page: number = 1, limit: number = 20): Promise<{ tasks: any[]; total: number; page: number; limit: number }> {
    const MAX_LIMIT = 50;
    const MAX_PAGE = 100;
    const effectiveLimit = Math.min(Math.max(1, Number(limit) || 20), MAX_LIMIT);
    const effectivePage = Math.min(Math.max(1, Number(page) || 1), MAX_PAGE);
    const skip = (effectivePage - 1) * effectiveLimit;

    const follows = await TaskFollow.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(effectiveLimit)
      .populate('taskId')
      .lean();

    const taskIds = follows.map(f => (f.taskId as any)?._id).filter(Boolean);
    const tasks = await Task.find({ _id: { $in: taskIds } }).lean();

    return {
      tasks,
      total: follows.length,
      page: effectivePage,
      limit: effectiveLimit
    };
  }
}



