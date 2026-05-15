import { Request, Response } from 'express';
import { CascadeDeleteService } from '../services/CascadeDeleteService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';
import logger from '../config/logger';

export class CascadeDeleteController {
  /**
   * DELETE /api/v1/cascade-delete/user/:uid/open-tasks
   * Service-to-service endpoint to delete only open posted tasks for a user.
   * Caller should send X-Profile-Id (profile ObjectId) so requester-owned tasks are removed.
   */
  static async deleteOpenPostedTasks(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const profileId = req.headers['x-profile-id'] as string | undefined;

    if (!uid) {
      throw new BadRequestError('User ID (uid) is required');
    }

    logger.info(`🗑️ Received open-task delete request for user: ${uid}, profileId: ${profileId ?? 'not provided'}`);

    const result = await CascadeDeleteService.deleteOpenPostedTasks(uid, profileId);

    ApiResponse.success(res, result, 'Open tasks deleted successfully');
  }

  /**
   * DELETE /api/v1/cascade-delete/user/:uid
   * Service-to-service endpoint to delete all user-related data.
   * Caller should send X-Profile-Id (profile ObjectId) so tasks and other profile-keyed data are deleted.
   */
  static async deleteUserData(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const profileId = req.headers['x-profile-id'] as string | undefined;

    if (!uid) {
      throw new BadRequestError('User ID (uid) is required');
    }

    logger.info(`🗑️ Received cascade delete request for user: ${uid}, profileId: ${profileId ?? 'not provided'}`);

    const result = await CascadeDeleteService.deleteUserData(uid, profileId);

    ApiResponse.success(res, result, 'User data deleted successfully');
  }

  /**
   * GET /api/v1/cascade-delete/user/:uid/active-blockers
   * Service-to-service: active tasks that block account deletion.
   */
  static async getActiveDeletionBlockers(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const profileId = req.headers['x-profile-id'] as string | undefined;

    if (!uid) {
      throw new BadRequestError('User ID (uid) is required');
    }
    if (!profileId) {
      throw new BadRequestError('X-Profile-Id header is required');
    }

    logger.info(`🔎 Active deletion blockers check for user: ${uid}`, { profileId });

    const result = await CascadeDeleteService.getActiveDeletionBlockers(profileId);

    ApiResponse.success(res, result, 'Active deletion blockers retrieved');
  }

  /**
   * GET /api/v1/cascade-delete/user/:uid/tasks-diagnostic
   * Diagnostic endpoint: Returns all tasks for a user (across all statuses)
   * Used to debug why account deletion is being blocked
   */
  static async getUserTasksDiagnostic(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const profileId = req.headers['x-profile-id'] as string | undefined;

    if (!uid) {
      throw new BadRequestError('User ID (uid) is required');
    }

    logger.info(`🔍 Diagnostic request for tasks of user: ${uid}, profileId: ${profileId ?? 'not provided'}`);

    const result = await CascadeDeleteService.getUserTasksDiagnostic(uid, profileId);

    ApiResponse.success(res, result, 'User tasks diagnostic data retrieved');
  }
}

