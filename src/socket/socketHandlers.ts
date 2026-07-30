import { Server as SocketIOServer, Socket } from "socket.io";
import logger from "../config/logger";
import { socketAuthMiddleware } from "../middleware/socketAuth";
import { getRedisClient } from "../config/redis";
import Task from "../models/Task";

// Store io instance globally for use in services
export let io: SocketIOServer;

export function initializeSocketHandlers(ioServer: SocketIOServer) {
  io = ioServer;

  // Apply authentication middleware
  io.use(socketAuthMiddleware);

  // Connection handler
  io.on("connection", (socket: Socket) => {
    const profileId = (socket as any).profileId;
    const locationUpdateSeen = new Set<string>();
    logger.info(`🔌 User connected to task service: ${profileId} (${socket.id})`);

    // Task room subscription
    socket.on("task:join", (data: { taskId: string }) => {
      const { taskId } = data;
      socket.join(`task:${taskId}`);
      logger.info(`📋 User ${profileId} joined task room: ${taskId}`);
    });

    // Task room unsubscription
    socket.on("task:leave", (data: { taskId: string }) => {
      const { taskId } = data;
      socket.leave(`task:${taskId}`);
      logger.info(`👋 User ${profileId} left task room: ${taskId}`);
    });

    // Book Now lead room subscription — partners join category-specific rooms
    socket.on("book-now:join", (data: { categories?: string[] }) => {
      const categories = data.categories || [];
      if (categories.length === 0) {
        socket.join('book-now:all');
        logger.info(`📋 User ${profileId} joined book-now:all`);
      } else {
        categories.forEach((cat) => {
          socket.join(`book-now:${cat}`);
          logger.info(`📋 User ${profileId} joined book-now:${cat}`);
        });
        socket.join('book-now:all');
      }
    });

    // Book Now lead room unsubscription
    socket.on("book-now:leave", (data: { categories?: string[] }) => {
      const categories = data.categories || [];
      if (categories.length === 0) {
        socket.leave('book-now:all');
      } else {
        categories.forEach((cat) => {
          socket.leave(`book-now:${cat}`);
        });
        socket.leave('book-now:all');
      }
      logger.info(`👋 User ${profileId} left book-now rooms`);
    });

    // Partner live location update — broadcast to task room subscribers
    socket.on("partner:location-update", async (data: unknown) => {
      try {
        // Identity comes from socket auth — never trust payload fields for identity
        const profileId = (socket as any).profileId as string;

        // --- Payload validation ---
        if (
          !data ||
          typeof data !== "object" ||
          typeof (data as any).taskId !== "string" ||
          typeof (data as any).lat !== "number" ||
          typeof (data as any).lng !== "number" ||
          typeof (data as any).timestamp !== "number"
        ) {
          logger.warn(`⚠️  partner:location-update rejected — invalid payload from profile: ${profileId}`);
          return;
        }

        const { taskId, lat, lng, timestamp } = data as {
          taskId: string;
          lat: number;
          lng: number;
          timestamp: number;
        };

        // --- Task existence check ---
        const task = await Task.findById(taskId).select("partnerId assigneeId status").lean();
        if (!task) {
          logger.warn(`⚠️  partner:location-update rejected — task ${taskId} not found (profile: ${profileId})`);
          return;
        }

        // --- Partner ownership check ---
        // Accept if profileId matches either partnerId (Book Now flow) or assigneeId (marketplace flow)
        const taskPartnerId = task.partnerId?.toString() ?? null;
        const taskAssigneeId = task.assigneeId?.toString() ?? null;
        if (taskPartnerId !== profileId && taskAssigneeId !== profileId) {
          logger.warn(
            `🚫 partner:location-update rejected — profile ${profileId} is not assigned to task ${taskId}`
          );
          return;
        }

        // --- Active status gate ---
        const activeStatuses = ["assigned", "started", "in_progress"];
        if (!activeStatuses.includes(task.status)) {
          logger.warn(
            `⚠️  partner:location-update ignored — task ${taskId} is in status "${task.status}" (profile: ${profileId})`
          );
          return;
        }

        // --- Redis store (best-effort — app keeps working if Redis is down) ---
        const redis = getRedisClient();
        if (!redis) {
          logger.warn(
            `⚠️  partner:location-update — Redis not available, skipping cache for profile: ${profileId}`,
          );
        } else {
          const key = `partner:location:${profileId}`;
          const value = JSON.stringify({ taskId, lat, lng, timestamp });

          if (!locationUpdateSeen.has(key)) {
            logger.info(`Redis SET starting for key: ${key}`);
          }
          logger.debug(`Redis payload for ${key}: ${value}`);

          await redis.set(key, value, "EX", 30);

          if (!locationUpdateSeen.has(key)) {
            logger.info(`Redis SET completed for key: ${key}`);
            locationUpdateSeen.add(key);
          }

          const stored = await redis.get(key);
          const ttl = await redis.ttl(key);

          logger.debug(`Redis GET for ${key}: ${stored}`);
          logger.debug(`Redis TTL for ${key}: ${ttl}`);
        }

        // --- Fan-out to task room ---
        io.to(`task:${taskId}`).emit("partner:location", { lat, lng, timestamp });
        if (!locationUpdateSeen.has(`task:${taskId}`)) {
          logger.info(`📍 partner:location-update — profile ${profileId} → task:${taskId} [${lat}, ${lng}]`);
          locationUpdateSeen.add(`task:${taskId}`);
        }
      } catch (err) {
        logger.error(`❌ partner:location-update error (profile: ${(socket as any).profileId}):`, err);
      }
    });

    // Disconnection handler
    socket.on("disconnect", (reason) => {
      logger.info(`🔌 User disconnected from task service: ${profileId} (${socket.id}) - ${reason}`);
    });

    // Error handler
    socket.on("error", (error) => {
      logger.error(`❌ Socket error for user ${profileId}:`, error);
    });
  });

  logger.info("✅ Task service Socket.IO event handlers initialized");
}

/**
 * Emit book_now lead removal to all connected partners.
 * Partners in the matching category room receive this so they can remove the lead from their lists.
 */
export function emitBookNowLeadRemoved(
  taskId: string,
  category: string,
  acceptedByProfileId?: string,
): void {
  if (!io) {
    logger.error('Socket.IO not initialized');
    return;
  }

  const room = `book-now:${category}`;
  const payload = { taskId, category, acceptedByProfileId };

  io.to(room).emit('lead:removed', payload);
  io.to(room).emit('book-now:lead-removed', payload);
  logger.info(`📨 Emitted lead removal for task:${taskId} in room:${room}`);

  // Also emit to the general book-now room
  io.to('book-now:all').emit('lead:removed', payload);
  io.to('book-now:all').emit('book-now:lead-removed', payload);
}

// Helper function to emit task status change
export function emitTaskStatusChanged(taskId: string, task: any) {
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:status_changed", task);
  logger.info(`📨 Emitted status change for task:${taskId} - ${task.status}`);
}

// Helper function to emit completion proof submitted
export function emitProofSubmitted(taskId: string, data: any) {
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:proof_submitted", data);
  logger.info(`📸 Emitted proof submission for task:${taskId}`);
}

// Helper function to emit completion proof approved
export function emitProofApproved(taskId: string, data: any) {
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:proof_approved", data);
  logger.info(`✅ Emitted proof approval for task:${taskId}`);
}

// Helper function to emit completion proof rejected
export function emitProofRejected(taskId: string, data: any) {
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:proof_rejected", data);
  logger.info(`❌ Emitted proof rejection for task:${taskId}`);
}

// Helper function to emit task assigned
export function emitTaskAssigned(taskId: string, task: any) {
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:assigned", task);
  logger.info(`👤 Emitted task assignment for task:${taskId}`);
}

