# Scaling: Add Infrastructure, Not Architecture Changes

**Principle:** When the number of users grows, we scale by **increasing infrastructure** (more instances, bigger DB, more queue workers). We do **not** need to change the application architecture to support growth.

---

## Why This Works Today

| Aspect | Current design | Scales by |
|--------|----------------|-----------|
| **API (Next.js)** | Stateless handlers; no in-process session store | Add more app instances (horizontal scaling) |
| **Auth** | JWT/cookies + Supabase; user/role from DB per request | Same app; DB handles concurrency |
| **Data** | Supabase (Postgres); all persistence in DB | DB connection pool, read replicas, plan size |
| **Background work** | BullMQ + Redis (queues) | Add more queue workers / Redis capacity |
| **Heavy work (e.g. AI plan)** | Per-request; no shared in-memory state | More app instances spread load |

So: more users → more traffic → add more Next.js instances and/or more queue workers and/or tune DB. No need to redesign the app.

---

## What to Avoid (Keep Architecture Scale-Ready)

- **No sticky sessions** — Do not rely on the same server instance for a given user. Auth and state come from DB/cookies, not in-process memory.
- **No single-instance assumptions** — Do not assume one process (e.g. “only one writer” or “in-memory global state that must be shared”). Multiple instances must be safe.
- **No local-only state for correctness** — Any state that must be consistent across requests (e.g. “has this user already been rate-limited?”) should eventually use a shared store (e.g. Redis) if you need global limits. Today’s in-memory rate/cache maps are **per-instance** and are fine for “soft” limits and local cache.

---

## Per-Instance In-Memory State (Known)

These use module-level `Map`s and are **per Node process**. When you run more than one instance:

- Each instance has its own rate-limit buckets, cache, and health stats.
- Effect: rate limits and caches are not shared across instances (so limits are a bit “softer” and cache hit rate per instance may be lower). **No correctness break**; the app stays safe with multiple instances.
- If you later need **global** rate limiting or **shared** cache, add Redis (or similar) as infrastructure and move those concerns there—still an infra change, not an app rewrite.

| Location | Purpose |
|----------|---------|
| `GovernanceRateLimiter` | Per-company projection update throttle (in-memory) |
| `externalApiService` | Rate limit state (in-memory) |
| `externalApiCacheService` | Response cache (in-memory) |
| `omnivyraHealthService` / `externalApiHealthService` | Health/feedback state (in-memory) |

---

## Scaling Levers (Infrastructure, Not Code)

1. **More Next.js instances** — Run more copies of the app behind a load balancer. No code change; handlers are stateless.
2. **Database** — Tune Supabase/Postgres (connections, pool size, read replicas) as traffic grows.
3. **Queue workers** — Run more BullMQ workers (or more replicas of worker processes) for background jobs.
4. **Redis** — Already used for queues; can add Redis for shared cache or distributed rate limiting if you need global limits or higher cache hit rate.
5. **LLM / external APIs** — Throttling and timeouts are in code; capacity is increased by adding instances and/or upgrading provider plans.

---

## Summary

- **Tomorrow:** More users → add more app instances, more workers, and/or bigger DB/Redis. No need to change the architecture.
- **Keep:** Stateless APIs, DB-backed auth and data, no reliance on single-instance or sticky sessions.
- **Optional later:** Move in-memory rate limits or caches to Redis if you need global behavior; that’s an infrastructure addition, not an architectural rewrite.
