import { getRedisClient } from "../config/redis";
import { emitPartnerLocation } from "../socket/socketHandlers";
import Task from "../models/Task";
import logger from "../config/logger";

export interface PartnerLocationUpdate {
  taskId: string;
  lat: number;
  lng: number;
  timestamp: number;
}

export type PartnerLocationProcessResult =
  | { ok: true }
  | { ok: false; reason: "invalid-payload" | "task-not-found" | "not-assigned" | "inactive-status" };

/**
 * Shared pipeline for partner live-location updates, used by BOTH the
 * Socket.IO handler (`partner:location-update`) and the REST fallback
 * (`POST /api/v1/tasks/:id/helper-location`):
 *
 *   validate → task ownership check → active-status gate → Redis cache
 *   (`partner:location:{profileId}`, 30s TTL) → Socket.IO fan-out to the
 *   customer's `task:{taskId}` room.
 */
export async function processPartnerLocationUpdate(
  profileId: string,
  data: PartnerLocationUpdate,
): Promise<PartnerLocationProcessResult> {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.taskId !== "string" ||
    typeof data.lat !== "number" ||
    typeof data.lng !== "number" ||
    typeof data.timestamp !== "number"
  ) {
    logger.warn(`⚠️  partner location rejected — invalid payload from profile: ${profileId}`);
    return { ok: false, reason: "invalid-payload" };
  }

  const { taskId, lat, lng, timestamp } = data;

  const task = await Task.findById(taskId).select("partnerId assigneeId status").lean();
  if (!task) {
    logger.warn(`⚠️  partner location rejected — task ${taskId} not found (profile: ${profileId})`);
    return { ok: false, reason: "task-not-found" };
  }

  const taskPartnerId = task.partnerId?.toString() ?? null;
  const taskAssigneeId = task.assigneeId?.toString() ?? null;
  if (taskPartnerId !== profileId && taskAssigneeId !== profileId) {
    logger.warn(
      `🚫 partner location rejected — profile ${profileId} is not assigned to task ${taskId}`,
    );
    return { ok: false, reason: "not-assigned" };
  }

  const activeStatuses = ["assigned", "started", "in_progress"];
  if (!activeStatuses.includes(task.status)) {
    logger.warn(
      `⚠️  partner location ignored — task ${taskId} is in status "${task.status}" (profile: ${profileId})`,
    );
    return { ok: false, reason: "inactive-status" };
  }

  // Redis cache (best-effort — app keeps working if Redis is down).
  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `partner:location:${profileId}`;
      await redis.set(key, JSON.stringify({ taskId, lat, lng, timestamp }), "EX", 30);
    } catch (err) {
      logger.warn(`⚠️  partner location — Redis write failed for profile: ${profileId}:`, err);
    }
  } else {
    logger.warn(`⚠️  partner location — Redis not available, skipping cache for profile: ${profileId}`);
  }

  // Fan-out to the customer's task room.
  emitPartnerLocation(taskId, { lat, lng, timestamp });
  logger.info(`📍 partner location — profile ${profileId} → task:${taskId} [${lat}, ${lng}]`);

  return { ok: true };
}
