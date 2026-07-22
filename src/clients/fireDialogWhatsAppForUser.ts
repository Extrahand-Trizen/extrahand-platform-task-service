import axios from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';
import { DialogWhatsAppClient } from './DialogWhatsAppClient';

function normalizePhoneForDialog(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

async function canSendWhatsApp(uid: string, category: string): Promise<boolean> {
  const env = validateEnv();
  try {
    const response = await axios.get(
      `${env.USER_SERVICE_URL.replace(/\/$/, '')}/api/v1/notification-preferences/${encodeURIComponent(uid)}/can-send`,
      {
        params: { channel: 'whatsapp', category: category || 'taskUpdates' },
        headers: {
          'X-Service-Auth': env.SERVICE_AUTH_TOKEN || '',
          'X-Service-Name': 'task-service',
        },
        timeout: 5000,
      },
    );
    return response.data?.data?.canSend === true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('canSendWhatsApp (task-service) failed — blocking WhatsApp', { uid, category, message });
    return false;
  }
}

async function resolveUserPhoneDigits(uid: string): Promise<string | null> {
  const env = validateEnv();
  try {
    const response = await axios.get(
      `${env.USER_SERVICE_URL.replace(/\/$/, '')}/api/v1/profiles/internal/${encodeURIComponent(uid)}`,
      {
        headers: {
          'X-Service-Auth': env.SERVICE_AUTH_TOKEN || '',
          'X-Service-Name': 'task-service',
        },
        timeout: 5000,
      },
    );
    const profile = response.data?.profile ?? response.data?.data?.profile ?? response.data?.data;
    const phone =
      profile?.phone || profile?.mobile || profile?.phoneNumber || profile?.alternatePhone || null;
    return normalizePhoneForDialog(phone);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('resolveUserPhoneDigits (task-service) failed', { uid, message });
    return null;
  }
}

/**
 * Fire Dialog WhatsApp for a user when Settings WhatsApp is on.
 * Never throws.
 */
export function fireDialogWhatsAppForUser(input: {
  uid: string;
  eventKey: string;
  category?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): void {
  if (!DialogWhatsAppClient.isConfigured()) return;

  void (async () => {
    try {
      const category = input.category || 'taskUpdates';
      const canSend = await canSendWhatsApp(input.uid, category);
      if (!canSend) {
        logger.warn('Dialog WhatsApp skipped: preferences disabled', {
          uid: input.uid,
          eventKey: input.eventKey,
          category,
        });
        return;
      }

      const phone = await resolveUserPhoneDigits(input.uid);
      if (!phone) {
        logger.warn('Dialog WhatsApp skipped: no phone on profile', {
          uid: input.uid,
          eventKey: input.eventKey,
        });
        return;
      }

      await DialogWhatsAppClient.triggerNotification({
        eventKey: input.eventKey,
        recipientPhone: phone,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error: unknown) {
      logger.warn('Dialog WhatsApp fire error (non-fatal)', {
        uid: input.uid,
        eventKey: input.eventKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}
