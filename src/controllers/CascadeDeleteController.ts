import { Request, Response } from 'express';
import { CascadeDeleteService } from '../services/CascadeDeleteService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';
import logger from '../config/logger';

export class CascadeDeleteController {
  /**
   * DELETE /api/v1/cascade-delete/user/:uid
   * Service-to-service endpoint to delete all user-related data
   */
  static async deleteUserData(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;

    if (!uid) {
      throw new BadRequestError('User ID (uid) is required');
    }

    logger.info(`🗑️ Received cascade delete request for user: ${uid}`);

    const result = await CascadeDeleteService.deleteUserData(uid);

    ApiResponse.success(res, result, 'User data deleted successfully');
  }
}

