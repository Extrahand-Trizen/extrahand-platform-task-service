import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { UploadService } from '../services/UploadService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../errors/AppError';
import logger from '../config/logger';

export class UploadController {
  /**
   * POST /api/v1/uploads/completion-proof/:taskId
   * Upload single completion proof image
   */
  static async uploadCompletionProof(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid, profileId } = req.user!;
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
      file.mimetype,
      profileId?.toString(),
    );

    ApiResponse.success(res, { url: result.url, key: result.key }, 'Completion proof uploaded successfully');
  }

  /**
   * POST /api/v1/uploads/completion-proof/:taskId/multiple
   * Upload multiple completion proof images
   */
  static async uploadMultipleCompletionProofs(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid, profileId } = req.user!;
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
      fileData,
      profileId?.toString(),
    );

    const urls = results.map(r => r.url);
    ApiResponse.success(res, { urls }, 'Completion proofs uploaded successfully');
  }

  /**
   * POST /api/v1/uploads/task-image
   * Upload task image (for task creation/editing)
   */
  static async uploadTaskImage(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user?.uid;
    if (!uid) {
      throw new BadRequestError('Authentication required - user not found');
    }

    const file = (req as any).file;
    const { taskId } = req.body;

    if (!file) {
      throw new BadRequestError('No image file provided');
    }

    if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
      logger.error('Task image upload: invalid file buffer', {
        hasFile: !!file,
        hasBuffer: !!file?.buffer,
        uid
      });
      throw new BadRequestError('Invalid file data received');
    }

    try {
      const result = await UploadService.uploadTaskImage(
        uid,
        file.buffer,
        file.originalname || 'task.jpg',
        file.mimetype,
        taskId
      );

      ApiResponse.success(res, { url: result.url, key: result.key }, 'Task image uploaded successfully');
    } catch (uploadError: unknown) {
      const err = uploadError as Error;
      logger.error('Task image upload failed', {
        error: err?.message,
        stack: err?.stack,
        uid,
        filename: file?.originalname
      });
      throw uploadError;
    }
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


