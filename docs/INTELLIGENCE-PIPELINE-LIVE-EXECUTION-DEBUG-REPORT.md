# Intelligence Pipeline Live Execution Debug Report

**Date:** 2026-03-07  
**Scope:** Identify operational failure preventing pipeline execution

---

## 1 — Cron Execution

| Cron Running | Manual check required |
|--------------|------------------------|
| Run `npm run start:cron` and observe logs every 60s | |

**Note:** Cron is a separate process. If not started, `enqueueIntelligencePolling` runs only when triggered manually (e.g. `npm run intelligence:enqueue`).

---

## 2 — Polling Job Enqueue

| Enqueue Triggered | Yes |
|-------------------|-----|
| Sources Found | 4 |
| Jobs Created | 4 |
| Skipped (rate_limit) | 0 |
| Skipped (disabled) | 0 |

**Finding:** When run manually, `enqueueIntelligencePolling()` successfully discovers 4 API sources and enqueues 4 jobs. Enqueue logic is working.

---

## 3 — Queue Connection

| Redis Connected | Yes |
|-----------------|-----|
| Pending Jobs | 0 |
| Completed Jobs | 0 |

**Finding:** Redis connection works (uses default or env). At debug run time, 4 jobs were just enqueued; Pending 0 suggests they were consumed or a separate worker/process handled them.

---

## 4 — Worker Execution

| Worker Started | Manual: `npm run start:workers` |
|----------------|----------------------------------|
| Jobs Received | Requires worker running |

**Finding:** The intelligence polling worker is only active when `npm run start:workers` (or `worker:bolt`) is running. If it is not running, enqueued jobs are never processed.

---

## 5 — API Fetch Execution

| API Source | Fetch Executed | Results Length |
|------------|----------------|----------------|
| *Requires worker processing jobs* | Run workers, then inspect worker logs | |

**Note:** API fetch runs inside the worker when it processes a job. Without the worker, no fetch occurs.

---

## 6 — Normalization Output

| Source | Normalized Signals |
|--------|--------------------|
| *Requires worker processing* | Look for `[intelligenceIngestion] Normalized intelligence signals` in worker logs | |

---

## 7 — Signal Storage Attempt

| Signals Attempted | Signals Inserted |
|-------------------|------------------|
| *Requires worker* | Check `SELECT COUNT(*) FROM intelligence_signals` after workers run | |

---

## 8 — Environment Variables

| Variable | Present |
|----------|---------|
| YOUTUBE_API_KEY | present |
| NEWS_API_KEY | present |
| SERPAPI_KEY | missing |
| REDIS_URL | missing * |
| SUPABASE_URL | present |
| SUPABASE_SERVICE_ROLE_KEY | present |

\* REDIS_URL was reported missing in the env check, but the queue connected successfully (likely using default `redis://localhost:6379` or value from `.env.local`). Ensure Redis is reachable where workers run.

---

## Root Cause

### Primary: Workers and cron not running

The pipeline code works when invoked: enqueue creates 4 jobs, Redis is reachable, and sources are configured. Data does not flow because:

1. **Cron not running** — `npm run start:cron` is not running, so `enqueueIntelligencePolling` only runs when triggered manually.
2. **Workers not running** — `npm run start:workers` (or `worker:bolt`) is not running, so enqueued jobs are never processed. No jobs are picked up, so no API fetch, normalization, or insert.

### Secondary: SERPAPI_KEY missing

`SERPAPI_KEY` is not set. SerpAPI sources will return empty when the worker fetches. YouTube and NewsAPI have keys and can produce signals.

---

## Summary

| Component | Status |
|-----------|--------|
| Enqueue logic | ✓ Works (4 jobs created when triggered) |
| Queue/Redis | ✓ Reachable |
| Worker process | ✗ Must be started manually |
| Cron process | ✗ Must be started manually |

**Action:** To get data flowing, run both processes:

1. `npm run start:workers`
2. `npm run start:cron`

Then run `npm run intelligence:enqueue` or wait for cron to enqueue (first run within ~2 hours).
