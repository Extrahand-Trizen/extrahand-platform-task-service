import Redis from "ioredis";
import logger from "./logger";

type RedisClient = InstanceType<typeof Redis>;

let client: RedisClient | null = null;
let isReady = false;

const CONNECT_TIMEOUT_MS = 10000;

export const REDIS_TTLS = {
  TASK_LIST_SECONDS: 20,
  TASK_DETAIL_SECONDS: 60,
};

export const initRedis = async (): Promise<void> => {
  if (client) {
    return;
  }

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    logger.warn("REDIS_URL is not configured");
    return;
  }

  logger.info(`Connecting to Redis: ${redisUrl}`);

  client = new Redis(redisUrl, {
    connectTimeout: CONNECT_TIMEOUT_MS,

    lazyConnect: false,

    enableOfflineQueue: true,

    maxRetriesPerRequest: null,

    retryStrategy(times: number) {
      const delay = Math.min(times * 1000, 5000);

      logger.warn(
        `Redis reconnect attempt ${times}. Retrying in ${delay}ms...`
      );

      return delay;
    },
  });

  client.on("connect", () => {
    logger.info("Redis TCP connection established");
  });

  client.on("ready", () => {
    isReady = true;
    logger.info("✅ Redis connected");
  });

  client.on("close", () => {
    isReady = false;
    logger.warn("Redis connection closed");
  });

  client.on("reconnecting", () => {
    isReady = false;
    logger.info("Redis reconnecting...");
  });

  client.on("end", () => {
    isReady = false;
    logger.warn("Redis connection ended");
  });

  client.on("error", (err: Error) => {
    logger.error(`Redis error: ${err.message}`);
  });

  // Wait until Redis is actually ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Redis connection timeout"));
    }, CONNECT_TIMEOUT_MS);

    client!.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });

    client!.once("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Verify connection
  const pong = await client.ping();

  logger.info(`Redis Ping: ${pong}`);
};

export const getRedisClient = (): RedisClient | null => {
  if (!client || !isReady) {
    return null;
  }

  return client;
};

export const isRedisReady = (): boolean => {
  return isReady;
};

export const closeRedis = async (): Promise<void> => {
  if (!client) return;

  await client.quit();

  client = null;
  isReady = false;

  logger.info("Redis connection closed");
};

export const disconnectRedis = closeRedis;