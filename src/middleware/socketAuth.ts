import { Socket } from "socket.io";
import { ExtendedError } from "socket.io/dist/namespace";
import mongoose from "mongoose";
import logger from "../config/logger";
import { auth } from "../config/firebase";

/**
 * Socket.IO authentication middleware for task service
 * Extracts and validates MongoDB profile ID from handshake auth
 */
export function socketAuthMiddleware(
  socket: Socket,
  next: (err?: ExtendedError) => void
) {
  void authenticateSocket(socket, next);
}

async function authenticateSocket(
  socket: Socket,
  next: (err?: ExtendedError) => void,
): Promise<void> {
  try {
    const token = socket.handshake.auth?.token;
    const providedProfileId = socket.handshake.auth?.profileId;

    if (token && typeof token === "string") {
      const decoded = await auth.verifyIdToken(token);
      const uid = decoded.uid;
      const Profile = mongoose.connection.collection("profiles");

      let profile: { _id: mongoose.Types.ObjectId } | null = null;
      if (
        providedProfileId &&
        typeof providedProfileId === "string" &&
        mongoose.Types.ObjectId.isValid(providedProfileId)
      ) {
        profile = (await Profile.findOne(
          { _id: new mongoose.Types.ObjectId(providedProfileId), uid },
          { projection: { _id: 1 } },
        )) as { _id: mongoose.Types.ObjectId } | null;
      }

      if (!profile) {
        profile = (await Profile.findOne(
          { uid },
          { projection: { _id: 1 } },
        )) as { _id: mongoose.Types.ObjectId } | null;
      }

      if (!profile?._id) {
        logger.warn("Socket connection rejected: verified uid has no profile", { uid });
        return next(new Error("Authentication failed: profile required"));
      }

      (socket as any).uid = uid;
      (socket as any).profileId = profile._id.toString();
      logger.info(`✅ Socket authenticated for profile: ${profile._id.toString()}`);
      next();
      return;
    }

    if (process.env.NODE_ENV === "production") {
      logger.warn("Socket connection rejected: Missing Firebase token");
      return next(new Error("Authentication failed: token required"));
    }

    if (!providedProfileId || typeof providedProfileId !== "string") {
      logger.warn("Socket connection rejected: Missing or invalid profileId");
      return next(new Error("Authentication failed: profileId required"));
    }

    // Development fallback only. Production identity must come from Firebase token.
    (socket as any).profileId = providedProfileId;
    logger.info(`✅ Socket authenticated for profile: ${providedProfileId} (development fallback)`);
    next();
  } catch (error) {
    logger.error("Socket authentication error:", error);
    next(new Error("Authentication failed"));
  }
}
