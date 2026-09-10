import { Response } from 'express';
import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskLiveLocation from '../models/TaskLiveLocation';
import { QcDatabase } from '../config/qcDatabase';
import { AuthenticatedRequest } from '../types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import { getRedisClient } from '../config/redis';
import { processPartnerLocationUpdate } from '../services/PartnerLocationService';
import logger from '../config/logger';

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

    const { lat, lng, timestamp, forcePersist } = (req.body ?? {}) as {
      lat?: unknown;
      lng?: unknown;
      timestamp?: unknown;
      forcePersist?: unknown;
    };

    const result = await processPartnerLocationUpdate(profileId, {
      taskId: id,
      lat: typeof lat === 'number' ? lat : NaN,
      lng: typeof lng === 'number' ? lng : NaN,
      timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      forcePersist: forcePersist === true,
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
    let allowedProfileIds: string[];
    let partnerId: string | null;

    if (task) {
      allowedProfileIds = [task.requesterId?.toString(), task.partnerId?.toString(), task.assigneeId?.toString()].filter(Boolean) as string[];
      partnerId = task.partnerId?.toString() ?? task.assigneeId?.toString() ?? null;
    } else {
      const qcConnection = await QcDatabase.getQcConnection();
      const order = await qcConnection.collection('customerorders').findOne({
        _id: new mongoose.Types.ObjectId(id),
      });
      if (!order) throw new NotFoundError('Task not found');

      allowedProfileIds = [
        order.requesterId,
        order.userId,
        order.customerId,
        order.customerUid,
        order.partnerId,
        order.assigneeId,
        order.assignedTo?.profileId,
        order.partnerUid,
        order.assigneeUid,
        order.assignedTo?.userId,
      ].filter(Boolean).map(String);
      partnerId = [order.partnerId, order.assigneeId, order.assignedTo?.profileId, order.partnerUid, order.assigneeUid, order.assignedTo?.userId]
        .find(Boolean)?.toString() ?? null;
    }

    if (!allowedProfileIds.includes(requesterProfileId)) {
      throw new ForbiddenError('Not authorized to view partner location');
    }

    // Prefer partnerId (Book Now flow); fall back to assigneeId (marketplace flow)
    if (!partnerId) {
      logger.warn('Partner location lookup missed — task has no assigned partner', {
        taskId: id,
        requesterProfileId,
      });
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
        logger.info('Partner location lookup hit Redis', {
          taskId: id,
          partnerId,
        });
        return;
      }
    }

    const stored = await TaskLiveLocation.findOne({ taskId: id, partnerId })
      .select('taskId partnerId lat lng recordedAt')
      .lean();

    if (!stored) {
      logger.warn('Partner location lookup missed — no Redis/DB snapshot', {
        taskId: id,
        partnerId,
        redisReady: Boolean(redis),
      });
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
    logger.info('Partner location lookup hit database', {
      taskId: id,
      partnerId,
    });
  }
}
