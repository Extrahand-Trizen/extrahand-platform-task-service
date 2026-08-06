import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskLiveLocation from '../models/TaskLiveLocation';
import { AuthenticatedRequest } from '../types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import { getRedisClient } from '../config/redis';

const PARTNER_LOCATION_STALE_AFTER_MS = 2 * 60 * 1000;

type PartnerLocationResponse = {
  taskId: string;
  partnerId: string;
  lat: number;
  lng: number;
  timestamp: number;
  ageSeconds: number;
  isStale: boolean;
  source: 'redis' | 'database';
};

function buildLocationResponse(params: {
  taskId: string;
  partnerId: string;
  lat: number;
  lng: number;
  timestamp: number;
  source: PartnerLocationResponse['source'];
}): PartnerLocationResponse {
  const ageMs = Math.max(0, Date.now() - params.timestamp);
  return {
    taskId: params.taskId,
    partnerId: params.partnerId,
    lat: params.lat,
    lng: params.lng,
    timestamp: params.timestamp,
    ageSeconds: Math.round(ageMs / 1000),
    isStale: ageMs > PARTNER_LOCATION_STALE_AFTER_MS,
    source: params.source,
  };
}

export class PartnerLocationController {
  /**
   * GET /api/v1/tasks/:id/partner-location
   *
   * Returns the last known location of the partner assigned to the given task.
   * Redis is the fast path; the durable task snapshot keeps first paint instant
   * when Redis is unavailable or the cache key has expired.
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

    // Read last location from Redis first.
    const redis = getRedisClient();
    if (redis) {
      const raw =
        (await redis.get(`task:partner-location:${id}`)) ??
        (await redis.get(`partner:location:${partnerId}`));
      if (raw) {
        const locationData = JSON.parse(raw) as {
          taskId: string;
          lat: number;
          lng: number;
          timestamp: number;
        };

        ApiResponse.success(
          res,
          buildLocationResponse({
            taskId: locationData.taskId || id,
            partnerId,
            lat: locationData.lat,
            lng: locationData.lng,
            timestamp: locationData.timestamp,
            source: 'redis',
          }),
          'Partner location retrieved',
        );
        return;
      }
    }

    const stored = await TaskLiveLocation.findOne({ taskId: id, partnerId })
      .select('taskId partnerId lat lng recordedAt')
      .lean();

    if (!stored) {
      throw new NotFoundError('Partner location not available');
    }

    ApiResponse.success(
      res,
      buildLocationResponse({
        taskId: stored.taskId.toString(),
        partnerId: stored.partnerId.toString(),
        lat: stored.lat,
        lng: stored.lng,
        timestamp: stored.recordedAt.getTime(),
        source: 'database',
      }),
      'Partner location retrieved',
    );
  }
}
