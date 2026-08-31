import { Server as SocketIOServer, Socket } from "socket.io";
import Task from "../models/Task";
import logger from "../config/logger";
import { socketAuthMiddleware } from "../middleware/socketAuth";
import { processPartnerLocationUpdate } from "../services/PartnerLocationService";
import {
  getTaskSocketServer,
  setTaskSocketServer,
} from "./taskSocketEmitter";

// Store io instance globally for use in services
export { emitPartnerLocation } from "./taskSocketEmitter";

export function initializeSocketHandlers(ioServer: SocketIOServer) {
  setTaskSocketServer(ioServer);
  const io = ioServer;

  // Apply authentication middleware
  io.use(socketAuthMiddleware);

  // Connection handler
  io.on("connection", (socket: Socket) => {
    const profileId = (socket as any).profileId;
    logger.info(`🔌 User connected to task service: ${profileId} (${socket.id})`);

    // Task room subscription
    socket.on("task:join", async (data: { taskId: string }) => {
      try {
        const { taskId } = data;
        if (!taskId || typeof taskId !== "string") {
          logger.warn(`⚠️ task:join rejected — invalid taskId from profile: ${profileId}`);
          return;
        }

        const task = await Task.findById(taskId).select("requesterId partnerId assigneeId").lean();
        if (!task) {
          logger.warn(`⚠️ task:join rejected — task ${taskId} not found (profile: ${profileId})`);
          return;
        }

        const allowedProfileIds = [
          task.requesterId?.toString(),
          task.partnerId?.toString(),
          task.assigneeId?.toString(),
        ].filter(Boolean);

        if (!allowedProfileIds.includes(profileId)) {
          logger.warn(`🚫 task:join rejected — profile ${profileId} cannot join task ${taskId}`);
          return;
        }

        socket.join(`task:${taskId}`);
        logger.info(`📋 User ${profileId} joined task room: ${taskId}`);
      } catch (err) {
        logger.error(`❌ task:join error (profile: ${profileId}):`, err);
      }
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
    // (shared pipeline also used by POST /api/v1/tasks/:id/helper-location).
    socket.on("partner:location-update", async (data: unknown) => {
      try {
        const profileId = (socket as any).profileId as string;
        const result = await processPartnerLocationUpdate(profileId, data as any);
        if (!result.ok) {
          logger.warn("partner:location-update rejected", {
            profileId,
            reason: result.reason,
          });
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
  const io = getTaskSocketServer();
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
  const io = getTaskSocketServer();
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:status_changed", task);
  logger.info(`📨 Emitted status change for task:${taskId} - ${task.status}`);
}

// Helper function to emit completion proof submitted
export function emitProofSubmitted(taskId: string, data: any) {
  const io = getTaskSocketServer();
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:proof_submitted", data);
  logger.info(`📸 Emitted proof submission for task:${taskId}`);
}

// Helper function to emit completion proof approved
export function emitProofApproved(taskId: string, data: any) {
  const io = getTaskSocketServer();
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:proof_approved", data);
  logger.info(`✅ Emitted proof approval for task:${taskId}`);
}

// Helper function to emit completion proof rejected
export function emitProofRejected(taskId: string, data: any) {
  const io = getTaskSocketServer();
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:proof_rejected", data);
  logger.info(`❌ Emitted proof rejection for task:${taskId}`);
}

// Helper function to emit task assigned
export function emitTaskAssigned(taskId: string, task: any) {
  const io = getTaskSocketServer();
  if (!io) {
    logger.error("Socket.IO not initialized");
    return;
  }
  
  io.to(`task:${taskId}`).emit("task:assigned", task);
  logger.info(`👤 Emitted task assignment for task:${taskId}`);
}

