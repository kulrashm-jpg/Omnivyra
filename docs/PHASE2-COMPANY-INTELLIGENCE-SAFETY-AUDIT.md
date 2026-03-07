# Phase 2 — Company Intelligence Safety Hardening Audit

**Date:** 2025-03-06  
**Scope:** Verify system safety under scale. No feature additions.

---

## 1. Company Signal Duplication Check

### Unique Constraint

**Schema** (`database/company_intelligence_signals.sql` line 16):
```sql
UNIQUE (company_id, signal_id)
```
**Confirmed:** The table enforces a unique constraint on `(company_id, signal_id)`.

### Insert Behavior

**Code** (`backend/services/companyIntelligenceStore.ts` lines 34–40):
```typescript
const { data, error } = await supabase
  .from('company_intelligence_signals')
  .upsert(rows, {
    onConflict: 'company_id,signal_id',
    ignoreDuplicates: true,
  })
  .select('id');
```

Supabase `upsert` with `onConflict: 'company_id,signal_id'` and `ignoreDuplicates: true` maps to:
```sql
INSERT ... ON CONFLICT (company_id, signal_id) DO NOTHING
```

**Confirmed:** Duplicate `(company_id, signal_id)` pairs are skipped; no overwrites.

---

## 2. Worker Amplification Risk

### Code Path That Prevents Reprocessing

**File:** `backend/workers/intelligencePollingWorker.ts`

**Flow:**
1. **Line 97–102:** `insertFromTrendApiResults()` inserts global signals. Returns `storeResult` with `{ inserted, skipped, results }`.
2. **Line 104:** `if (storeResult.inserted > 0)` — company logic runs only when global signals were inserted.
3. **Lines 115–117:**
   ```typescript
   const insertedIds = storeResult.results
     .filter((r) => r.inserted && r.id)
     .map((r) => r.id);
   ```
   Only rows where `r.inserted === true` and `r.id` is non-empty are used.
4. **Line 118:** `if (insertedIds.length > 0)` — guard before calling the company processor.
5. **Line 120:** `processInsertedSignalsForCompany(companyId, insertedIds)` is called only with newly inserted signal IDs.

**Confirmation:**
- Existing global signals (skipped duplicates) have `r.inserted === false` and `r.id === ''`.
- `insertedIds` includes only IDs of rows actually inserted.
- `processInsertedSignalsForCompany()` is not called when `storeResult.inserted === 0` or when all results are duplicates.

**Status:** Worker does not reprocess existing global signals; only newly inserted ones are processed.

---

## 3. Company Context Query Efficiency

### companyIntelligenceEngine.ts

`loadCompanyContextForIntelligence()` performs two Supabase calls:
1. `companies` (id, industry)
2. `company_profiles` (profile fields)

It is invoked by `processInsertedSignalsForCompany()`.

### companyIntelligenceStore.ts

**Code** (`processInsertedSignalsForCompany` lines 52–81):
```typescript
export async function processInsertedSignalsForCompany(
  companyId: string,
  insertedSignalIds: string[]
): Promise<{ inserted: number; skipped: number }> {
  // ...
  const signals = await fetchSignalsByIds(insertedSignalIds);  // 1 batch query
  const context = await loadCompanyContextForIntelligence(companyId);  // 1 call per batch
  const globalInputs = signals.map(...);
  const companySignals = transformToCompanySignals(globalInputs, companyId, context);  // reuses context
  // ...
}
```

`loadCompanyContextForIntelligence(companyId)` is called once per batch, and `transformToCompanySignals()` iterates over all signals using that single context.

**Confirmed:** Company context is loaded once per batch, not per signal.

---

## 4. Aggregator Query Efficiency

### Query

**Code** (`backend/services/companyIntelligenceAggregator.ts` lines 65–71):
```typescript
const { data, error } = await supabase
  .from('company_intelligence_signals')
  .select(...)
  .eq('company_id', companyId)
  .gte('created_at', sinceStr);
```

Equivalent SQL:
```sql
SELECT ... FROM company_intelligence_signals
WHERE company_id = $1 AND created_at >= $2
```

### Indexes

| Index | Columns |
|-------|---------|
| `index_company_intelligence_signals_company` | `(company_id)` |
| `index_company_intelligence_signals_company_created` | `(company_id, created_at DESC)` |
| `index_company_intelligence_signals_company_relevance` | `(company_id, relevance_score DESC NULLS LAST)` |

### Expected Query Plan

- `company_id = $1 AND created_at >= $2` matches `index_company_intelligence_signals_company_created`.
- Index scan on `(company_id, created_at DESC)` for the given `company_id` and `created_at >= sinceStr`.

The `(company_id, relevance_score)` index supports ordering by relevance, not time. The time-window query uses the `(company_id, created_at)` index correctly.

**Confirmed:** Query uses indexed columns `(company_id, created_at)`.

---

## 5. Cache Stampede Protection

### Current Behavior

**File:** `backend/services/companyIntelligenceCache.ts`

Flow:
1. `getCachedInsights(companyId)` / `getCachedClusters(companyId)` call `client.get(key)`.
2. On miss, the caller (`companyIntelligenceService`) runs `aggregateCompanyIntelligence()` and then `setCachedInsights()` / `setCachedClusters()`.

There is no lock or single-flight logic: multiple concurrent misses for the same key will each trigger aggregation and set.

### Recommendation

Add SETNX-style locking with a short lock TTL:

1. On cache miss, attempt `SET lock_key NX EX 10` (e.g. `virality:company:lock:{companyId}`).
2. If lock acquired: compute aggregation, write to cache, delete lock.
3. If lock not acquired: short sleep (e.g. 50–100 ms), retry `GET` cache, then either return cached value or recompute if still miss.
4. Lock TTL (e.g. 10 s) avoids stuck locks if the process crashes.

---

## 6. Redis Connection Usage

### Findings

**redisExternalApiCache.ts** (lines 32–64):
- Own module-level `let redisClient: IORedis | null = null`.
- Uses `new IORedis(url, ...)` when initializing.

**companyIntelligenceCache.ts** (lines 14–40):
- Own module-level `let redisClient: IORedis | null = null`.
- Uses `new IORedis(url, ...)` when initializing.

Each module keeps its own singleton within its scope. Across the codebase, that results in two separate IORedis connections.

### Recommendation

Introduce a shared Redis client (e.g. `backend/db/redisClient.ts` or `backend/queue/redis.ts`) and inject it into both caches. That will:
- Reduce connection count.
- Simplify connection lifecycle and error handling.
- Keep behavior of both caches unchanged.

---

## 7. Global → Company Signal Gap

### Current Behavior

`processInsertedSignalsForCompany()` is invoked only when:
1. `companyId` is present in the job.
2. `storeResult.inserted > 0`.
3. `insertedIds.length > 0`.

Scenarios where company signals are never generated:

| Scenario | Result |
|----------|--------|
| Job without `companyId` (global-only poll) | No company processing; no company signals. |
| Global signals inserted with `company_id = NULL` | No company context; no company signals. |
| Global signals inserted earlier without company processing | Never processed for any company. |

### Gap

Global signals that are:
- Inserted without `companyId`, or
- Inserted when `companyId` was absent, or
- From global polls that never include `companyId`

will not have corresponding company signals.

### Recommendation

Introduce a background reconciliation job that:
1. Finds `intelligence_signals` rows without a matching `company_intelligence_signals` row (or a subset, e.g. last 7 days).
2. Groups by `company_id` (from `companies` or `company_profiles`) or by a list of active companies.
3. For each company and its recent unprocessed signals, calls `processInsertedSignalsForCompany()`.
4. Runs on a schedule (e.g. hourly or daily) and respects rate limits and backpressure.

---

## 8. Final Safety Report

### Worker Safety Validation

| Check | Status |
|-------|--------|
| `processInsertedSignalsForCompany` only for newly inserted signals | Pass |
| No reprocessing of existing/duplicate global signals | Pass |
| Guard on `storeResult.inserted > 0` | Pass |
| Guard on `companyId` present | Pass |
| Filter `r.inserted && r.id` before passing IDs | Pass |

### Query Efficiency Validation

| Component | Status |
|-----------|--------|
| Company context: once per batch | Pass |
| Aggregator: uses `(company_id, created_at)` | Pass |
| Indexes exist for main query patterns | Pass |

### Cache Safety Validation

| Check | Status |
|-------|--------|
| Cache stampede protection | Missing |
| TTL used | 300 s |
| In-memory fallback when Redis unavailable | Pass |

### Redis Client Usage

| Check | Status |
|-------|--------|
| Shared Redis client across caches | No — separate clients |
| Recommendation | Use shared Redis client |

### Scale Risks Discovered

1. **Cache stampede:** Concurrent API requests for the same company can trigger repeated aggregation when the cache is cold. Recommendation: SETNX lock + short TTL.
2. **Multiple Redis clients:** Two IORedis instances can increase connection load. Recommendation: shared client.
3. **Global → company gap:** Some global signals never get company signals. Recommendation: background reconciliation job.
4. **Aggregator join:** `intelligence_signals!inner(topic)` may add a join for large result sets; acceptable for current scale but worth monitoring.
