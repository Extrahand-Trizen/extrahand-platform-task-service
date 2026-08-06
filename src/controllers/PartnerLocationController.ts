import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/Task';
import { AuthenticatedRequest } from '../types';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import { getRedisClient } from '../config/redis';
import { processPartnerLocationUpdate } from '../services/PartnerLocationService';

export class PartnerLocationController {
  /**
   * POST /api/v1/tasks/:id/helper-location
   *
   * REST fallback for the helper's live location updates (used when the app is
   * backgrounded and the socket channel is unavailable). Shares the same
   * pipeline as the Socket.IO `partner:location-update` event:
   * validation → ownership check → active-status gate → Redis cache → Socket.IO
   * fan-out to the customer's task room.
   *
   * Identity comes from the gateway-verified X-User-Id / X-Profile-Id headers
   * (authMiddleware) — never from the payload.
   */
  static async postHelperLocation(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const profileId = req.user?.profileId?.toString() ?? null;

    if (!profileId) {
      throw new BadRequestError('Profile identity missing — authentication required');
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError('Invalid task ID');
    }

    const { lat, lng, timestamp } = (req.body ?? {}) as {
      lat?: unknown;
      lng?: unknown;
      timestamp?: unknown;
    };

    const result = await processPartnerLocationUpdate(profileId, {
      taskId: id,
      lat: typeof lat === 'number' ? lat : NaN,
      lng: typeof lng === 'number' ? lng : NaN,
      timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
    });

    if (result.ok) {
      ApiResponse.success(res, { taskId: id, lat, lng, timestamp }, 'Helper location recorded');
      return;
    }
    if (result.reason === 'task-not-found') {
      throw new NotFoundError('Task not found');
    }
    if (result.reason === 'not-assigned') {
      throw new BadRequestError('Helper is not assigned to this task');
    }
    if (result.reason === 'inactive-status') {
      throw new BadRequestError('Task is not in an active tracking status');
    }
    throw new BadRequestError('Invalid location payload');
  }

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

    // Look up task to resolve its assigned partner's profileId
    const task = await Task.findById(id).select('partnerId assigneeId status').lean();
    if (!task) {
      throw new NotFoundError('Task not found');
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
