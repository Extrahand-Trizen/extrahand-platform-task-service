import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { UploadService } from '../services/UploadService';

export class UploadController {
  /**
   * POST /api/v1/uploads/completion-proof/:taskId
   * Upload single completion proof image
   */
  static async uploadCompletionProof(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const { taskId } = req.params;
    const file = (req as any).file;

    if (!file) {
      res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
      return;
    }

    const result = await UploadService.uploadCompletionProof(
      taskId,
      uid,
      file.buffer,
      file.originalname || 'proof.jpg',
      file.mimetype
    );

    res.json({
      success: true,
      data: {
        url: result.url,
        key: result.key
      }
    });
  }

  /**
   * POST /api/v1/uploads/completion-proof/:taskId/multiple
   * Upload multiple completion proof images
   */
  static async uploadMultipleCompletionProofs(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const { taskId } = req.params;
    const files = (req as any).files;

    if (!files || files.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No image files provided'
      });
      return;
    }

    const fileData = files.map((file: any) => ({
      buffer: file.buffer,
      filename: file.originalname || 'proof.jpg',
      mimetype: file.mimetype
    }));

    const results = await UploadService.uploadMultipleCompletionProofs(
      taskId,
      uid,
      fileData
    );

    res.json({
      success: true,
      data: {
        uploads: results
      }
    });
  }

  /**
   * POST /api/v1/uploads/task-image
   * Upload task image (for task creation/editing)
   */
  static async uploadTaskImage(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const file = (req as any).file;
    const { taskId } = req.body;

    if (!file) {
      res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
      return;
    }

    const result = await UploadService.uploadTaskImage(
      uid,
      file.buffer,
      file.originalname || 'task.jpg',
      file.mimetype,
      taskId
    );

    res.json({
      success: true,
      data: {
        url: result.url,
        key: result.key
      }
    });
  }

  /**
   * DELETE /api/v1/uploads/completion-proof/:taskId
   * Delete completion proof image
   */
  static async deleteCompletionProof(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const { taskId } = req.params;
    const { fileKey } = req.body;

    if (!fileKey) {
      res.status(400).json({
        success: false,
        error: 'File key is required'
      });
      return;
    }

    await UploadService.deleteCompletionProof(taskId, uid, fileKey);

    res.json({
      success: true,
      message: 'Completion proof image deleted successfully'
    });
  }
}


