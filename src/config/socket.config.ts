import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import logger from "./logger";

export function createSocketServer(httpServer: HTTPServer): SocketIOServer {
  const corsOrigins = process.env.CORS_ORIGINS?.split(",") || [
    "http://localhost:4000",  // Frontend dev port
  ];

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  logger.info("✅ Socket.IO server configured");
  logger.info(`🔌 CORS origins: ${corsOrigins.join(", ")}`);

  return io;
}
