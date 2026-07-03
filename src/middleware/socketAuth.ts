import { Socket } from "socket.io";
import { ExtendedError } from "socket.io/dist/namespace";
import logger from "../config/logger";

/**
 * Socket.IO authentication middleware for task service
 * Extracts and validates MongoDB profile ID from handshake auth
 */
export function socketAuthMiddleware(
  socket: Socket,
  next: (err?: ExtendedError) => void
) {
  try {
    const profileId = socket.handshake.auth.profileId;

    if (!profileId || typeof profileId !== "string") {
      logger.warn("Socket connection rejected: Missing or invalid profileId");
      return next(new Error("Authentication failed: profileId required"));
    }

    // Attach profileId to socket for use in event handlers
    (socket as any).profileId = profileId;

    logger.info(`✅ Socket authenticated for profile: ${profileId}`);
    next();
  } catch (error) {
    logger.error("Socket authentication error:", error);
    next(new Error("Authentication failed"));
  }
}
