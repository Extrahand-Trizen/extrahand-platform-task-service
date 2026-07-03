import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_ENTITY_TYPES,
  validateEventKeyCategory,
  type NotificationCategory,
  type NotificationEntityType
} from '../constants/notifications';

/**
 * Notification Event Payload (Standard Contract)
 * All services must use this exact shape
 */
export interface NotificationEvent {
  eventKey: string; // From NOTIFICATION_CATALOG.md (e.g., 'TASK_CREATED_RECOMMENDED')
  category: NotificationCategory; // Must match NotificationPreferences keys exactly
                                   // Must match eventKey's category mapping

  actorId?: string; // Optional: Who caused the event (for audit/logging)
  recipients?: string[]; // Required for send(); must be empty for sendBatch()

  entity: {
    type: NotificationEntityType;
    id: string;
  };

  title: string; // Short, neutral text
  body: string; // Main message

  data?: Record<string, any>; // Extra info for frontend navigation (taskId, etc.)
  createdAt?: Date;
}

/**
 * Notification Client for Business Services
 *
 * STRICT CONTRACT:
 * - Only two methods: send() and sendBatch()
 * - No other methods allowed
 * - Validates payload strictly
 * - Never checks preferences
 * - Never deals with tokens/email/sms
 *
 * BOOTSTRAP:
 * Call initialize(serviceName) once at app startup.
 * Do not rely on lazy initialization.
 *
 * Usage:
 * 1. send() - for known recipients (direct notifications)
 * 2. sendBatch() - for computed recipients (matching-based notifications)
 *
 * All preference enforcement happens in notification-service.
 */
export class NotificationClient {
  private static baseURL: string = '';
  private static serviceAuthToken: string = '';
  private static serviceName: string = 'unknown';

  /**
   * Initialize NotificationClient with required config
   * MUST be called once at app bootstrap (not lazily)
   *
   * @param serviceName - Name of the service using this client (e.g., 'task-service')
   *
   * Usage:
   * // In app.ts or index.ts at startup
   * NotificationClient.initialize('task-service');
   */
  static initialize(serviceName: string = 'unknown'): void {
    const env = validateEnv();
    this.baseURL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4005';
    this.serviceAuthToken = env.SERVICE_AUTH_TOKEN || '';
    this.serviceName = serviceName;

    logger.info('NotificationClient initialized', {
      serviceName,
      baseURL: this.baseURL,
      hasAuthToken: !!this.serviceAuthToken
    });

    if (!this.serviceAuthToken) {
      logger.warn('NotificationClient initialized without SERVICE_AUTH_TOKEN', {
        serviceName,
        consequence: 'Notifications will fail silently'
      });
    }
  }

  /**
   * PRIVATE: Validate notification event payload
   * Enforces strict contract - fails fast if misused
   */
  private static validatePayload(payload: NotificationEvent, isBatch: boolean): void {
    // Required fields
    if (!payload.eventKey) {
      throw new Error('NotificationClient: eventKey is required');
    }
    if (!payload.category) {
      throw new Error('NotificationClient: category is required');
    }
    if (!payload.entity?.type || !payload.entity?.id) {
      throw new Error('NotificationClient: entity with type and id is required');
    }
    if (!payload.title) {
      throw new Error('NotificationClient: title is required');
    }
    if (!payload.body) {
      throw new Error('NotificationClient: body is required');
    }

    // Recipient validation based on method type
    if (!isBatch) {
      // send() requires recipients in payload
      if (!payload.recipients || payload.recipients.length === 0) {
        throw new Error('NotificationClient.send(): recipients array is required and must not be empty');
      }
    } else {
      // sendBatch() must NOT have recipients in payload (passed separately)
      if (payload.recipients && payload.recipients.length > 0) {
        throw new Error('NotificationClient.sendBatch(): recipients must not be in payload (pass as 2nd argument instead)');
      }
    }

    // Valid categories (from shared constants)
    if (!NOTIFICATION_CATEGORIES.includes(payload.category as NotificationCategory)) {
      throw new Error(
        `NotificationClient: invalid category "${payload.category}". ` +
        `Must be one of: ${NOTIFICATION_CATEGORIES.join(', ')}`

      );
    }

    // Valid entity types (from shared constants)
    if (!NOTIFICATION_ENTITY_TYPES.includes(payload.entity.type as NotificationEntityType)) {
      throw new Error(
        `NotificationClient: invalid entity type "${payload.entity.type}". ` +
        `Must be one of: ${NOTIFICATION_ENTITY_TYPES.join(', ')}`
      );
    }

    // Validate eventKey matches declared category (prevents mismatch bugs)
    try {
      const isValid = validateEventKeyCategory(payload.eventKey as any, payload.category);
      if (!isValid) {
        throw new Error(
          `NotificationClient: eventKey "${payload.eventKey}" does not match category "${payload.category}". ` +
          `Check NOTIFICATION_CATALOG for correct mapping.`
        );
      }
    } catch (err: any) {
      // If eventKey is not in our map, it's invalid
      if (err.message.includes('does not match')) {
        throw err;
      }
      // Otherwise, eventKey is unknown - let it through with warning
      logger.warn('Unknown eventKey in validation', { eventKey: payload.eventKey });
    }
  }

  /**
   * PRIVATE: Apply business logic guardrails to recipients
   * - Remove actor from recipients (no self-notification)
   * - Deduplicate
   * - Filter null/undefined
   */
  private static sanitizeRecipients(recipients: string[], actorId?: string): string[] {
    let sanitized = Array.from(new Set(recipients)) // Deduplicate
      .filter(Boolean) // Remove null/undefined/empty strings
      .filter(id => id.trim() !== ''); // Remove whitespace-only

    // Actor suppression: don't notify the person who caused the action
    if (actorId) {
      sanitized = sanitized.filter(id => id !== actorId);
    }

    return sanitized;
  }

  /**
   * PRIVATE: Generate idempotency key for the event
   * Used by notification-service for deduplication (Step 7)
   *
   * Formula: eventKey:entityId:timestamp(minute-bucket)
   * This ensures:
   * - Same event in same minute gets same eventId (dedup retries)
   * - Different minutes get different IDs (allows legitimate re-sends)
   * - Scheduler can safely retry without duplicates
   */
  private static generateEventId(eventKey: string, entityId: string): string {
    // Minute-bucket timestamp (ensures same event in same minute gets same ID)
    const now = new Date();
    const minuteBucket = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes()
    );
    return `${eventKey}:${entityId}:${minuteBucket.getTime()}`;
  }
   /*
   * Use when recipient IDs are known directly:
   * - Task updates (requester + assignee)
   * - Application status changes (applicant)
   * - Task reminders (requester + assignee)
   * - Task completed (requester)
   * - Review requests
   *
   * @param payload - NotificationEvent with recipients array filled
   *
   * Example:
   * await NotificationClient.send({
   *   eventKey: 'APPLICATION_ACCEPTED',
   *   category: 'taskUpdates',
   *   recipients: ['applicantUid123'],
   *   entity: { type: 'task', id: 'taskId456' },
   *   title: 'Application accepted',
   *   body: 'Your application was accepted',
   *   data: { taskId: 'taskId456' }
   * });
   */
  static async send(payload: NotificationEvent): Promise<void> {
    try {
      // Validate payload
      this.validatePayload(payload, false);

      // Sanitize recipients (remove actor, deduplicate)
      const sanitizedRecipients = this.sanitizeRecipients(
        payload.recipients || [],
        payload.actorId
      );

      // If no recipients left after sanitization, skip
      if (sanitizedRecipients.length === 0) {
        logger.info('Notification skipped - no recipients after sanitization', {
          eventKey: payload.eventKey,
          actorId: payload.actorId
        });
        return;
      }

      // Generate idempotency key
      const eventId = this.generateEventId(payload.eventKey, payload.entity.id);

      const sendPayload = {
        ...payload,
        recipients: sanitizedRecipients,
        eventId,
        createdAt: payload.createdAt || new Date()
      };

      await axios.post(
        `${this.baseURL}/api/v1/notifications/send`,
        sendPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': this.serviceName
          },
          timeout: 10000
        }
      );

      logger.info('Notification sent successfully', {
        eventKey: payload.eventKey,
        recipientCount: sanitizedRecipients.length,
        category: payload.category,
        entityId: payload.entity.id,
        eventId
      });
    } catch (error) {
      // Don't throw error - notifications are non-critical
      // But log it clearly for debugging
      if (error instanceof Error && error.message.includes('NotificationClient:')) {
        // Validation error - this is a code bug
        logger.error('Notification payload validation failed', {
          error: error.message,
          eventKey: payload.eventKey,
          severity: 'code_error'
        });
      } else if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error('Failed to send notification', {
          eventKey: payload.eventKey,
          category: payload.category,
          status: axiosError.response?.status,
          message: axiosError.message,
          severity: 'transient_error'
        });
      } else {
        logger.error('Failed to send notification', {
          eventKey: payload.eventKey,
          error: error instanceof Error ? error.message : 'Unknown error',
          severity: 'unknown_error'
        });
      }
    }
  }

  /**
   * sendBatch() - Send notification to computed recipients
   *
   * Use when recipients are determined by matching logic:
   * - Recommended tasks (skill category match)
   * - Keyword alerts (keyword match)
   *
   * Features:
   * - Automatic deduplication of userIds
   * - Actor suppression (removes actorId from recipients)
   * - Empty batch short-circuit (returns early if no valid recipients)
   * - Idempotency key generation for deduplication in notification-service
   *
   * @param payload - NotificationEvent WITHOUT recipients array
   * @param userIds - Array of user IDs to notify (computed separately)
   *
   * Example:
   * const matchedTaskers = await findTaskersWithSkill(task.category);
   * await NotificationClient.sendBatch(
   *   {
   *     eventKey: 'TASK_CREATED_RECOMMENDED',
   *     category: 'recommendedTaskAlerts',
   *     entity: { type: 'task', id: task._id },
   *     title: 'New task for you',
   *     body: task.title,
   *     data: { category: task.category }
   *   },
   *   matchedTaskers // Pass computed user IDs separately
   * );
   */
  static async sendBatch(payload: NotificationEvent, userIds: string[]): Promise<void> {
    try {
      // Validate payload
      this.validatePayload(payload, true);

      // Validate userIds
      if (!Array.isArray(userIds)) {
        throw new Error('NotificationClient.sendBatch(): userIds must be an array');
      }

      // Sanitize recipients (remove actor, deduplicate, filter empty)
      const sanitizedUserIds = this.sanitizeRecipients(userIds, payload.actorId);

      // If no users left, short-circuit
      if (sanitizedUserIds.length === 0) {
        logger.warn('Batch notification skipped - no valid recipients', {
          eventKey: payload.eventKey,
          originalCount: userIds.length,
          actorId: payload.actorId
        });
        return;
      }

      // Generate idempotency key
      const eventId = this.generateEventId(payload.eventKey, payload.entity.id);

      const sendPayload = {
        ...payload,
        userIds: sanitizedUserIds,
        eventId,
        createdAt: payload.createdAt || new Date()
      };

      await axios.post(
        `${this.baseURL}/api/v1/notifications/send-batch`,
        sendPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': this.serviceName
          },
          timeout: 30000 // Longer timeout for batch
        }
      );

      logger.info('Batch notification sent successfully', {
        eventKey: payload.eventKey,
        recipientCount: sanitizedUserIds.length,
        originalCount: userIds.length,
        category: payload.category,
        entityId: payload.entity.id,
        eventId
      });
    } catch (error) {
      // Don't throw error - notifications are non-critical
      if (error instanceof Error && error.message.includes('NotificationClient')) {
        // Validation error - code bug
        logger.error('Batch notification validation failed', {
          error: error.message,
          eventKey: payload.eventKey,
          userIdCount: userIds.length,
          severity: 'code_error'
        });
      } else if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error('Failed to send batch notification', {
          eventKey: payload.eventKey,
          category: payload.category,
          recipientCount: userIds.length,
          status: axiosError.response?.status,
          message: axiosError.message,
          severity: 'transient_error'
        });
      } else {
        logger.error('Failed to send batch notification', {
          eventKey: payload.eventKey,
          recipientCount: userIds.length,
          error: error instanceof Error ? error.message : 'Unknown error',
          severity: 'unknown_error'
        });
      }
    }
  }

  /**
   * DEPRECATED: Use send() instead
   * Kept for backward compatibility during migration
   *
   * @deprecated Use NotificationClient.send() with NotificationEvent payload
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
    logger.warn('NotificationClient.sendNotification() is deprecated. Use send() instead.', { userId });
    // Forward to send() with new payload format
    await this.send({
      eventKey: notification.type || 'UNKNOWN',
      category: (notification.category || 'payments') as NotificationCategory,
      recipients: [userId],
      entity: { type: 'task', id: 'unknown' },
      title: notification.title,
      body: notification.body,
      data: notification.data
    });
  }

  /**
   * DEPRECATED: Use sendBatch() instead
   * Kept for backward compatibility during migration
   *
   * @deprecated Use NotificationClient.sendBatch() with NotificationEvent payload and userIds array
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
    logger.warn('NotificationClient.sendBatchNotification() is deprecated. Use sendBatch() instead.', {
      userCount: userIds.length
    });
    // Forward to sendBatch() with new payload format
    await this.sendBatch(
      {
        eventKey: notification.type || 'UNKNOWN',
        category: (notification.category || 'payments') as NotificationCategory,
        entity: { type: 'task', id: 'unknown' },
        title: notification.title,
        body: notification.body,
        data: notification.data
      },
      userIds
    );
  }
}



























