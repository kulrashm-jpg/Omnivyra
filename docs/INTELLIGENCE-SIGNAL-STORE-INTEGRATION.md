# Unified Intelligence Signal Store — Integration Notes

This document describes the **Unified Intelligence Signal Store** implementation, example insertion flow, and integration points with existing services.

---

## 1. Database

### Migration order

1. **intelligence_signals** (requires `external_api_sources`):
   ```bash
   # Run in Supabase SQL editor or migration pipeline
   database/intelligence_signals.sql
   ```
2. **Entity tables** (requires `intelligence_signals`):
   ```bash
   database/intelligence_signal_entities.sql
   ```

### Tables

| Table | Purpose |
|-------|--------|
| `intelligence_signals` | One row per normalized signal; `idempotency_key` unique. |
| `signal_topics` | Topic values per signal (FK → `intelligence_signals`, CASCADE on delete). |
| `signal_companies` | Company references per signal. |
| `signal_keywords` | Keywords/tags per signal. |
| `signal_influencers` | Influencer/author references per signal. |

### Retention

- **365 days**: run `SELECT delete_intelligence_signals_older_than_365_days();` (e.g. from cron).
- Entity tables use `ON DELETE CASCADE`, so old signals and their entities are removed together.

---

## 2. Example insertion flow

### A. From external API trend results (automatic)

When `fetchTrendsFromApis()` runs, it pushes each API result into a `results` array. After the fetch loop (and before returning), it calls the store in a fire-and-forget way:

```ts
// Inside externalApiService.fetchTrendsFromApis()
if (results.length > 0) {
  void insertFromTrendApiResults(results, companyId ?? null).catch((err) => {
    console.warn('intelligenceSignalStore.insertFromTrendApiResults failed', err?.message ?? err);
  });
}
```

No change to the return value of `fetchTrendsFromApis()`; callers still receive `TrendSignal[]` as before.

### B. Direct insert of normalized signals

```ts
import { insertNormalizedSignals, buildIdempotencyKey } from '../backend/services/intelligenceSignalStore';

const signals = [
  {
    source_api_id: 'uuid-of-external-api-source',
    company_id: 'company-uuid-or-null',
    signal_type: 'trend',
    topic: 'AI productivity tools',
    confidence_score: 0.85,
    detected_at: new Date(),
    normalized_payload: { topic: 'AI productivity tools', volume: 1000 },
    topics: ['AI productivity tools'],
    keywords: ['ai', 'productivity'],
  },
];

const result = await insertNormalizedSignals(signals);
// result.inserted, result.skipped, result.results
```

Idempotency key is derived as `hash(source_api_id + topic + detected_at)` if not provided; duplicates are skipped.

### C. From trendProcessingService (when you have sourceApiId)

After you have normalized signals (e.g. from `mergeTrendsAcrossSources`) and the API source id:

```ts
import { mergeTrendsAcrossSources, persistNormalizedTrendSignals } from '../backend/services/trendProcessingService';

const normalized = mergeTrendsAcrossSources(trendSignals);
// Optional: persist to intelligence store (does not change normalized)
await persistNormalizedTrendSignals(normalized, {
  sourceApiId: externalApiSourceId,
  companyId: companyId ?? null,
  detectedAt: new Date(),
  signalType: 'trend',
});
// Continue using normalized as before
```

Existing callers that do not call `persistNormalizedTrendSignals` are unchanged.

### D. Retention cleanup (cron)

```ts
import { runRetentionCleanup } from '../backend/services/intelligenceSignalStore';

const deletedCount = await runRetentionCleanup();
```

Or in SQL: `SELECT delete_intelligence_signals_older_than_365_days();`

---

## 3. Integration points with existing services

| Service | Change | Behavior |
|---------|--------|----------|
| **externalApiService.ts** | After building `results` in `fetchTrendsFromApis()`, calls `insertFromTrendApiResults(results, companyId)`. | Fire-and-forget; errors only logged. Return value of `fetchTrendsFromApis()` unchanged. |
| **trendProcessingService.ts** | New export: `persistNormalizedTrendSignals(signals, options)`. | Optional; no existing function signatures or return values changed. |
| **intelligenceSignalStore.ts** | New service. | `insertNormalizedSignals`, `insertFromTrendApiResults`, `buildIdempotencyKey`, `runRetentionCleanup`. |

### What is not changed

- **recommendation flows**: Legacy (`recommendation_jobs` + `recommendation_raw_signals`) and v2 (`recommendation_jobs_v2`) are unchanged.
- **trendAlignmentService.ts**: Not modified; can later read from `intelligence_signals` if desired.
- **BullMQ / queue**: No new queue or worker; store is called from existing API/service paths.

---

## 4. Idempotency

- Key format: `sha256(source_api_id + ':' + normalized_topic + ':' + detected_at_iso)`.
- Stored in `intelligence_signals.idempotency_key` with `UNIQUE` constraint.
- Inserts use `ON CONFLICT (idempotency_key) DO NOTHING`; duplicates are skipped and entity rows are not written for them.

---

## 5. Later use (not implemented here)

The store is intended to support:

- Trend detection (query by `signal_type`, `topic`, `detected_at`)
- Market / competitor intelligence (new `signal_type`s and entity tables)
- Theme generation (read recent signals by company/source)
- Campaign opportunity detection (join with campaigns by `company_id` or time window)

Query patterns are supported by indexes on `(source_api_id, detected_at DESC)`, `(company_id, detected_at DESC)`, `topic`, and `cluster_id`.
