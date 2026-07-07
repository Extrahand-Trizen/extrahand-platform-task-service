/**
 * In-App Notification Client
 * For backend services to create in-app notifications
 * (Use alongside EmailServiceClient to notify users of email updates)
 */

import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';

export interface InAppNotificationPayload {
  userId: string;
  title: string;
  body: string;
  type?: 'info' | 'warning' | 'error' | 'success';
  category?: string; // taskUpdates, payments, system, etc.
  data?: Record<string, any>;
}

export interface InAppNotificationBatchPayload {
  userIds: string[];
  title: string;
  body: string;
  type?: 'info' | 'warning' | 'error' | 'success';
  category?: string;
  data?: Record<string, any>;
}

/**
 * In-App Notification Client
 * Creates in-app notifications in the notification service
 * 
 * Usage:
 * InAppNotificationClient.initialize();
 * await InAppNotificationClient.send({
 *   userId: 'user-123',
 *   title: 'Task Assigned',
 *   body: 'A new task has been assigned to you',
 *   category: 'taskUpdates'
 * });
 */
export class InAppNotificationClient {
  private static baseURL: string = '';
  private static serviceAuthToken: string = '';
  private static isInitialized: boolean = false;
  private static serviceName: string = 'service-client';

  /**
   * Initialize the client (must be called once at app startup)
   */
  static initialize(baseURL?: string, serviceName?: string): void {
    const env = validateEnv();
    this.baseURL = baseURL || process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4005';
    this.serviceAuthToken = env.SERVICE_AUTH_TOKEN || '';
    this.serviceName = serviceName || process.env.SERVICE_NAME || 'service-client';
    this.isInitialized = true;

    logger.info('InAppNotificationClient initialized', {
      baseURL: this.baseURL,
      serviceName: this.serviceName,
      hasAuthToken: !!this.serviceAuthToken
    });

    if (!this.serviceAuthToken) {
      logger.warn('InAppNotificationClient initialized without SERVICE_AUTH_TOKEN', {
        consequence: 'Notification requests will fail'
      });
    }
  }

  /**
   * Ensure the client is initialized
   */
  private static ensureInitialized(): void {
    if (!this.isInitialized) {
      logger.warn('InAppNotificationClient: Not initialized, calling initialize with defaults');
      this.initialize();
    }
  }

  /**
   * Send a single in-app notification
   */
  static async send(payload: InAppNotificationPayload): Promise<boolean> {
    this.ensureInitialized();

    if (!payload.userId || !payload.title || !payload.body) {
      logger.warn('InAppNotificationClient: Invalid payload', { payload });
      return false;
    }

    try {
      logger.info('InAppNotificationClient: Sending in-app notification', {
        userId: payload.userId,
        type: payload.type || 'info',
        category: payload.category
      });

      await axios.post(
        `${this.baseURL}/api/v1/notifications/in-app/send`,
        {
          userId: payload.userId,
          title: payload.title,
          body: payload.body,
          type: payload.type || 'info',
          category: payload.category,
          data: payload.data
        },
        {
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': this.serviceName,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      logger.info('InAppNotificationClient: In-app notification sent successfully', {
        userId: payload.userId
      });

      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('InAppNotificationClient: Failed to send in-app notification', {
        userId: payload.userId,
        status: axiosError.response?.status,
        message: axiosError.message
      });
      return false;
    }
  }

  /**
   * Send in-app notifications to multiple users
   */
  static async sendBatch(payload: InAppNotificationBatchPayload): Promise<boolean> {
    this.ensureInitialized();

    if (!Array.isArray(payload.userIds) || payload.userIds.length === 0 ||
        !payload.title || !payload.body) {
      logger.warn('InAppNotificationClient: Invalid batch payload', { payload });
      return false;
    }

    try {
      logger.info('InAppNotificationClient: Sending batch in-app notifications', {
        userCount: payload.userIds.length,
        type: payload.type || 'info',
        category: payload.category
      });

      await axios.post(
        `${this.baseURL}/api/v1/notifications/in-app/send-batch`,
        {
          userIds: payload.userIds,
          title: payload.title,
          body: payload.body,
          type: payload.type || 'info',
          category: payload.category,
          data: payload.data
        },
        {
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': this.serviceName,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      logger.info('InAppNotificationClient: Batch in-app notifications sent successfully', {
        userCount: payload.userIds.length
      });

      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('InAppNotificationClient: Failed to send batch in-app notifications', {
        userCount: payload.userIds.length,
        status: axiosError.response?.status,
        message: axiosError.message
      });
      return false;
    }
  }

  /**
   * Send in-app notification with retry logic
   * Designed to be called from email/notification triggers
   */
  static async sendWithRetry(
    payload: InAppNotificationPayload,
    maxRetries: number = 3
  ): Promise<boolean> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const success = await this.send(payload);
        if (success) return true;

        // Wait before retry
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        logger.error(`InAppNotificationClient: Retry attempt ${attempt + 1} failed`, { error });
      }
    }

    logger.error('InAppNotificationClient: Maximum retries exceeded', {
      userId: payload.userId
    });
    return false;
  }

  /**
   * Create in-app notification from email template
   * Extracts relevant info from email data
   */
  static async sendFromEmailTemplate(
    userId: string,
    emailTemplate: string,
    emailData: Record<string, any>,
    category: string = 'taskUpdates'
  ): Promise<boolean> {
    const notifications: Record<string, { title: string; body: string }> = {
      'welcome': {
        title: 'Welcome to ExtraHand!',
        body: `Hi ${emailData.name}, welcome to ExtraHand! Start exploring opportunities.`
      },
      'email_verification': {
        title: 'Verify Your Email',
        body: 'Please verify your email address to complete your account setup.'
      },
      'password_reset': {
        title: 'Password Reset Request',
        body: 'You requested to reset your password. Click the link in the email to proceed.'
      },
      'login_alert': {
        title: 'New Login Detected',
        body: `New login detected${emailData.location ? ` from ${emailData.location}` : ''}. If this wasn't you, please secure your account.`
      },
      'task_posted_confirmation': {
        title: 'Task Posted Successfully',
        body: `Your task "${emailData.taskTitle}" has been posted and is now visible to taskers.`
      },
      'task_assigned_requester': {
        title: 'Task Assigned',
        body: `${emailData.assigneeName} has been assigned to your task "${emailData.taskTitle}".`
      },
      'task_assigned_tasker': {
        title: 'New Task Assignment',
        body: `You have been assigned to task "${emailData.taskTitle}" by ${emailData.requesterName}.`
      },
      'application_submitted': {
        title: 'Application Received',
        body: `${emailData.applicantName} submitted an application to your task "${emailData.taskTitle}".`
      },
      'application_accepted': {
        title: 'Application Accepted',
        body: `Your application for "${emailData.taskTitle}" has been accepted!`
      },
      'application_rejected': {
        title: 'Application Update',
        body: `Your application for "${emailData.taskTitle}" was not accepted this time.`
      },
      'task_cancelled': {
        title: 'Task Cancelled',
        body: `The task "${emailData.taskTitle}" has been cancelled.`
      },
      'task_started': {
        title: 'Task Started',
        body: `Work has started on task "${emailData.taskTitle}".`
      },
      'task_reminder': {
        title: 'Task Reminder',
        body: `Reminder: ${emailData.taskTitle} is scheduled${emailData.scheduledDate ? ` for ${emailData.scheduledDate}` : ''}.`
      },
      'account_suspended': {
        title: 'Account Suspended',
        body: `Your account has been ${emailData.action}. ${emailData.reason ? `Reason: ${emailData.reason}` : ''}`
      }
    };

    const notifConfig = notifications[emailTemplate] || {
      title: 'ExtraHand Notification',
      body: emailData.subject || 'You have a new update'
    };

    return this.send({
      userId,
      title: notifConfig.title,
      body: notifConfig.body,
      type: 'info',
      category,
      data: {
        emailTemplate,
        source: 'email'
      }
    });
  }
}

export default InAppNotificationClient;
