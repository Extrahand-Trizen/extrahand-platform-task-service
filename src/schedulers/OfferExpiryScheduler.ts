import { DispatchService } from '../services/DispatchService';
import logger from '../config/logger';

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startOfferExpiryScheduler(intervalMs = 30_000): void {
  if (intervalId) return;

  intervalId = setInterval(async () => {
    try {
      const result = await DispatchService.expireOffers();
      if (result.expiredCount > 0) {
        logger.info('Offer expiry scheduler processed offers', result);
      }
    } catch (error) {
      logger.error('Offer expiry scheduler failed', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }, intervalMs);

  logger.info('Offer expiry scheduler started', { intervalMs });
}

export function stopOfferExpiryScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
