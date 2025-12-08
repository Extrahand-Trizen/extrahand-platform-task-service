import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';

/**
 * Notification Client for Task Service
 * Handles communication with notification service
 */
export class NotificationClient {
  private static baseURL: string;
  private static serviceAuthToken: string;

  static initialize() {
    const env = validateEnv();
    this.baseURL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4005';
    this.serviceAuthToken = env.SERVICE_AUTH_TOKEN  || '';
  }

  /**
   * Send notification to a user
   */
  static async sendNotification(
    userId: string,
    notification: {
      type: string;
      title: string;
      body: string;
      data?: Record<string, any>;
      category?: string;
    }
  ): Promise<void> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      await axios.post(
        `${this.baseURL}/api/v1/notifications/send`,
        {
          userId,
          ...notification
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
            'X-User-Id': userId
          },
          timeout: 10000
        }
      );

      logger.info('Notification sent successfully', {
        userId,
        type: notification.type
      });
    } catch (error) {
      // Don't throw error - notifications are non-critical
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error('Failed to send notification', {
          userId,
          type: notification.type,
          status: axiosError.response?.status,
          message: axiosError.message
        });
      } else {
        logger.error('Failed to send notification', {
          userId,
          type: notification.type,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  /**
   * Send notification to multiple users
   */
  static async sendBatchNotification(
    userIds: string[],
    notification: {
      type: string;
      title: string;
      body: string;
      data?: Record<string, any>;
      category?: string;
    }
  ): Promise<void> {
    try {
      if (!this.baseURL || !this.serviceAuthToken) {
        this.initialize();
      }

      await axios.post(
        `${this.baseURL}/api/v1/notifications/send-batch`,
        {
          userIds,
          ...notification
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service'
          },
          timeout: 30000 // Longer timeout for batch
        }
      );

      logger.info('Batch notification sent successfully', {
        userCount: userIds.length,
        type: notification.type
      });
    } catch (error) {
      // Don't throw error - notifications are non-critical
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error('Failed to send batch notification', {
          userCount: userIds.length,
          type: notification.type,
          status: axiosError.response?.status,
          message: axiosError.message
        });
      } else {
        logger.error('Failed to send batch notification', {
          userCount: userIds.length,
          type: notification.type,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }
}
