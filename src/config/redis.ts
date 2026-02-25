import type { RedisClientType } from 'redis';
import { createClient } from 'redis';
import logger from './logger';
import { config } from './env';

let client: RedisClientType | null = null;
let isReady = false;

const TASK_LIST_CACHE_TTL_SECONDS = 30;
const CONNECT_TIMEOUT_MS = 10000;

export function getRedisClient(): RedisClientType | null {
  if (!client || !isReady) {
    return null;
  }
  return client;
}

export async function initRedis(): Promise<void> {
  const url = config.REDIS_URL;

  if (!url) {
    logger.info('Redis not configured (REDIS_URL missing); skipping Redis initialization');
    return;
  }

  if (!client) {
    client = createClient({
      url,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        // Stop reconnecting after first failure so we don't spam timeout errors
        reconnectStrategy: false,
      },
    });

    client.on('error', (err: unknown) => {
      logger.warn('Redis client error (cache disabled for this process):', err instanceof Error ? err.message : err);
      isReady = false;
    });

    client.on('ready', () => {
      logger.info('✅ Redis client connected');
      isReady = true;
    });
  }

  if (!isReady) {
    try {
      await client.connect();
    } catch (err) {
      logger.warn('Redis unreachable, continuing without cache. Set REDIS_URL only when Redis is reachable.', {
        error: err instanceof Error ? err.message : String(err),
      });
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

