# Intelligence Pipeline Root Cause Audit Report

**Date:** 2026-03-07  
**Scope:** Why no signals are ingested (Phase 5 post-activation)

---

## 1 — Job Enqueue Status

| Query | Result Count |
|-------|--------------|
| `company_api_configs WHERE enabled = true` | Returns rows (Drishiq linked to 4 sources per verification) |
| `external_api_sources WHERE is_active = true` | Returns 4 sources (YouTube Trends, YouTube Shorts, SerpAPI, NewsAPI) |

**Job creation logic:** `enqueueIntelligencePolling()` in `backend/scheduler/schedulerService.ts` (lines 203–301).

- Queries `company_api_configs` (enabled=true) → gets enabled source IDs
- Queries `external_api_sources` (is_active, in enabled IDs)
- Checks `external_api_health` (reliability ≥ 0.1; defaults to 1 if no row)
- Checks `external_api_usage` (rate limit; defaults to 0 if no row)
- Calls `addIntelligencePollingJob({ apiSourceId, companyId: null, purpose })` per source

| Jobs Created | Queue |
|--------------|-------|
| *Depends on cron running* | intelligence-polling |

**Failure point 1:** If cron (`npm run start:cron`) is not running, no jobs are enqueued.

---

## 2 — Worker Execution

| Worker | Queue | Job Handler | Jobs Processed |
|--------|-------|-------------|-----------------|
| `getIntelligencePollingWorker()` | intelligence-polling | `processIntelligencePollingJob` → `ingestSignals()` | 0 (per verification) |

**Worker:** `backend/workers/intelligencePollingWorker.ts`  
Worker subscribes to `intelligence-polling` and processes jobs with `{ apiSourceId, companyId?, purpose }`.

**Failure point 2:** If workers (`npm run start:workers`) are not running, enqueued jobs are never processed.

---

## 3 — External API Fetch

| Source | Fetch Attempted | Items Returned |
|--------|-----------------|----------------|
| YouTube Trends | ✓ (when job runs) | Raw `{ items: [...] }` — items have `snippet.title`, not `topic`/`title` |
| YouTube Shorts | ✓ | Same format |
| NewsAPI Everything | ✓ | Raw `{ articles: [...] }` — no `items` |
| SerpAPI Google Trends | ✓ | Raw `{ trend_results }` or `{ related_queries }` — no `items` |

**Fetch path:** `fetchSingleSourceWithQueryBuilder()` in `backend/services/externalApiService.ts` (lines 2132–2245).

**Failure points:**
- **3a. Missing API keys** — `buildExternalApiRequest` checks `api_key_env_name`. If `YOUTUBE_API_KEY`, `NEWS_API_KEY`, or `SERPAPI_KEY` is unset, returns `{ results: [] }` (lines 2158–2170).
- **3b. HTTP errors** — Non-2xx responses return `{ results: [] }` (lines 2186–2197).

---

## 4 — Signal Parsing

**Parser:** `buildNormalizedSignalsFromTrendResults()` in `backend/services/intelligenceSignalStore.ts` (lines 211–247).

**Expected payload shape:**
```javascript
payload.items = [ { topic?: string } | { title?: string }, ... ]
```

**Actual API responses:**

| API | Response shape | Parser result |
|-----|----------------|---------------|
| YouTube | `{ items: [ { snippet: { title }, ... } ] }` | `item.title` undefined → topic = '' → **skipped** |
| NewsAPI | `{ articles: [...] }` | `payload.items` undefined → **0 items** |
| SerpAPI | `{ trend_results }` or `{ related_queries }` | `payload.items` undefined → **0 items** |

**Code:**
```javascript
const items = Array.isArray(payload?.items) ? payload.items : [];
for (const item of items) {
  const topic = item?.topic ?? item?.title ?? '';
  if (!topic || typeof topic !== 'string') continue;  // skips YouTube (title in snippet)
  ...
}
```

| Parsed Items | Inserted Signals |
|--------------|------------------|
| 0 | 0 |

**Failure point 4:** `buildNormalizedSignalsFromTrendResults` assumes `payload.items` with `item.topic` or `item.title`. No configured API returns this format. `trendNormalizationService` understands each API but is **not** used in this path.

---

## 5 — Database Insert

| Table | Rows Inserted |
|-------|----------------|
| intelligence_signals | 0 |

**Insert path:** `insertFromTrendApiResults` → `buildNormalizedSignalsFromTrendResults` → `insertNormalizedSignals`.

When `signals.length === 0`, the function returns early (line 278) and no inserts occur.

---

## 6 — Distribution Trigger

| Signals Passed | Executed |
|----------------|----------|
| 0 | No (never reached) |

`distributeSignalsToCompanies(insertedIds)` is only called when `storeResult.inserted > 0` (lines 73–96 in `intelligenceIngestionModule.ts`). With 0 signals inserted, distribution is never invoked.

---

## 7 — Errors Detected

| Location | Behavior |
|----------|----------|
| `fetchSingleSourceWithQueryBuilder` | Returns `{ results: [] }` on missing env, HTTP error, or exception. No throw. |
| `ingestSignals` | Returns `{ signals_inserted: 0 }` when `results.length === 0` (line 61–63). No throw. |
| `buildNormalizedSignalsFromTrendResults` | Returns `[]` when payload shape does not match. No error or log. |
| `intelligenceIngestionModule` | If `storeResult.inserted === 0`, returns without error. |
| Worker | On completion with 0 signals, logs `signals_inserted: 0`; does not propagate as failure. |

**Suppressed conditions:**
- Missing API keys → `results: []` (not thrown)
- API parse mismatch → 0 signals (no logging)
- Empty `payload.items` → 0 signals (silent)

---

## 8 — Environment Variables

| Variable | Required For | Value |
|----------|--------------|-------|
| YOUTUBE_API_KEY | YouTube Trends, YouTube Shorts | *Check .env.local* |
| NEWS_API_KEY | NewsAPI Everything | *Check .env.local* |
| SERPAPI_KEY | SerpAPI Google Trends | *Check .env.local* |
| REDIS_URL | Queue + workers | *Check .env.local* |
| SUPABASE_* | DB access | *Check .env.local* |

If any required key is missing, `buildExternalApiRequest` adds it to `missingEnv` and the fetch returns `{ results: [] }` without attempting the request.

---

## 9 — Root Cause

### Primary: Payload format mismatch

`buildNormalizedSignalsFromTrendResults` expects:

- `payload.items` as an array
- each item with `topic` or `title` at top level

Configured APIs return different shapes:

- **NewsAPI:** `{ articles: [...] }` — no `items`
- **SerpAPI:** `{ trend_results }` or `{ related_queries }` — no `items`
- **YouTube:** `{ items: [...] }` but with `snippet.title`, not `item.title` — all items skipped

`trendNormalizationService` supports these APIs (`normalizeNewsApiTrends`, `normalizeSerpApiTrends`, `normalizeYouTubeTrends`) but is not used in the intelligence ingestion path. The pipeline passes raw API responses directly to `buildNormalizedSignalsFromTrendResults`, which only handles `payload.items` with top-level `topic`/`title`.

### Secondary: Operational assumptions

- **Cron not running** → no jobs enqueued
- **Workers not running** → jobs not processed
- **Missing API keys** → fetch never attempted, `results: []` returned

---

## Summary

| Stage | Status | Failure Point |
|-------|--------|---------------|
| Job enqueue | ○ | Cron may not be running |
| Worker processing | ○ | Workers may not be running |
| API fetch | ○/✓ | May fail on missing env; HTTP can fail |
| Payload parsing | ✗ | **Primary:** Format mismatch — parser expects `payload.items` with `topic`/`title`; APIs use different shapes |
| DB insert | ○ | No parsed signals to insert |
| Distribution | ○ | Never reached |

**Root cause:** The intelligence pipeline hands raw API responses to `buildNormalizedSignalsFromTrendResults`, which assumes `payload.items` and top-level `topic`/`title`. Current APIs (NewsAPI, SerpAPI, YouTube) do not conform to that structure, so no signals are parsed or stored. `trendNormalizationService` already normalizes these APIs correctly but is not invoked in this flow.
