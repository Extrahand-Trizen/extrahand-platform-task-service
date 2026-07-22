import axios from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';

export type DialogTriggerInput = {
  eventKey: string;
  recipientPhone: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
};

/**
 * Trigger Dialog notification rules (Meta templates) for ExtraHand events.
 * Used when legacy messaging-service is unavailable / suppressed.
 */
export class DialogWhatsAppClient {
  static isConfigured(): boolean {
    const env = validateEnv();
    const enabled = String(process.env.DIALOG_WHATSAPP_ENABLED || '')
      .trim()
      .toLowerCase();
    return Boolean(
      (enabled === '1' || enabled === 'true' || enabled === 'yes') &&
        process.env.DIALOG_SERVICE_URL &&
        process.env.DIALOG_ORGANIZATION_ID &&
        env.SERVICE_AUTH_TOKEN,
    );
  }

  static async triggerNotification(input: DialogTriggerInput): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const env = validateEnv();
    const base = String(process.env.DIALOG_SERVICE_URL).replace(/\/$/, '');
    const url = `${base}/api/v1/internal/notifications/trigger`;

    try {
      const response = await axios.post(
        url,
        {
          eventKey: input.eventKey,
          recipientPhone: input.recipientPhone,
          payload: input.payload ?? {},
          idempotencyKey: input.idempotencyKey.slice(0, 200),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': env.SERVICE_AUTH_TOKEN || '',
            'X-Organization-Id': process.env.DIALOG_ORGANIZATION_ID || '',
            'X-Service-Name': 'task-service',
          },
          timeout: 12000,
          validateStatus: (s) => s >= 200 && s < 300,
        },
      );

      logger.info('DialogWhatsAppClient: trigger accepted', {
        eventKey: input.eventKey,
        status: response.status,
        eventIngestId: response.data?.data?.eventIngestId,
      });
      return true;
    } catch (error: unknown) {
      const err = error as { message?: string; response?: { status?: number; data?: unknown } };
      logger.warn('DialogWhatsAppClient: trigger failed', {
        eventKey: input.eventKey,
        status: err?.response?.status,
        message: err?.message || 'Unknown error',
        responseData: err?.response?.data,
      });
      return false;
    }
  }
}
