# Intelligence Pipeline — Post-Implementation Validation Audit

**Date:** 2026-03-07  
**Scope:** Verify pipeline is functioning after worker + cron auto-start implementation  
**No code changes — verification only**

---

## 1 — Worker Startup Status

| Check | Status |
|-------|--------|
| Workers start on server bootstrap | **Confirmed** — `instrumentation.ts` calls `await startWorkers()` in `register()` when `NEXT_RUNTIME === 'nodejs'` and `DISABLE_AUTO_WORKERS` not set |
| Intelligence polling worker registered | **Confirmed** — `startWorkers.ts` line 44: `intelligencePollingWorker = getIntelligencePollingWorker()` |
| Worker listens to correct queue | **Confirmed** — `intelligencePollingWorker.ts` line 27: `QUEUE_NAME = 'intelligence-polling'`; Worker created with `QUEUE_NAME` |
| Worker calls ingestSignals() | **Confirmed** — `intelligencePollingWorker.ts` line 52: `await ingestSignals(apiSourceId, companyId ?? null, purpose)` |

---

## 2 — Polling Job Creation

| Check | Status |
|-------|--------|
| startCron() executes on server startup | **Confirmed** — `instrumentation.ts` line 22: `startCron().catch(...)` called after startWorkers |
| enqueueIntelligencePolling() runs immediately | **Confirmed** — `cron.ts` lines 76–84: `if (!lastIntelligencePollingEnqueue)` block runs before first runSchedulerCycle |
| Polling jobs enqueued | **Confirmed** — `enqueueIntelligencePolling` returns `{ enqueued, skipped }`; cron logs `[intelligence] polling jobs enqueued` with count |

**Number of polling jobs created:** Dynamic. Depends on `company_api_configs` (enabled=true) and `external_api_sources` (is_active=true). Prior debug run: **4 jobs** when 4 sources enabled.

---

## 3 — Ingestion Execution Path

| Step | Confirmed |
|------|-----------|
| fetchSingleSourceWithQueryBuilder() called | **Yes** — `intelligenceIngestionModule.ts` line 57 |
| normalizeTrends() executed | **Yes** — `intelligenceIngestionModule.ts` line 67 |
| insertFromTrendApiResults() called | **Yes** — `intelligenceIngestionModule.ts` line 93 |

**Log examples:**
- `[intelligence] processing polling job` + job.data (`intelligencePollingWorker.ts:48`)
- `{"event":"poll_started","apiSourceId":"...","companyId":null,"purpose":"intelligence_polling"}`
- `[intelligenceIngestion] Normalized intelligence signals` + `{ source, normalized_count }` (`intelligenceIngestionModule.ts:88`)
- `{"event":"poll_completed","apiSourceId":"...","duration_ms":...,"signals_inserted":...}`

---

## 4 — Normalization Output

**trendNormalizationService.ts** — `normalizeTrends()` returns `TrendSignal[]` where each item:

```ts
{
  source: string;      // e.g. "YouTube", "NewsAPI"
  title: string;       // maps to topic
  description: string;
  volume?: number;
  geo?: string;
  category?: string;
  confidence: number;   // 0–1
  raw: any;            // metadata
}
```

**Example normalized output (payload.items format in intelligenceIngestionModule):**
```json
{
  "items": [
    {
      "topic": "AI Trends 2025",
      "title": "AI Trends 2025",
      "source": "YouTube",
      "confidence": 0.85,
      "signal_confidence": 0.85,
      "url": "https://...",
      "raw": { "snippet": {...}, "statistics": {...} }
    }
  ]
}
```

---

## 5 — Signal Storage Logic

**intelligenceSignalStore.ts** — `insertFromTrendApiResults` → `buildNormalizedSignalsFromTrendResults` → `insertNormalizedSignals` → Supabase upsert.

**Columns written to `intelligence_signals`:**

| Column | Source |
|--------|--------|
| source_api_id | source.id from trend result |
| company_id | companyId (null for global polling) |
| signal_type | 'trend' |
| topic | item.topic or item.title |
| cluster_id | null (set by downstream clustering) |
| confidence_score | item.signal_confidence or item.confidence |
| detected_at | ISO string |
| source_url | item.url |
| normalized_payload | { topic, ...item } |
| raw_payload | item |
| idempotency_key | SHA256(source_api_id:topic:detected_at[:queryHash]) |
| primary_category | from signalRelevanceEngine (if companyId/queryContext) |
| tags | from signalRelevanceEngine |
| relevance_score | from signalRelevanceEngine |

---

## 6 — Database Pipeline Counts

**Run in Supabase SQL Editor:**

```sql
SELECT COUNT(*) FROM intelligence_signals;
SELECT COUNT(*) FROM signal_clusters;
SELECT COUNT(*) FROM signal_intelligence;
SELECT COUNT(*) FROM strategic_themes;
SELECT COUNT(*) FROM company_intelligence_signals;
```

**Counts:** Requires manual execution. Run the queries above after server has been running with auto-start workers + cron. Expected: counts > 0 if pipeline is flowing; 0 if breakpoint exists.

---

## 7 — Pipeline Breakpoint (If Tables Empty)

If all counts are 0, check in order:

| # | Breakpoint | How to verify |
|---|------------|---------------|
| 1 | Polling not enqueuing | `company_api_configs` has no rows with `enabled = true` → enqueueIntelligencePolling returns 0 |
| 2 | Worker not processing jobs | Workers not started (check logs for `[startup] workers initialized`); Redis down; wrong queue name |
| 3 | Ingestion not extracting signals | `fetchSingleSourceWithQueryBuilder` returns empty; API keys missing; rate limit hit |
| 4 | Normalization returning empty items | `normalizeTrends` returns []; raw API payload shape mismatch |
| 5 | insertFromTrendApiResults not writing | Supabase error; idempotency_key conflict (all duplicates); schema mismatch |

**Most likely (from prior audit):** Breakpoint 1 — no company has `company_api_configs.enabled = true` for any API source, so 0 jobs enqueued.
