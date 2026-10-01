import axios from 'axios';
import { validateEnv } from '../config/env';
import logger from '../config/logger';

export class NotificationPreferenceChecker {
  private static userServiceUrl: string = validateEnv().USER_SERVICE_URL;
  private static serviceAuthToken: string = validateEnv().SERVICE_AUTH_TOKEN || '';

  /**
   * Check if a user has enabled email notifications for a specific category.
   *
   * Strategy: fail-closed.
   * - We SEND only when user-service explicitly returns canSend=true.
   * - If user-service is unreachable, rejects the call (user-service gates every route
   *   behind SERVICE_AUTH_TOKEN), or returns an unexpected shape, the email is skipped.
   *   Sending anyway would ignore users who turned email off; in-app/push still deliver.
   *
   * @param userUid - Firebase UID of the user
   * @param category - Notification category (e.g., 'taskUpdates')
   * @returns true if email should be sent, false if user has disabled it or it can't be verified
   */
  static async isEmailNotificationEnabled(
    userUid: string,
    category: 'taskUpdates' | 'keywordTaskAlerts' | 'recommendedTaskAlerts' | 'payments' | 'system' | 'taskReminders'
  ): Promise<boolean> {
    if (!userUid) {
      logger.warn('NotificationPreferenceChecker: Missing userUid — skipping email', { category });
      return false;
    }

    if (!this.userServiceUrl) {
      logger.error('NotificationPreferenceChecker: USER_SERVICE_URL not configured — skipping email', {
        userUid,
        category,
      });
      return false;
    }

    try {
      const headers: Record<string, string> = {
        'X-Service-Name': 'task-service',
      };
      if (this.serviceAuthToken) {
        headers['X-Service-Auth'] = this.serviceAuthToken;
      }

      const response = await axios.get(
        `${this.userServiceUrl}/api/v1/notification-preferences/${encodeURIComponent(userUid)}/can-send`,
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

      if (canSend === true) {
        logger.info('NotificationPreferenceChecker: Email allowed', { userUid, category });
        return true;
      }

      logger.info('NotificationPreferenceChecker: Email blocked — user preference is OFF or unknown', {
        userUid,
        category,
        canSend,
      });
      return false;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      logger.error('NotificationPreferenceChecker: Preference check failed — skipping email', {
        userUid,
        category,
        status,
        hasServiceAuthToken: !!this.serviceAuthToken,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }
}
