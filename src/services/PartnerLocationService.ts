import { getRedisClient, REDIS_TTLS } from "../config/redis";
import { emitPartnerLocation } from "../socket/taskSocketEmitter";
import mongoose from "mongoose";
import Task from "../models/Task";
import TaskLiveLocation from "../models/TaskLiveLocation";
import { QcDatabase } from "../config/qcDatabase";
import logger from "../config/logger";

export interface PartnerLocationUpdate {
  taskId: string;
  lat: number;
  lng: number;
  timestamp: number;
  forcePersist?: boolean;
}

export type PartnerLocationProcessResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid-payload"
        | "task-not-found"
        | "not-assigned"
        | "inactive-status"
        | "stale-location"
        | "duplicate-location";
    };

type LocationSubject = {
  partnerIds: string[];
  requesterIds: string[];
  status: string;
};

const LOCATION_DB_WRITE_INTERVAL_MS = 60 * 1000;
const LOCATION_DB_WRITE_DISTANCE_METERS = 150;
const LOCATION_MAX_AGE_MS = 2 * 60 * 1000;
const LOCATION_MAX_FUTURE_MS = 30 * 1000;

type LastPersistedLocation = {
  lat: number;
  lng: number;
  persistedAt: number;
};

const lastPersistedLocationByTask = new Map<string, LastPersistedLocation>();
const lastProcessedTimestampByTask = new Map<string, number>();

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isValidCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001);
}

function stringValues(...values: unknown[]): string[] {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => (value == null ? '' : String(value)))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function findLocationSubject(taskId: string): Promise<LocationSubject | null> {
  const task = await Task.findById(taskId).select("partnerId assigneeId status requesterId").lean();
  if (task) {
    return {
      partnerIds: stringValues(task.partnerId, task.assigneeId),
      requesterIds: stringValues(task.requesterId),
      status: String(task.status || ''),
    };
  }

  try {
    const qcConnection = await QcDatabase.getQcConnection();
    const order = await qcConnection.collection('customerorders').findOne({
      _id: new mongoose.Types.ObjectId(taskId),
    });
    if (!order) return null;

    return {
      partnerIds: stringValues(
        order.partnerId,
        order.assigneeId,
        order.assignedTo?.profileId,
        order.partnerUid,
        order.assigneeUid,
        order.assignedTo?.userId,
      ),
      requesterIds: stringValues(order.requesterId, order.userId, order.customerId, order.customerUid),
      status: String(order.status || 'assigned'),
    };
  } catch (error) {
    logger.warn('QC location subject lookup failed', { taskId, error });
    return null;
  }
}

async function persistPartnerLocationSnapshot(params: {
  taskId: string;
  partnerId: string;
  lat: number;
  lng: number;
  timestamp: number;
  forcePersist?: boolean;
}): Promise<void> {
  const cacheKey = `${params.taskId}:${params.partnerId}`;
  const previous = lastPersistedLocationByTask.get(cacheKey);
  const movedEnough = previous
    ? distanceMeters(previous, { lat: params.lat, lng: params.lng }) >= LOCATION_DB_WRITE_DISTANCE_METERS
    : true;
  const waitedEnough = previous
    ? Date.now() - previous.persistedAt >= LOCATION_DB_WRITE_INTERVAL_MS
    : true;

  if (!params.forcePersist && !movedEnough && !waitedEnough) return;

  await TaskLiveLocation.updateOne(
    { taskId: params.taskId },
    {
      $set: {
        taskId: params.taskId,
        partnerId: params.partnerId,
        lat: params.lat,
        lng: params.lng,
        source: "socket",
        recordedAt: new Date(params.timestamp),
      },
    },
    { upsert: true },
  );

  lastPersistedLocationByTask.set(cacheKey, {
    lat: params.lat,
    lng: params.lng,
    persistedAt: Date.now(),
  });
}

/**
 * Shared pipeline for partner live-location updates, used by BOTH the
 * Socket.IO handler (`partner:location-update`) and the REST fallback
 * (`POST /api/v1/tasks/:id/helper-location`):
 *
 *   validate → task ownership check → active-status gate → Redis cache
 *   → durable latest-location snapshot → Socket.IO fan-out to the customer's
 *   `task:{taskId}` room.
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

  const { taskId, lat, lng, forcePersist } = data;
  const timestamp = data.timestamp < 1_000_000_000_000
    ? data.timestamp * 1000
    : data.timestamp;
  if (!isValidCoordinate(lat, lng) || !Number.isFinite(timestamp)) {
    logger.warn(`⚠️  partner location rejected — invalid coordinates from profile: ${profileId}`);
    return { ok: false, reason: "invalid-payload" };
  }

  const now = Date.now();
  const timestampSkewed = timestamp < now - LOCATION_MAX_AGE_MS || timestamp > now + LOCATION_MAX_FUTURE_MS;
  if (timestampSkewed) {
    logger.warn("⚠️  partner location timestamp skew detected — using server time", {
      profileId,
      taskId,
      timestamp,
      serverTimestamp: now,
      skewMs: timestamp - now,
      action: "using-server-receipt-time",
    });
  }

  // Mobile device clocks can drift or jump after resume. The request arrived
  // now, so use the server receipt time rather than dropping an otherwise valid
  // live GPS point.
  const acceptedTimestamp = timestampSkewed ? now : timestamp;

  const subject = await findLocationSubject(taskId);
  if (!subject) {
    logger.warn(`⚠️  partner location rejected — task ${taskId} not found (profile: ${profileId})`);
    return { ok: false, reason: "task-not-found" };
  }

  if (!subject.partnerIds.includes(profileId)) {
    logger.warn(
      `🚫 partner location rejected — profile ${profileId} is not assigned to task ${taskId}`,
    );
    return { ok: false, reason: "not-assigned" };
  }

  const activeStatuses = ["assigned", "started", "in_progress"];
  if (!activeStatuses.includes(subject.status.toLowerCase())) {
    logger.warn(
      `⚠️  partner location ignored — task ${taskId} is in status "${subject.status}" (profile: ${profileId})`,
    );
    return { ok: false, reason: "inactive-status" };
  }

  const processKey = `${taskId}:${profileId}`;
  const previousTimestamp = lastProcessedTimestampByTask.get(processKey);
  if (previousTimestamp != null && acceptedTimestamp <= previousTimestamp) {
    return { ok: false, reason: "duplicate-location" };
  }
  lastProcessedTimestampByTask.set(processKey, acceptedTimestamp);

  // Redis cache (best-effort — app keeps working if Redis is down).
  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `partner:location:${profileId}`;
      const taskKey = `task:partner-location:${taskId}`;
      const value = JSON.stringify({ taskId, lat, lng, timestamp: acceptedTimestamp });
      await redis.set(key, value, "EX", REDIS_TTLS.PARTNER_LOCATION_SECONDS);
      await redis.set(taskKey, value, "EX", REDIS_TTLS.PARTNER_LOCATION_SECONDS);
    } catch (err) {
      logger.warn(`⚠️  partner location — Redis write failed for profile: ${profileId}:`, err);
    }
  } else {
    logger.warn(`⚠️  partner location — Redis not available, skipping cache for profile: ${profileId}`);
  }

  void persistPartnerLocationSnapshot({
    taskId,
    partnerId: profileId,
    lat,
    lng,
    timestamp: acceptedTimestamp,
    forcePersist,
  }).catch((err) => {
    logger.warn("Partner location snapshot persistence failed", {
      taskId,
      partnerId: profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Fan-out to the customer's task room.
  emitPartnerLocation(taskId, { lat, lng, timestamp: acceptedTimestamp });
  logger.info(`📍 partner location — profile ${profileId} → task:${taskId} [${lat}, ${lng}]`);

  return { ok: true };
}
