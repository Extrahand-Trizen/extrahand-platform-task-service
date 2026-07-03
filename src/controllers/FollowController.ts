import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { FollowService } from '../services/FollowService';
import { ApiResponse } from '../utils/ApiResponse';

export class FollowController {
  /**
   * POST /api/v1/tasks/:taskId/follow
   * Follow a task
   */
  static async followTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    const follow = await FollowService.followTask(
      req.params.taskId,
      req.user!.uid
    );

    ApiResponse.created(res, follow, 'Task followed successfully');
  }

  /**
   * DELETE /api/v1/tasks/:taskId/follow
   * Unfollow a task
   */
  static async unfollowTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    await FollowService.unfollowTask(
      req.params.taskId,
      req.user!.uid
    );

    ApiResponse.success(res, null, 'Task unfollowed successfully');
  }

  /**
   * GET /api/v1/tasks/:taskId/follow
   * Check if user is following a task
   */
  static async checkFollowStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await FollowService.checkFollowStatus(
      req.params.taskId,
      req.user!.uid
    );

    ApiResponse.success(res, result, 'Follow status retrieved successfully');
  }

  /**
   * GET /api/v1/tasks/followed
   * Get all tasks followed by user
   */
  static async getFollowedTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { page = 1, limit = 20 } = req.query;
    const result = await FollowService.getFollowedTasks(
      req.user!.uid,
      parseInt(page as string),
      parseInt(limit as string)
    );

    ApiResponse.success(res, result, 'Followed tasks retrieved successfully');
  }
}



