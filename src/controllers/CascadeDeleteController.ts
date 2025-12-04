import { Request, Response } from 'express';
import { CascadeDeleteService } from '../services/CascadeDeleteService';
import logger from '../config/logger';

export class CascadeDeleteController {
  /**
   * DELETE /api/v1/cascade-delete/user/:uid
   * Service-to-service endpoint to delete all user-related data
   */
  static async deleteUserData(req: Request, res: Response): Promise<void> {
    try {
      const { uid } = req.params;

      if (!uid) {
        res.status(400).json({
          success: false,
          error: 'User ID (uid) is required'
        });
        return;
      }

      logger.info(`🗑️ Received cascade delete request for user: ${uid}`);

      const result = await CascadeDeleteService.deleteUserData(uid);

      res.json({
        success: true,
        message: 'User data deleted successfully',
        data: result
      });
    } catch (error: any) {
      logger.error('Error in cascade delete:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete user data'
      });
    }
  }
}

