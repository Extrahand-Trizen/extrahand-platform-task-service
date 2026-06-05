import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';
import { messagingServiceCircuit } from '../utils/CircuitBreaker';

/** Keys must match extrahand-messaging-service whatsappTemplates (legacy keys still accepted). */
export type WhatsAppTemplateKey =
  | 'wa_offer_received'
  | 'wa_offers_digest'
  | 'wa_nearby_work_skill_match'
  | 'wa_work_assigned'
  | 'wa_work_completed_customer'
  | 'wa_work_completed_helper'
  | 'wa_work_cancelled_helper'
  | 'wa_work_cancelled_customer'
  | 'wa_counter_offer_received'
  | 'wa_counter_offer_from_poster'
  | 'wa_negotiation_accepted'
  | 'wa_task_reminder'
  | 'wa_work_starting_soon'
  | 'wa_application_still_open';

export type WhatsAppNotifyPayload = {
  uid: string;
  templateKey: WhatsAppTemplateKey;
  category: 'taskUpdates' | 'taskReminders' | 'payments' | 'recommendedTaskAlerts';
  templateBody?: Record<string, string>;
  idempotencyKey?: string;
  /** Passed to messaging-service for governance caps and ops logs. */
  metadata?: Record<string, unknown>;
};

/**
 * Sends WhatsApp template messages via messaging-service internal API.
 */
export class WhatsAppClient {
  private static baseURL = '';
  private static serviceAuthToken = '';
  private static isInitialized = false;
  private static serviceName = 'task-service';

  static initialize(baseURL?: string, serviceName?: string): void {
    const env = validateEnv();
    this.baseURL = baseURL || env.MESSAGING_SERVICE_URL;
    this.serviceAuthToken = env.SERVICE_AUTH_TOKEN || '';
    this.serviceName = serviceName || process.env.SERVICE_NAME || 'task-service';
    this.isInitialized = true;

    logger.info('WhatsAppClient initialized', {
      baseURL: this.baseURL,
      serviceName: this.serviceName,
      hasAuthToken: !!this.serviceAuthToken,
    });
  }

  private static ensureInitialized(): void {
    if (!this.isInitialized) {
      this.initialize();
    }
  }

  static async notify(payload: WhatsAppNotifyPayload): Promise<boolean> {
    this.ensureInitialized();

    if (!payload?.uid || !payload.templateKey) {
      logger.warn('WhatsAppClient: Invalid payload', { payload });
      return false;
    }

    if (!this.serviceAuthToken) {
      logger.warn('WhatsAppClient: SERVICE_AUTH_TOKEN missing — skipping', {
        templateKey: payload.templateKey,
      });
      return false;
    }

    if (!messagingServiceCircuit.isCallAllowed()) {
      logger.warn('WhatsAppClient: skipped (messaging-service circuit open)', {
        templateKey: payload.templateKey,
        uid: payload.uid,
      });
      return false;
    }

    const url = `${this.baseURL.replace(/\/$/, '')}/api/v1/internal/whatsapp/send`;

    try {
      const response = await axios.post(
        url,
        {
          uid: payload.uid,
          templateKey: payload.templateKey,
          category: payload.category,
          templateBody: payload.templateBody,
          idempotencyKey: payload.idempotencyKey,
          metadata: payload.metadata,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': this.serviceName,
          },
          timeout: 15000,
        }
      );

      const accepted = response.status === 202 || response.data?.accepted;
      const sent = Boolean(response.data?.sent);
      logger.info('WhatsAppClient: notify completed', {
        templateKey: payload.templateKey,
        uid: payload.uid,
        accepted,
        sent,
        skipped: response.data?.skipped,
      });
      messagingServiceCircuit.recordSuccess();
      return sent || accepted;
    } catch (error) {
      messagingServiceCircuit.recordFailure();
      const axiosError = error as AxiosError;
      logger.warn('WhatsAppClient: notify failed', {
        templateKey: payload.templateKey,
        uid: payload.uid,
        status: axiosError.response?.status,
        message: axiosError.message,
        responseData: axiosError.response?.data,
      });
      return false;
    }
  }
}

/** Fire-and-forget WhatsApp notify (never blocks caller). */
export function fireWhatsAppNotify(payload: WhatsAppNotifyPayload): void {
  void WhatsAppClient.notify(payload).catch((err: unknown) => {
    logger.warn('WhatsAppClient: fire-and-forget error', {
      templateKey: payload.templateKey,
      uid: payload.uid,
      message: err instanceof Error ? err.message : String(err),
    });
  });
}
