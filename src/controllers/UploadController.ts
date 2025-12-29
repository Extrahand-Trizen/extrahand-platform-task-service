import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { UploadService } from '../services/UploadService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';

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
      throw new BadRequestError('No image file provided');
    }

    const result = await UploadService.uploadCompletionProof(
      taskId,
      uid,
      file.buffer,
      file.originalname || 'proof.jpg',
      file.mimetype
    );

    ApiResponse.success(res, { url: result.url, key: result.key }, 'Completion proof uploaded successfully');
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
      throw new BadRequestError('No image files provided');
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

    ApiResponse.success(res, { uploads: results }, 'Completion proofs uploaded successfully');
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
      throw new BadRequestError('No image file provided');
    }

    const result = await UploadService.uploadTaskImage(
      uid,
      file.buffer,
      file.originalname || 'task.jpg',
      file.mimetype,
      taskId
    );

    ApiResponse.success(res, { url: result.url, key: result.key }, 'Task image uploaded successfully');
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
      throw new BadRequestError('File key is required');
    }

    await UploadService.deleteCompletionProof(taskId, uid, fileKey);

    ApiResponse.success(res, null, 'Completion proof image deleted successfully');
  }
}


