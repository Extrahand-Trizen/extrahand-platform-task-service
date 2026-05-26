import axios from 'axios';
import logger from '../config/logger';
import { config } from '../config/env';

export type MainAdminNotificationEvent = {
  type: 'aadhaar_verification_failed' | 'task_posted';
  userId?: string;
  userName?: string;
  userEmail?: string;
  taskId?: string;
  taskTitle?: string;
  occurredAt?: string;
};

export class MainAdminNotificationClient {
  static async send(event: MainAdminNotificationEvent): Promise<void> {
    if (!config.MAIN_ADMIN_SERVICE_URL) {
      logger.warn('Main admin service URL not configured; skipping admin notification');
      return;
    }

    if (!config.SERVICE_AUTH_TOKEN) {
      logger.warn('SERVICE_AUTH_TOKEN not configured; skipping admin notification');
      return;
    }

    try {
      await axios.post(
        `${config.MAIN_ADMIN_SERVICE_URL}/api/v1/notifications/events`,
        event,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': config.SERVICE_AUTH_TOKEN,
          },
          timeout: 8000,
        }
      );
    } catch (error: any) {
      logger.error('Failed to notify main admin service', {
        error: error.message,
        eventType: event.type,
      });
    }
  }
}
