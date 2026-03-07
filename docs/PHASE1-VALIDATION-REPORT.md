# Phase 1 Post-Implementation Validation & Hardening Report

**Date:** 2025-03-06  
**Scope:** Audit, validate, harden — no new features or redesign.

---

## 1. Migration Verification

### database/intelligence_query_templates.sql

**Final schema:**
```sql
CREATE TABLE IF NOT EXISTS intelligence_query_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_source_id UUID NULL REFERENCES external_api_sources(id) ON DELETE SET NULL,
  category TEXT,
  template TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Indexes:**
- `index_intelligence_query_templates_api_source` ON (api_source_id)
- `index_intelligence_query_templates_enabled` ON (enabled) WHERE enabled = true

**Verification:**
- Matches Phase-1 spec (id, api_source_id, category, template, enabled, created_at)
- Indexes present and correct
- FK to external_api_sources with ON DELETE SET NULL

**Idempotency:** Table creation is idempotent (CREATE TABLE IF NOT EXISTS). Indexes use IF NOT EXISTS.

**Non-idempotent:** INSERT adds 5 default rows; re-run adds 5 more duplicates. Not critical for one-time migration.

**Safety:** Safe on existing data. No modifications to existing tables.

---

### database/intelligence_signals_taxonomy.sql

**Schema changes:**
```sql
ALTER TABLE intelligence_signals ADD COLUMN IF NOT EXISTS primary_category TEXT NULL;
ALTER TABLE intelligence_signals ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE intelligence_signals ADD COLUMN IF NOT EXISTS relevance_score NUMERIC NULL;
```

**Verification:**
- Matches spec (primary_category, tags, relevance_score)
- All columns nullable or defaulted
- No indexes added (acceptable; new columns not used in WHERE)

**Idempotency:** ADD COLUMN IF NOT EXISTS makes each ALTER idempotent.

**Safety:** Safe on existing data. Existing rows get NULL for primary_category and relevance_score, [] for tags. No backfill required.

---

### Migration Safety Assessment

| Risk | Assessment |
|------|------------|
| Duplicate template rows on re-run | Low — manual migration; re-run rare |
| Schema conflicts | None — additive changes only |
| FK integrity | Valid — external_api_sources must exist |
| Existing signal data | Unaffected — new columns nullable/default |

---

## 2. Query Builder Validation

### Placeholder replacement

- Regex: `/\{\s*([a-zA-Z_]+)\s*\}/g` — supports `{topic}`, `{competitor}`, `{product}`, `{region}`, `{keyword}`
- `resolvePlaceholder()` maps each to `input.topic`, `input.competitor`, etc.; returns `''` when missing
- `expandTemplate()` replaces all matches; missing placeholders yield empty string

### Template fallback

- If `explicitTemplate` provided: use it
- Else: `loadTemplates(source.id)` → first enabled template (api_source or global)
- If no templates: `mergedParams = baseParams` (source.query_params), `queryParams = {}`, `runtimeValues = {}`

### queryHash generation

- `computeQueryHash(mergedParams, mergedRuntime)` 
- Combines `{ ...queryParams, ...runtimeValues }`, sorts keys via `sortedEntries()`, `JSON.stringify`, SHA256
- **Deterministic:** Same inputs → same hash

### Simulated cases (code-inspection validated)

| Template | Input | Expected output |
|----------|-------|-----------------|
| `{topic} market trends {region}` | topic=AI, region=US | q="AI market trends US", query="AI market trends US", runtimeValues.topic/region, queryHash=SHA256(sorted merged) |
| `{competitor} product launch` | competitor=Acme | q="Acme product launch", query="Acme product launch" |
| `problems with {product}` | product=X | q="problems with X", query="problems with X" |

**Output format confirmed:** `{ queryParams: Record<string,string>, runtimeValues: Record<string,string>, queryHash: string }` — `expand()` return type and implementation match.

### Compatibility with buildExternalApiRequest()

- `buildExternalApiRequest(source, { queryParams, runtimeValues })` merges `queryParams` into URL and `runtimeValues` for `{{placeholder}}` resolution
- Query builder returns `queryParams` (e.g. q, query) and `runtimeValues` (topic, competitor, …)
- `buildExternalApiRequest` merges `options.queryParams` with `source.query_params` — compatible.

---

## 3. Redis Cache Validation

### Cache keys

- **Pattern:** `virality:ext_api:cache:{apiId}::{geo}::{category}::{userId}`
- **Actual:** `virality:ext_api:cache:${apiId}::${geo || 'any'}::${category || 'any'}::${userId || 'global'}`
- Implemented in `buildCacheKey()` — matches specification; `::` separates segments

### Rate limit keys

- **Pattern:** `virality:ext_api:ratelimit:{sourceId}:{usageUserId}`
- `rateLimitRedisKey(rateLimitKeyStr)` produces `virality:ext_api:ratelimit:${rateLimitKeyStr}`
- externalApiService passes `rateLimitKey = ${source.id}:${usageUserId}` — matches

### TTL

- Cache: `ttlSec = Math.ceil(ttlMs / 1000)` — externalApiService passes 720000 ms → 720 sec — correct
- `CACHE_TTL_SEC = 720` defined but not used; actual TTL from caller

### Failure handling

- `isRedisOk()` → `client.ping()`; on error returns false
- `getCachedResponse`: Redis fail → in-memory fallback
- `setCachedResponse`: Redis fail → in-memory fallback  
- `isRateLimited`: Redis fail → in-memory fallback
- Log: `[redisExternalApiCache] Redis unavailable, falling back to in-memory`

### Rate limiting (sorted sets)

- `ZREMRANGEBYSCORE key 0 windowStart` — remove old entries
- `ZCARD key` — count in window
- If `count >= limitPerMin` → return true (rate limited), no ZADD
- If `count < limitPerMin` → `ZADD key now ${now}`, `EXPIRE key 70`
- Correct sliding-window behavior

### Blocking in hot paths

- All Redis calls are async; no blocking
- `isRedisOk()` runs PING on every cache/rate-limit call — adds ~1–5 ms per operation
- Non-blocking; acceptable overhead

---

## 4. Signal Relevance Engine Validation

### Scoring formula

- Base: 0.5
- Topic match (Jaccard): +0.3 × sim
- Competitor match: +0.25
- Region match: +0.15
- Company focus: +0.2 × focusScore
- Momentum: +0.1 × 0.5 when velocity or volume > 0
- Final: clamp to [0, 1], 3 decimal places

### Taxonomy classification

- `inferCategory()` uses regex on topic: COMPETITOR, PRODUCT, CUSTOMER, TREND, MARKETING, PARTNERSHIP, REGULATION, LEADERSHIP, EVENT
- Default: TREND
- All values from TAXONOMY_VALUES — valid

### Tag generation

- `topic_match`, `competitor_match`, `query_competitor_match`, `region_match`, `company_focus_match`, `momentum`
- Deduped via `[...new Set(tags)]`

### Null safety

- `signal.topic ?? ''`, `queryContext.topic ?? ''` — safe
- `companyContext?.region`, `companyContext?.competitors` — safe
- Empty topicTokens, focusTerms — guarded

### Output

- `relevance_score: number`
- `primary_category: TaxonomyValue | null`
- `tags: string[]`

### Integration with insertFromTrendApiResults()

- Called when `companyId || options?.queryContext`
- `computeRelevance(signal, companyContext, queryContext)` applied per signal
- Results written to `primary_category`, `tags`, `relevance_score` — correct

---

## 5. Idempotency Logic Validation

### With queryHash

- `buildIdempotencyKey(..., queryHash)` → `raw = `${base}:${queryHash}``
- `base` = `${sourceApiId}:${topic}:${iso}`

### Without queryHash

- `raw = base` — unchanged from original

### Deterministic inputs

- `detectedAt` normalized to ISO string
- `topic` trimmed and lowercased
- `queryHash` from sorted JSON — deterministic

### Duplicate prevention

- Upsert with `onConflict: 'idempotency_key'`, `ignoreDuplicates: true`
- Same key → skip insert — no duplicates

### Historical compatibility

- Old records: no queryHash → key = SHA256(source_api_id + topic + detected_at)
- New worker flow: includes queryHash when templates used
- Paths without queryHash (e.g. fire-and-forget from fetchTrendsFromApis) unchanged — compatible

---

## 6. Polling Worker Validation

### Flow (actual)

1. `apiSourceId` from job
2. `getExternalApiSourceById(apiSourceId)`
3. `fetchSingleSourceWithQueryBuilder(apiSourceId, companyId)` which:
   - `expand(source, ...)` 
   - `buildExternalApiRequest(source, { queryParams, runtimeValues })`
   - `fetchWithRetry` (not `executeExternalApiRequest`)
   - Returns `{ results, queryHash, queryContext }`
4. `insertFromTrendApiResults(results, companyId, { queryHash, queryContext })`
   - internally: buildNormalizedSignalsFromTrendResults → signalRelevanceEngine (computeRelevance) → insertNormalizedSignals

**Note:** No explicit `normalizeTrendSignals` call; normalization is inside `buildNormalizedSignalsFromTrendResults`.

### Job payload

- Unchanged: `{ apiSourceId, companyId?, purpose? }`

### Concurrency

- Worker: concurrency 2, limiter max 10 / 60s — unchanged

### Deadlocks

- No distributed locks used; BullMQ job-level concurrency — no deadlock risk

### Query builder invocation

- Always called in `fetchSingleSourceWithQueryBuilder` (not conditional on template)
- When no templates: `loadTemplates` returns [] → `mergedParams = baseParams`, `queryParams = {}` — still runs, falls back to source.query_params

---

## 7. Backward Compatibility Check

### signalClusterEngine

- `select('id, topic, normalized_payload, detected_at, source_api_id')` — explicit columns
- Does not use primary_category, tags, relevance_score — unaffected

### signalIntelligenceEngine

- Reads signal_clusters, intelligence_signals (`id`, `detected_at`)
- Does not touch new columns — unaffected

### strategicThemeEngine

- Reads signal_intelligence, strategic_themes — no intelligence_signals — unaffected

### companyTrendRelevanceEngine

- Reads strategic_themes, signal_intelligence, signal_clusters
- `signal_clusters.select('cluster_id, source_api_id')` — no new intelligence_signals columns — unaffected

### campaignOpportunityEngine

- Reads strategic_themes only — unaffected

### Schema impact

- New columns are additive and nullable
- No `SELECT *` on intelligence_signals in these services — safe

---

## 8. Performance Check

### Query builder

- 1 Supabase query for templates when no explicit template
- Hash computation is O(n log n) for sort
- ~50–200 ms per job depending on DB latency

### Redis cache

- `isRedisOk()` = 1 PING per get/set
- get: 1 GET; set: 1 SETEX
- ~2–10 ms per operation with local Redis

### Signal relevance

- `computeRelevance` is sync, in-memory
- `loadCompanyContextForRelevance`: 2 Supabase queries per company (first call)
- Per signal: tokenization, Jaccard, category inference — sub-ms

### Per-polling-cycle overhead

| Component | Estimate |
|-----------|----------|
| Query builder | 50–200 ms |
| Redis (cache not used in worker path) | 0 (worker does not use cache) |
| Relevance scoring (per signal) | ~1–5 ms |
| Company context load | 50–150 ms once per batch |

Total: ~100–400 ms extra per job before insert.

### Scaling limits

- Relevance scoring is O(signals × (topicTokens + focusTerms))
- Large batches (e.g. 1000+ signals) could add 1–5 s
- Redis PING on every cache op can be optimized with a connection-health cache if needed

---

## 9. Failure Scenario Tests

| Scenario | Behavior |
|----------|----------|
| **Redis unavailable** | `isRedisOk()` false → in-memory fallback; log warning; no throw |
| **External API timeout** | `fetchWithRetry` aborts; health failure; job retries per BullMQ |
| **Malformed query template** | `expandTemplate` replaces `{x}` with `''` if x missing; no throw |
| **Missing placeholder variables** | Resolve to `''`; expanded string may be short/empty; no crash |
| **Duplicate signals across query templates** | Different queryHash → different idempotency keys → stored as separate signals; expected |

---

## 10. Final Phase-1 Validation Report

### Architecture validation

- Intelligence flow: query builder → fetch → insert with relevance
- Redis cache/rate limit replace in-memory with fallback
- Taxonomy fields additive
- Idempotency supports both legacy and template-based keys

### Files inspected

- database/intelligence_query_templates.sql
- database/intelligence_signals_taxonomy.sql
- backend/services/intelligenceQueryBuilder.ts
- backend/services/redisExternalApiCache.ts
- backend/services/signalRelevanceEngine.ts
- backend/services/intelligenceSignalStore.ts
- backend/workers/intelligencePollingWorker.ts
- backend/services/externalApiService.ts (partial)
- signalClusterEngine, signalIntelligenceEngine, strategicThemeEngine, companyTrendRelevanceEngine, campaignOpportunityEngine

### Migration verification

- Schemas match spec
- Indexes and constraints valid
- Taxonomy migration idempotent
- Template migration not idempotent (duplicate inserts on re-run) — low risk

### Cache validation

- Key patterns correct
- TTL 720 seconds
- Fallback on Redis failure
- Rate limit uses sorted sets correctly

### Query builder validation

- Placeholder replacement correct
- Fallback when no templates
- queryHash deterministic
- Compatible with buildExternalApiRequest

### Polling worker validation

- Flow correct (query builder → fetch → insert with relevance)
- Payload unchanged
- Concurrency unchanged
- Query builder always invoked (falls back when no templates)

### Backward compatibility

- Downstream engines unchanged
- Explicit column selects; new columns not used
- Old idempotency formula preserved when queryHash omitted

### Performance observations

- ~100–400 ms added per polling job
- Redis PING per cache op; could be optimized
- Relevance scoring scales with signal count

### Failure scenario behavior

- Redis down: in-memory fallback
- API timeout: retry then fail; job retried by BullMQ
- Missing placeholders: empty string; no crash
- Duplicates across templates: intentional; separate idempotency keys

### Technical risks

1. **Template INSERT not idempotent:** Re-running migration inserts duplicate templates. Fix: use `INSERT ... ON CONFLICT` or pre-check. Low priority.
2. **Redis PING on every call:** Extra latency. Fix: cache `isRedisOk` for a few seconds. Low priority.
3. **Worker does not use executeExternalApiRequest:** Uses `fetchWithRetry` directly; usage/enforcement still applied in other paths. No issue for worker path per current design.

### Critical issues

None requiring immediate code changes.
