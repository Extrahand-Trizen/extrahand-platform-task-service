import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/Task';
import { AuthenticatedRequest } from '../types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import { getRedisClient } from '../config/redis';

export class PartnerLocationController {
  /**
   * GET /api/v1/tasks/:id/partner-location
   *
   * Returns the last known location of the partner assigned to the given task.
   * Location data is stored in Redis by the Socket.IO handler with a 30-second TTL.
   * Throws NotFoundError when Redis is unavailable or the key has expired.
   */
  static async getPartnerLocation(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError('Invalid task ID');
    }

    const requesterProfileId = req.user?.profileId?.toString() ?? null;
    if (!requesterProfileId) {
      throw new ForbiddenError('Profile context required');
    }

    // Look up task to resolve its assigned partner's profileId and verify access.
    const task = await Task.findById(id).select('requesterId partnerId assigneeId status').lean();
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const allowedProfileIds = [
      task.requesterId?.toString(),
      task.partnerId?.toString(),
      task.assigneeId?.toString(),
    ].filter(Boolean);
    if (!allowedProfileIds.includes(requesterProfileId)) {
      throw new ForbiddenError('Not authorized to view partner location');
    }

    // Prefer partnerId (Book Now flow); fall back to assigneeId (marketplace flow)
    const partnerId = task.partnerId?.toString() ?? task.assigneeId?.toString() ?? null;
    if (!partnerId) {
      throw new NotFoundError('Partner location not available');
    }

    // Read last location from Redis
    const redis = getRedisClient();
    if (!redis) {
      throw new NotFoundError('Partner location not available');
    }

    const raw = await redis.get(`partner:location:${partnerId}`);
    if (!raw) {
      throw new NotFoundError('Partner location not available');
    }

    const locationData = JSON.parse(raw) as {
      taskId: string;
      lat: number;
      lng: number;
      timestamp: number;
    };

    ApiResponse.success(res, locationData, 'Partner location retrieved');
  }
}
