import axios from 'axios';
import { validateEnv } from '../config/env';
import logger from '../config/logger';

export class NotificationPreferenceChecker {
  private static userServiceUrl: string = validateEnv().USER_SERVICE_URL;
  private static serviceAuthToken: string = validateEnv().SERVICE_AUTH_TOKEN || '';

  /**
   * Check if a user has enabled email notifications for a specific category.
   *
   * Strategy: fail-open.
   * - We BLOCK only when user-service explicitly returns canSend=false.
   * - If the service is unreachable or misconfigured, we allow the email through.
   *   This avoids blocking all task emails during user-service downtime.
   * - The /can-send endpoint has no auth requirement, so a missing
   *   SERVICE_AUTH_TOKEN no longer silently blocks all emails.
   *
   * @param userUid - Firebase UID of the user
   * @param category - Notification category (e.g., 'taskUpdates')
   * @returns true if email should be sent, false if user has disabled it
   */
  static async isEmailNotificationEnabled(
    userUid: string,
    category: 'taskUpdates' | 'keywordTaskAlerts' | 'recommendedTaskAlerts' | 'payments' | 'system' | 'taskReminders'
  ): Promise<boolean> {
    try {
      if (!this.userServiceUrl) {
        logger.warn('NotificationPreferenceChecker: USER_SERVICE_URL not configured — allowing email (fail-open)');
        return true;
      }

      const headers: Record<string, string> = {
        'X-Service-Name': 'task-service',
      };

      // Include auth token only if available — /can-send doesn't require it
      if (this.serviceAuthToken) {
        headers['X-Service-Auth'] = this.serviceAuthToken;
      }

      const response = await axios.get(
        `${this.userServiceUrl}/api/v1/notification-preferences/${userUid}/can-send`,
        {
          params: {
            channel: 'email',
            category,
          },
          headers,
          timeout: 5000,
        }
      );

      const canSend = response.data?.data?.canSend;

      // Only block when user-service explicitly returns false
      if (canSend === false) {
        logger.info('NotificationPreferenceChecker: Email blocked — user preference is OFF', {
          userUid,
          category,
        });
        return false;
      }

      logger.info('NotificationPreferenceChecker: Email allowed', {
        userUid,
        category,
        canSend,
      });

      return true;

    } catch (error) {
      // fail-open: don't block emails when user-service is temporarily unreachable
      logger.warn('NotificationPreferenceChecker: Could not reach user-service — allowing email (fail-open)', {
        userUid,
        category,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return true;
    }
  }
}
