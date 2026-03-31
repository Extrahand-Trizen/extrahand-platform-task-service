/**
 * Notification Constants
 * Single source of truth for notification categories and event keys
 * Must stay in sync with:
 * - NotificationPreferences schema (extrahand-notification-service)
 * - NOTIFICATION_CATALOG.md
 * - NotificationClient validation
 */

/**
 * Valid notification preference categories
 * These must exactly match NotificationPreferences schema keys
 */
export const NOTIFICATION_CATEGORIES = [
  'payments',
  'taskUpdates',
  'taskReminders',
  'keywordTaskAlerts',
  'recommendedTaskAlerts',
  'helpfulInformation',
  'updatesNewsletters'
] as const;

export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];

/**
 * Notification event keys (from NOTIFICATION_CATALOG.md)
 * Use these as eventKey values in NotificationEvent payloads
 */
export const NOTIFICATION_EVENT_KEYS = {
  // Match-driven events
  TASK_CREATED_RECOMMENDED: 'TASK_CREATED_RECOMMENDED',
  TASK_CREATED_KEYWORD: 'TASK_CREATED_KEYWORD',

  // Event-driven events
  TASK_UPDATED: 'TASK_UPDATED',
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  APPLICATION_ACCEPTED: 'APPLICATION_ACCEPTED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',

  // Time-driven events
  TASK_REMINDER_24H: 'TASK_REMINDER_24H',

  // Completion events
  TASK_COMPLETED: 'TASK_COMPLETED',
  REVIEW_REQUEST: 'REVIEW_REQUEST'
} as const;

export type NotificationEventKey = typeof NOTIFICATION_EVENT_KEYS[keyof typeof NOTIFICATION_EVENT_KEYS];

/**
 * Valid entity types for notifications
 */
export const NOTIFICATION_ENTITY_TYPES = ['task', 'application', 'completion'] as const;

export type NotificationEntityType = typeof NOTIFICATION_ENTITY_TYPES[number];

/**
 * Mapping of event keys to their preference categories
 * Use to validate eventKey + category consistency
 */
export const EVENT_KEY_TO_CATEGORY: Record<NotificationEventKey, NotificationCategory> = {
  [NOTIFICATION_EVENT_KEYS.TASK_CREATED_RECOMMENDED]: 'recommendedTaskAlerts',
  [NOTIFICATION_EVENT_KEYS.TASK_CREATED_KEYWORD]: 'keywordTaskAlerts',
  [NOTIFICATION_EVENT_KEYS.TASK_UPDATED]: 'taskUpdates',
  [NOTIFICATION_EVENT_KEYS.APPLICATION_SUBMITTED]: 'taskUpdates',
  [NOTIFICATION_EVENT_KEYS.APPLICATION_ACCEPTED]: 'taskUpdates',
  [NOTIFICATION_EVENT_KEYS.APPLICATION_REJECTED]: 'taskUpdates',
  [NOTIFICATION_EVENT_KEYS.TASK_REMINDER_24H]: 'taskReminders',
  [NOTIFICATION_EVENT_KEYS.TASK_COMPLETED]: 'taskUpdates',
  [NOTIFICATION_EVENT_KEYS.REVIEW_REQUEST]: 'taskUpdates'
};

/**
 * Utility function to validate if eventKey matches its declared category
 * Helps prevent category misuse
 */
export function validateEventKeyCategory(
  eventKey: NotificationEventKey,
  declaredCategory: NotificationCategory
): boolean {
  return EVENT_KEY_TO_CATEGORY[eventKey] === declaredCategory;
}
