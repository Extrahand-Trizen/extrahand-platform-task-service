import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import { NotFoundError, BadRequestError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { uploadFile, deleteFile, getStorageType } from '../utils/storageManager';
import sharp from 'sharp';

interface ProcessedImage {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

const COMPRESSION_SUPPORTED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

async function compressImageIfSupported(
  fileBuffer: Buffer,
  filename: string,
  mimetype: string
): Promise<ProcessedImage> {
  const normalizedType = mimetype.toLowerCase();

  if (!COMPRESSION_SUPPORTED_TYPES.has(normalizedType)) {
    return { buffer: fileBuffer, filename, mimetype };
  }

  try {
    let pipeline = sharp(fileBuffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true });

    if (normalizedType === 'image/png') {
      // Lossless PNG optimization (no quality/color reduction)
      pipeline = pipeline.png({ compressionLevel: 9, palette: false, adaptiveFiltering: true });
    } else if (normalizedType === 'image/webp') {
      // Lossless WebP optimization
      pipeline = pipeline.webp({ lossless: true, effort: 4 });
    } else {
      pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:2:0' });
    }

    const compressed = await pipeline.toBuffer();

    if (compressed.length >= fileBuffer.length) {
      return { buffer: fileBuffer, filename, mimetype };
    }

    logger.info('Image compressed before storage', {
      filename,
      originalSize: fileBuffer.length,
      compressedSize: compressed.length,
      reductionPercent: Number((((fileBuffer.length - compressed.length) / fileBuffer.length) * 100).toFixed(2)),
    });

    return { buffer: compressed, filename, mimetype };
  } catch (error) {
    logger.warn('Image compression skipped due to processing error', {
      filename,
      mimetype,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { buffer: fileBuffer, filename, mimetype };
  }
}

async function assertPerformerCanUploadProof(
  task: { _id: unknown; assigneeId?: unknown },
  performerUid: string,
  performerProfileId?: string,
): Promise<void> {
  const assigneeIdStr = task.assigneeId?.toString();
  const isAssignedPerformer =
    (performerProfileId && assigneeIdStr === performerProfileId) ||
    (assigneeIdStr && assigneeIdStr === performerUid);

  if (isAssignedPerformer) {
    return;
  }

  const applicationQuery: Record<string, unknown> = {
    taskId: task._id,
    status: 'accepted',
  };

  if (performerProfileId) {
    applicationQuery.$or = [
      { applicantUid: performerUid },
      { applicantId: performerProfileId },
    ];
  } else {
    applicationQuery.applicantUid = performerUid;
  }

  const acceptedApplication = await TaskApplication.findOne(applicationQuery);
  if (!acceptedApplication) {
    throw new ForbiddenError('Only the assigned performer can upload completion proof');
  }
}

export class UploadService {
  /**
   * Upload task image (for task creation/editing)
   */
  static async uploadTaskImage(
    userId: string,
    fileBuffer: Buffer,
    filename: string,
    mimetype: string,
    taskId?: string
  ): Promise<{ url: string; key: string }> {
    if (!fileBuffer || !filename) {
      throw new BadRequestError('No image file provided');
    }

    const processed = await compressImageIfSupported(fileBuffer, filename, mimetype);

    // Upload to storage (MinIO, S3, etc.)
    const result = await uploadFile(
      processed.buffer,
      processed.filename,
      processed.mimetype,
      'task-images',
      {
        userId,
        taskId: taskId || 'unknown',
        type: 'task-image'
      }
    );

    logger.info('Task image uploaded', {
      userId,
      taskId,
      url: result.url,
      key: result.key,
      provider: getStorageType()
    });

    return {
      url: result.url,
      key: result.key
    };
  }

  /**
   * Upload completion proof image(s)
   */
  static async uploadCompletionProof(
    taskId: string,
    performerUid: string,
    fileBuffer: Buffer,
    filename: string,
    mimetype: string,
    performerProfileId?: string,
  ): Promise<{ url: string; key: string }> {
    if (!fileBuffer || !filename) {
      throw new BadRequestError('No image file provided');
    }

    // Verify task exists and user has permission
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    await assertPerformerCanUploadProof(task, performerUid, performerProfileId);

    const processed = await compressImageIfSupported(fileBuffer, filename, mimetype);

    // Upload to storage (MinIO, S3, etc.)
    const result = await uploadFile(
      processed.buffer,
      processed.filename,
      processed.mimetype,
      'completion-proofs',
      {
        taskId: taskId,
        userId: performerUid,
        type: 'completion-proof'
      }
    );

    logger.info('Completion proof image uploaded', {
      taskId,
      performerUid,
      url: result.url,
      key: result.key,
      provider: getStorageType()
    });

    // Update task with completion proof URL
    await Task.findByIdAndUpdate(
      taskId,
      {
        $push: {
          completionProof: {
            url: result.url,
            key: result.key,
            uploadedAt: new Date(),
            uploadedBy: performerUid
          }
        },
        updatedAt: new Date()
      }
    );

    return {
      url: result.url,
      key: result.key
    };
  }

  /**
   * Upload multiple completion proof images
   */
  static async uploadMultipleCompletionProofs(
    taskId: string,
    performerUid: string,
    files: Array<{ buffer: Buffer; filename: string; mimetype: string }>,
    performerProfileId?: string,
  ): Promise<Array<{ url: string; key: string }>> {
    if (!files || files.length === 0) {
      throw new BadRequestError('No image files provided');
    }

    // Verify task exists and user has permission
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    await assertPerformerCanUploadProof(task, performerUid, performerProfileId);

    // Upload all files
    const uploadPromises = files.map(async (file) => {
      const processed = await compressImageIfSupported(file.buffer, file.filename, file.mimetype);
      return uploadFile(
        processed.buffer,
        processed.filename,
        processed.mimetype,
        'completion-proofs',
        {
          taskId: taskId,
          userId: performerUid,
          type: 'completion-proof'
        }
      );
    });

    const results = await Promise.all(uploadPromises);

    // Update task with completion proof URLs
    const proofEntries = results.map(result => ({
      url: result.url,
      key: result.key,
      uploadedAt: new Date(),
      uploadedBy: performerUid
    }));

    await Task.findByIdAndUpdate(
      taskId,
      {
        $push: { completionProof: { $each: proofEntries } },
        updatedAt: new Date()
      }
    );

    logger.info('Multiple completion proof images uploaded and saved to task', {
      taskId,
      performerUid,
      count: results.length,
      provider: getStorageType()
    });

    return results;
  }

  /**
   * Delete completion proof image
   */
  static async deleteCompletionProof(
    taskId: string,
    performerUid: string,
    fileKey: string
  ): Promise<void> {
    // Verify task exists and user has permission
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Check if user is the assigned performer
    const isAssignedPerformer = task.assigneeId?.toString() === performerUid;
    let hasAcceptedApplication = false;

    if (!isAssignedPerformer) {
      // Check if user has an accepted application
      const acceptedApplication = await TaskApplication.findOne({
        taskId: task._id,
        applicantUid: performerUid,
        status: 'accepted',
      });
      hasAcceptedApplication = !!acceptedApplication;
    }

    if (!isAssignedPerformer && !hasAcceptedApplication) {
      throw new ForbiddenError('Only the assigned performer can delete completion proof');
    }

    // Check if the file is part of the task's completion proof
    const completionProof = task.completionProof || [];
    const proofExists = completionProof.some((proof: any) => 
      proof.url?.includes(fileKey) || proof.key === fileKey
    );

    if (!proofExists) {
      throw new NotFoundError('Completion proof file not found in task');
    }

    await deleteFile(fileKey);

    // Remove from task's completion proof array
    await Task.findByIdAndUpdate(
      taskId,
      {
        $pull: {
          completionProof: {
            $or: [
              { url: { $regex: fileKey } },
              { key: fileKey }
            ]
          }
        },
        updatedAt: new Date(),
      }
    );

    logger.info('Completion proof image deleted', {
      taskId,
      performerUid,
      fileKey,
      provider: getStorageType()
    });
  }
}


