import axios from 'axios';
import { validateEnv } from '../config/env';
import logger from '../config/logger';

export class NotificationPreferenceChecker {
  private static userServiceUrl: string = validateEnv().USER_SERVICE_URL;
  private static serviceAuthToken: string = validateEnv().SERVICE_AUTH_TOKEN || '';

  /**
   * Check if a user has enabled email notifications for a specific category
   * @param userUid - Firebase UID of the user
   * @param category - Notification category (e.g., 'taskUpdates', 'keywordTaskAlerts')
   * @returns true if notifications should be sent, false otherwise
   */
  static async isEmailNotificationEnabled(
    userUid: string,
    category: 'taskUpdates' | 'keywordTaskAlerts' | 'recommendedTaskAlerts' | 'payments' | 'transactional' | 'system' | 'taskReminders'
  ): Promise<boolean> {
    try {
      if (!this.userServiceUrl || !this.serviceAuthToken) {
        logger.warn('NotificationPreferenceChecker: User service not configured');
        return false; // Do not send if preferences cannot be checked
      }

      const response = await axios.get(
        `${this.userServiceUrl}/api/v1/notification-preferences/${userUid}/can-send`,
        {
          params: {
            channel: 'email',
            category: category,
          },
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': 'task-service',
          },
          timeout: 5000,
        }
      );

      const canSend = response.data?.data?.canSend;
      
      if (canSend === undefined) {
        logger.warn('NotificationPreferenceChecker: Invalid response format', { userUid });
        return false; // Do not send if response format is unclear
      }

      logger.info('NotificationPreferenceChecker: Permission check result', {
        userUid,
        category,
        canSend,
      });

      return canSend;
    } catch (error) {
      logger.warn('NotificationPreferenceChecker: Failed to check preferences (blocking to avoid unwanted sends)', {
        userUid,
        category,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false; // Do not send if preferences cannot be checked
    }
  }
}
