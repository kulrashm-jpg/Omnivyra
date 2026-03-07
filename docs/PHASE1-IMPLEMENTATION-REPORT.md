# Phase 1 Implementation Report — Global Intelligence Layer

**Date:** 2025-03-06  
**Status:** Complete

---

## 1. System Architecture After Phase 1

### Full Intelligence Ingestion Flow

```
External API Source (external_api_sources)
  ↓
[Intelligence Polling Worker]
  ↓
getExternalApiSourceById(apiSourceId)
  ↓
intelligenceQueryBuilder.expand(source, companyId)
  → Produces: queryParams, runtimeValues, queryHash
  ↓
buildExternalApiRequest(source, { queryParams, runtimeValues })
  ↓
fetchWithRetry / executeExternalApiRequest
  ↓
Parse payload (payload.items)
  ↓
insertFromTrendApiResults(results, companyId, { queryHash, queryContext })
  ↓
buildNormalizedSignalsFromTrendResults → NormalizedSignalInput[]
  ↓
[Signal Relevance Engine] — computeRelevance(signal, companyContext, queryContext)
  → relevance_score, primary_category, tags
  ↓
insertNormalizedSignals(signals, { queryHash })
  → Idempotency: SHA256(source_api_id + topic + detected_at [+ queryHash])
  ↓
intelligence_signals (+ primary_category, tags, relevance_score)
  ↓
[Existing pipeline — unchanged]
signalClusterEngine → signal_clusters
signalIntelligenceEngine → signal_intelligence
strategicThemeEngine → strategic_themes
campaignOpportunityEngine → campaign_opportunities
```

### Alternative Paths (unchanged)

- **fetchTrendsFromApis / fetchExternalTrends:** Use Redis cache, async get/set, rate limit from Redis
- **insertFromTrendApiResults** (from fetchTrendsFromApis fire-and-forget): No queryHash/queryContext; backward compatible

---

## 2. Files Created

| File | Purpose |
|------|---------|
| `backend/services/intelligenceQueryBuilder.ts` | Expand query templates, produce queryParams, runtimeValues, queryHash |
| `backend/services/redisExternalApiCache.ts` | Redis cache + rate limiting; fallback to in-memory |
| `backend/services/signalRelevanceEngine.ts` | Compute relevance_score, primary_category, tags |
| `database/intelligence_query_templates.sql` | Migration: intelligence_query_templates table + default templates |
| `database/intelligence_signals_taxonomy.sql` | Migration: primary_category, tags, relevance_score on intelligence_signals |
| `docs/PHASE1-IMPLEMENTATION-REPORT.md` | This report |

---

## 3. Files Modified

| File | Purpose |
|------|---------|
| `backend/services/externalApiService.ts` | Import from redisExternalApiCache; async cache/rate limit; `fetchSingleSourceWithQueryBuilder`; `resetExternalApiRuntime` async |
| `backend/services/intelligenceSignalStore.ts` | `buildIdempotencyKey` with optional queryHash; NormalizedSignalInput taxonomy fields; `insertFromTrendApiResults` relevance scoring + queryHash/queryContext |
| `backend/workers/intelligencePollingWorker.ts` | Use `fetchSingleSourceWithQueryBuilder`; pass queryHash, queryContext to `insertFromTrendApiResults` |
| `backend/tests/integration/external_api_health.test.ts` | Import from redisExternalApiCache; await `resetExternalApiRuntime` |
| `backend/tests/integration/external_api_alignment.test.ts` | Import from redisExternalApiCache; use `buildCacheKey` for test cache setup |
| `pages/api/external-apis/[id]/test.ts` | Import from redisExternalApiCache; await getCachedResponse, setCachedResponse |
| `pages/api/external-apis/test.ts` | Import from redisExternalApiCache |

---

## 4. Database Migrations

### New Table: intelligence_query_templates

```sql
CREATE TABLE intelligence_query_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_source_id UUID NULL REFERENCES external_api_sources(id) ON DELETE SET NULL,
  category TEXT,
  template TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Indexes: `(api_source_id)`, `(enabled) WHERE enabled = true`

Default templates inserted: `{topic} market trends {region}`, `{competitor} product launch`, `problems with {product}`, `{topic} marketing strategy`, `{topic} customer complaints`

### Schema Changes: intelligence_signals

```sql
ALTER TABLE intelligence_signals ADD COLUMN primary_category TEXT NULL;
ALTER TABLE intelligence_signals ADD COLUMN tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE intelligence_signals ADD COLUMN relevance_score NUMERIC NULL;
```

---

## 5. Redis Cache Architecture

### Cache Keys

- **Pattern:** `virality:ext_api:cache:{apiId}::{geo}::{category}::{userId}`
- **TTL:** 720 seconds (12 minutes)
- **Storage:** Redis SETEX with JSON-serialized payload; fallback to in-memory Map when Redis unavailable

### Rate Limiting Keys

- **Pattern:** `virality:ext_api:ratelimit:{sourceId}:{usageUserId}`
- **Mechanism:** Redis sorted set (ZADD timestamp as score/member, ZREMRANGEBYSCORE for window, ZCARD for count)
- **Window:** 60 seconds
- **Fallback:** In-memory Map of timestamps when Redis unavailable

### Distributed Lock Keys (defined, not yet used)

- **Pattern:** `virality:ext_api:lock:poll:{apiSourceId}:{companyId|null}`
- **Use:** Optional per-source lock for polling; BullMQ job concurrency currently sufficient

---

## 6. Polling Worker Changes

- **Before:** `fetchSingleSourceForIntelligencePolling` → `insertFromTrendApiResults`
- **After:** `fetchSingleSourceWithQueryBuilder` → `insertFromTrendApiResults` with `queryHash`, `queryContext`

Query builder runs inside `fetchSingleSourceWithQueryBuilder`:
1. Load source
2. Load company profile (topic, competitor, region, etc.)
3. Call `intelligenceQueryBuilder.expand(source, companyId, ...)`
4. Build request with expanded queryParams and runtimeValues
5. Fetch
6. Return results + queryHash + queryContext

Job payload unchanged: `{ apiSourceId, companyId?, purpose? }`

---

## 7. Signal Schema Updates

### Taxonomy Fields

| Field | Type | Purpose |
|-------|------|---------|
| `primary_category` | TEXT NULL | One of TREND, COMPETITOR, PRODUCT, CUSTOMER, MARKETING, PARTNERSHIP, LEADERSHIP, REGULATION, EVENT |
| `tags` | JSONB DEFAULT '[]' | Match tags: topic_match, competitor_match, region_match, company_focus_match, momentum |
| `relevance_score` | NUMERIC NULL | 0–1 score from signalRelevanceEngine |

### Idempotency Update

- **Without queryHash:** `SHA256(source_api_id + topic + detected_at)` — backward compatible
- **With queryHash:** `SHA256(source_api_id + topic + detected_at + queryHash)` — used when query builder expansion is applied

---

## 8. Backward Compatibility Verification

| Area | Status |
|------|--------|
| `fetchTrendsFromApis` | Unchanged signature; cache and rate limit now async/Redis |
| `fetchExternalTrends` | Unchanged signature |
| `fetchSingleSourceForIntelligencePolling` | Unchanged; still available for non-worker callers |
| `signalClusterEngine` | Not modified; selects same columns |
| `signalIntelligenceEngine` | Not modified |
| `strategicThemeEngine` | Not modified |
| `companyTrendRelevanceEngine` | Not modified |
| `campaignOpportunityEngine` | Not modified |
| `insertFromTrendApiResults` (no options) | Backward compatible; no relevance when queryContext omitted |
| Existing signals | No backfill; primary_category, tags, relevance_score remain NULL |

---

## 9. Dependency Safety Check

| Service | Impact |
|---------|--------|
| externalApiService | Cache/rate limit now async; all callers (fetchTrendsFromApis, fetchExternalTrends) updated to await |
| intelligenceSignalStore | New optional params; existing callers without options unchanged |
| intelligencePollingWorker | Now uses query builder path; payload unchanged |
| external_api_health.test | Updated for redisExternalApiCache and async reset |
| external_api_alignment.test | Updated for redisExternalApiCache and buildCacheKey |
| pages/api/external-apis/*/test | Updated for redis cache and async get/set |

---

## 10. Technical Risks

1. **Redis availability:** Fallback to in-memory when Redis is down; multi-instance rate limit/cache will not be shared until Redis is available.

2. **intelligence_query_templates table:** Migration must be run before worker uses query builder; if table missing, `loadTemplates` returns `[]` and expand falls back to source.query_params.

3. **resetExternalApiRuntime:** Now async; callers (e.g. tests) must `await`. One test updated; other usages should be checked.

4. **externalApiCacheService:** Still present but no longer used by externalApiService; remaining imports (if any) should be migrated to redisExternalApiCache.
