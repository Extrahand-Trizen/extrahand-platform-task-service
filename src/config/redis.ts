import Redis from 'ioredis';
import logger from './logger';
import { config } from './env';

let client: any | null = null;
let isReady = false;

const TASK_LIST_CACHE_TTL_SECONDS = 30;
const CONNECT_TIMEOUT_MS = 10000;

export function getRedisClient(): any | null {
  if (!client || !isReady) {
    return null;
  }
  return client;
}

export async function initRedis(): Promise<void> {
  // Prefer process.env.REDIS_URL so local `.env` overrides match what Upstash gives you,
  // but fall back to validated config.REDIS_URL if set.
  const url = process.env.REDIS_URL || config.REDIS_URL;

  if (!url) {
    logger.info('Redis not configured (REDIS_URL missing); skipping Redis initialization');
    return;
  }

  if (!client) {
    client = new Redis(url, {
      // Don't buffer commands forever if Redis is down
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });

    client.on('error', (err: unknown) => {
      logger.warn('Redis client error (cache disabled for this process):', err instanceof Error ? err.message : err);
      isReady = false;
    });

    client.on('ready', () => {
      logger.info('✅ Redis client connected (ioredis)');
      isReady = true;
    });
  }

  if (!isReady && client) {
    try {
      // With ioredis + lazyConnect we could call connect(), but here we rely
      // on the initial connection attempt and just wait for "ready"/"error".
      await client.ping();
    } catch (err) {
      logger.warn(
        'Redis unreachable, continuing without cache. Check REDIS_URL and ensure your Upstash Redis instance is reachable.',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
      isReady = false;
      try {
        await client.quit();
      } catch {
        // ignore
      }
      client = null;
    }
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.quit();
    logger.info('Redis client disconnected');
  } catch (err) {
    logger.error('Error while disconnecting Redis:', err);
  } finally {
    client = null;
    isReady = false;
  }
}

export const REDIS_TTLS = {
  TASK_LIST_SECONDS: TASK_LIST_CACHE_TTL_SECONDS,
};

