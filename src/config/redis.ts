import Redis from "ioredis";
import logger from "./logger";

let client: InstanceType<typeof Redis> | null = null;
let isReady = false;

const CONNECT_TIMEOUT_MS = 10000;
const HALF_OPEN_AFTER_MS = 30000;

type RedisCircuitState = "closed" | "open" | "half_open";

let circuitState: RedisCircuitState = "open";
let failureCount = 0;
let openedAt = Date.now();

function openCircuit(reason: string): void {
  isReady = false;
  circuitState = "open";
  openedAt = Date.now();
  failureCount += 1;
  logger.warn("Redis circuit opened", {
    reason,
    failureCount,
  });
}

function closeCircuit(): void {
  isReady = true;
  circuitState = "closed";
  failureCount = 0;
  openedAt = 0;
}

function getCircuitState(): RedisCircuitState {
  if (
    circuitState === "open" &&
    openedAt > 0 &&
    Date.now() - openedAt >= HALF_OPEN_AFTER_MS
  ) {
    return "half_open";
  }

  return circuitState;
}

export const initRedis = async (): Promise<void> => {
  if (client) {
    return;
  }

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    openCircuit("REDIS_URL is not configured");
    return;
  }

  logger.info(`Connecting to Redis: ${redisUrl}`);

  client = new Redis(redisUrl, {
    connectTimeout: CONNECT_TIMEOUT_MS,

    lazyConnect: false,

    enableOfflineQueue: false,

    maxRetriesPerRequest: 1,

    retryStrategy(times: number) {
      const delay = Math.min(times * 1000, 5000);

      logger.warn(
        `Redis reconnect attempt ${times}. Retrying in ${delay}ms...`
      );

      return delay;
    },
  });

  client.on("connect", () => {
    circuitState = "half_open";
    logger.info("Redis TCP connection established");
  });

  client.on("ready", () => {
    closeCircuit();
    logger.info("✅ Redis connected");
  });

  client.on("close", () => {
    openCircuit("connection closed");
  });

  client.on("reconnecting", () => {
    circuitState = "half_open";
    isReady = false;
    logger.info("Redis reconnecting...");
  });

  client.on("end", () => {
    openCircuit("connection ended");
  });

  client.on("error", (err: Error) => {
    openCircuit(err.message);
    logger.error(`Redis error: ${err.message}`);
  });

  // Wait briefly for initial readiness, but never fail service startup.
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    openCircuit(message);
    logger.warn("Redis unavailable; continuing without Redis cache/location persistence", {
      error: message,
    });
  }
};

export const getRedisClient = (): InstanceType<typeof Redis> | null => {
  if (!client || !isReady || getCircuitState() !== "closed") {
    return null;
  }

  return client;
};

export const isRedisReady = (): boolean => {
  return isReady && getCircuitState() === "closed";
};

export const getRedisCircuitState = (): {
  state: RedisCircuitState;
  isReady: boolean;
  failureCount: number;
  openedAt: number;
} => ({
  state: getCircuitState(),
  isReady,
  failureCount,
  openedAt,
});

export const closeRedis = async (): Promise<void> => {
  if (!client) return;

  try {
    if (isReady && getCircuitState() === "closed") {
      await client.quit();
    } else {
      client.disconnect();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Redis close skipped after unavailable connection", {
      error: message,
    });
    client.disconnect();
  }

  client = null;
  isReady = false;
  circuitState = "open";
  openedAt = Date.now();

  logger.info("Redis connection closed");
};

export const disconnectRedis = closeRedis;

export const REDIS_TTLS = {
  TASK_LIST_SECONDS: 60,
  TASK_DETAIL_SECONDS: 120,
  PARTNER_LOCATION_SECONDS: 600,
};
