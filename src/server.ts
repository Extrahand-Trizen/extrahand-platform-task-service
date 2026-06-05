import { createApp } from './app';
import { Database } from './config/database';
import { config } from './config/env';
import logger from './config/logger';
import { NotificationClient } from './services/NotificationClient';
import { UserServiceClient } from './clients/UserServiceClient';
import { EmailServiceClient } from './clients/EmailServiceClient';
import { InAppNotificationClient } from './clients/InAppNotificationClient';
import { WhatsAppClient } from './clients/WhatsAppClient';
import { Fast2SMSClient } from './clients/Fast2SMSClient';
import { ReminderScheduler } from './schedulers/ReminderScheduler';
import { WorkStartSoonScheduler } from './schedulers/WorkStartSoonScheduler';
import { ApplicationFollowUpScheduler } from './schedulers/ApplicationFollowUpScheduler';
import { createSocketServer } from './config/socket.config';
import { initializeSocketHandlers } from './socket/socketHandlers';
import { initRedis, disconnectRedis } from './config/redis';

async function startServer() {
  try {
    // Connect to MongoDB
    if (config.MONGODB_URI) {
      await Database.connectToDb();
    } else {
      logger.warn('⚠️ MONGODB_URI not provided, some features may not work');
    }

    // Initialize clients
    NotificationClient.initialize('task-service');
    UserServiceClient.initialize();
    EmailServiceClient.initialize();
    InAppNotificationClient.initialize();
    WhatsAppClient.initialize();
    Fast2SMSClient.initialize();

    // Initialize schedulers
    await ReminderScheduler.initialize('task-service');
    await WorkStartSoonScheduler.initialize('task-service');
    await ApplicationFollowUpScheduler.initialize('task-service');

    // Initialize Redis (optional, best-effort)
    await initRedis();

    // Create Express app and HTTP server
    const { httpServer } = createApp();

    // Initialize Socket.IO
    const io = createSocketServer(httpServer);
    initializeSocketHandlers(io);

    // Start server
    const port = config.PORT;
    httpServer.listen(port, () => {
      logger.info(`🚀 Task Service running on port ${port}`);
      logger.info(`🔌 Socket.IO enabled`);
      logger.info(`📝 Environment: ${config.NODE_ENV}`);
      logger.info(`🔗 Health check: http://localhost:${port}/api/v1/health`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} signal received: closing HTTP server`);
      
      // Close Socket.IO connections
      io.close(() => {
        logger.info("Socket.IO connections closed");
      });

      httpServer.close(async () => {
        logger.info("HTTP server closed");
        await Database.disconnectFromDb();
        await disconnectRedis();
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error("Could not close connections in time, forcefully shutting down");
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

