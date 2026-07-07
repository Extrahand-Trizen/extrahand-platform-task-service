# Task list caching strategy (Redis)

Redis is used only as an **optimization** for the public task list. The app never depends on Redis; if Redis is missing or fails, all requests fall back to MongoDB.

---

## What we cache

- **Endpoint:** `GET /api/v1/tasks` (task list only).
- **Not cached:** single task, my-tasks, nearby, applications, or any write path.

---

## Cacheable request shape

We only use Redis when the request matches this high-traffic “discover” shape:

| Criterion | Allowed |
|-----------|--------|
| `status` | `open` only |
| `page` | 1, 2, or 3 |
| `limit` | 20 |
| `sortBy` | absent or `recent` (default) |
| `category`, `city`, `minBudget`, `maxBudget` | not set |
| `search`, `suburb`, `remotely` | not set |
| `excludeRequesterId`, `assigneeId`, `posterUid` | not set |

Any other combination bypasses cache and hits MongoDB only.

---

## Cache key and TTL

- **Key format:** `tasks:list:open:p{page}:20` (e.g. `tasks:list:open:p1:20`, `p2`, `p3`).
- **TTL:** 30 seconds. No explicit invalidation; staleness is bounded by TTL.

---

## Read-through behavior

1. If the query is **not** cacheable → go to MongoDB only; return result (no Redis).
2. If cacheable:
   - Try **GET** from Redis.
   - **Cache hit:** return parsed response; no MongoDB.
   - **Cache miss or any Redis error/timeout:** run MongoDB query, return result; then **best-effort** SET in Redis with TTL (errors on SET are ignored).
3. All Redis calls are in try/catch. On any Redis failure we use MongoDB only and still return a correct response.

---

## Failure safety

- **Redis optional:** If `REDIS_URL` is unset or Redis is down, every request uses MongoDB. No 5xx from “cache required”.
- **Startup:** Redis connection is best-effort (e.g. connect in background or on first use). App does not block or fail startup if Redis is unavailable.
- **Shutdown:** Redis client is closed during graceful shutdown.

---

## Summary

| Item | Choice |
|------|--------|
| **What** | Task list for discover only (cacheable shape above) |
| **Key** | `tasks:list:open:p{page}:20` (page 1–3) |
| **TTL** | 30 seconds |
| **Invalidation** | None (TTL only) |
| **On Redis failure** | Fall back to MongoDB; cache is optimization only |
