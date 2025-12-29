import { createApp } from './app';
import { Database } from './config/database';
import { config } from './config/env';
import logger from './config/logger';
import { NotificationClient } from './services/NotificationClient';
import { UserServiceClient } from './clients/UserServiceClient';
import { ReminderScheduler } from './schedulers/ReminderScheduler';

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

    // Initialize schedulers
    await ReminderScheduler.initialize('task-service');

    // Create Express app
    const app = createApp();

    // Start server
    const port = config.PORT;
    app.listen(port, () => {
      logger.info(`🚀 Task Service running on port ${port}`);
      logger.info(`📝 Environment: ${config.NODE_ENV}`);
      logger.info(`🔗 Health check: http://localhost:${port}/api/v1/health`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      await Database.disconnectFromDb();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT signal received: closing HTTP server');
      await Database.disconnectFromDb();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

