import axios from 'axios';
import logger from '../config/logger';
import { config } from '../config/env';

export type MainAdminNotificationEvent = {
  type: 'aadhaar_verification_failed' | 'task_posted';
  userId?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  taskId?: string;
  taskTitle?: string;
  occurredAt?: string;
};

const LOG_PREFIX = '[TaskPostedInAppNotification][task-service]';

export class MainAdminNotificationClient {
  static async dispatchBookNowWorkWhatsApp(event: {
    taskId: string;
    stage: 'preferred' | 'area_rule' | 'all';
    recipientUids: string[];
    title: string;
    category: string;
    locationLabel: string;
  }): Promise<void> {
    if (!config.MAIN_ADMIN_SERVICE_URL || !config.SERVICE_AUTH_TOKEN) {
      throw new Error('Main Admin WhatsApp dispatch endpoint is not configured');
    }

    const url = `${config.MAIN_ADMIN_SERVICE_URL.replace(/\/+$/, '')}/api/v1/notifications/work-whatsapp-dispatch`;
    await axios.post(url, event, {
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': config.SERVICE_AUTH_TOKEN,
        'X-Service-Name': 'task-service',
      },
      timeout: 30000,
    });
  }

  static async send(event: MainAdminNotificationEvent): Promise<void> {
    if (!config.MAIN_ADMIN_SERVICE_URL) {
      logger.error(`${LOG_PREFIX} MAIN_ADMIN_SERVICE_URL not configured — notification not sent`, {
        service: 'extrahand-platform-task-service',
        eventType: event.type,
        taskId: event.taskId,
      });
      return;
    }

    if (!config.SERVICE_AUTH_TOKEN) {
      logger.error(`${LOG_PREFIX} SERVICE_AUTH_TOKEN not configured — notification not sent`, {
        service: 'extrahand-platform-task-service',
        eventType: event.type,
        taskId: event.taskId,
      });
      return;
    }

    const baseUrl = config.MAIN_ADMIN_SERVICE_URL.replace(/\/+$/, '');
    const url = `${baseUrl}/api/v1/notifications/events`;

    logger.info(`${LOG_PREFIX} Sending task_posted event to main-admin-server`, {
      service: 'extrahand-platform-task-service',
      eventType: event.type,
      taskId: event.taskId,
      taskTitle: event.taskTitle,
      mainAdminUrl: url,
    });

    try {
      const response = await axios.post(url, event, {
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Auth': config.SERVICE_AUTH_TOKEN,
        },
        timeout: 8000,
      });

      if (response.data?.skipped === true) {
        logger.warn(`${LOG_PREFIX} Main-admin skipped notification (no ops assignee)`, {
          service: 'extrahand-platform-task-service',
          eventType: event.type,
          taskId: event.taskId,
          taskTitle: event.taskTitle,
          reason: response.data?.reason,
          response: response.data,
        });
        return;
      }

      logger.info(`${LOG_PREFIX} Main-admin accepted notification after task posted`, {
        service: 'extrahand-platform-task-service',
        eventType: event.type,
        taskId: event.taskId,
        taskTitle: event.taskTitle,
        notificationId: response.data?.data?.notificationId,
        assignedTo: response.data?.data?.assignedTo,
        targetAdminUserIds: response.data?.data?.targetAdminUserIds,
        httpStatus: response.status,
      });
    } catch (error: any) {
      logger.error(`${LOG_PREFIX} Failed to send notification to main-admin-server`, {
        service: 'extrahand-platform-task-service',
        error: error.message,
        eventType: event.type,
        taskId: event.taskId,
        taskTitle: event.taskTitle,
        mainAdminUrl: url,
        httpStatus: error.response?.status,
        responseData: error.response?.data,
      });
      throw error;
    }
  }
}
