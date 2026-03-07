# Phase 2 — Company Intelligence Layer Implementation Report

**Date:** 2025-03-06  
**Scope:** Company-specific intelligence built on top of global intelligence signals.

---

## 1. System Architecture After Phase 2

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     INTELLIGENCE INGESTION PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────┤
│  External APIs                                                           │
│       │                                                                  │
│       ▼                                                                  │
│  Intelligence Query Builder (Phase 1)                                    │
│       │                                                                  │
│       ▼                                                                  │
│  buildExternalApiRequest → fetch → normalize                              │
│       │                                                                  │
│       ▼                                                                  │
│  signalRelevanceEngine.computeRelevance()                                │
│       │                                                                  │
│       ▼                                                                  │
│  intelligence_signals (global)                                            │
│       │                                                                  │
│       ▼  Phase 2: companyIntelligenceEngine                               │
│       │                                                                  │
│       ▼                                                                  │
│  company_intelligence_signals (company-specific)                         │
│       │                                                                  │
│       ▼                                                                  │
│  companyIntelligenceAggregator → insights                                │
│       │                                                                  │
│       ▼                                                                  │
│  companyIntelligenceCache (Redis) ← → API                                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Files Created

| File | Purpose |
|------|---------|
| `database/company_intelligence_signals.sql` | Migration for company_intelligence_signals table |
| `backend/services/companyIntelligenceEngine.ts` | Converts global signals → company signals via relevance scoring |
| `backend/services/companyIntelligenceStore.ts` | Persists company signals; `processInsertedSignalsForCompany()` |
| `backend/services/companyIntelligenceAggregator.ts` | Aggregates signals into trend_clusters, competitor_activity, market_shifts, customer_sentiment |
| `backend/services/companyIntelligenceCache.ts` | Redis cache for insights and clusters (TTL 300s) |
| `backend/services/companyIntelligenceService.ts` | Orchestrates aggregation + cache for API |
| `pages/api/company-intelligence/signals.ts` | API: recent company signals |
| `pages/api/company-intelligence/insights.ts` | API: aggregated insights |
| `pages/api/company-intelligence/clusters.ts` | API: trend cluster summaries |

---

## 3. Files Modified

| File | Change |
|------|--------|
| `backend/workers/intelligencePollingWorker.ts` | After inserting global signals, calls `processInsertedSignalsForCompany()` when `companyId` present; logs `company_signals_inserted` |

**Phase 1 components unchanged:** `signalClusterEngine`, `signalIntelligenceEngine`, `strategicThemeEngine`, `intelligenceSignalStore`, `signalRelevanceEngine`, `intelligenceQueryBuilder`, `redisExternalApiCache`.

---

## 4. Database Migrations

### company_intelligence_signals

```sql
CREATE TABLE IF NOT EXISTS company_intelligence_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  relevance_score NUMERIC NULL,
  impact_score NUMERIC NULL,
  signal_type TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, signal_id)
);
```

**Indexes:**
- `index_company_intelligence_signals_company` ON (company_id)
- `index_company_intelligence_signals_signal` ON (signal_id)
- `index_company_intelligence_signals_company_relevance` ON (company_id, relevance_score DESC NULLS LAST)
- `index_company_intelligence_signals_company_created` ON (company_id, created_at DESC)

**Run after:** `intelligence_signals` must exist.

---

## 5. Company Intelligence Pipeline

| Step | Component | Description |
|------|-----------|-------------|
| 1 | Global signals inserted | `insertFromTrendApiResults()` — unchanged |
| 2 | Collect inserted IDs | `storeResult.results.filter(r => r.inserted && r.id).map(r => r.id)` |
| 3 | `processInsertedSignalsForCompany()` | Fetch signals by ID → load company context → `transformToCompanySignals()` → insert |
| 4 | companyIntelligenceEngine | Filters by industry, competitors, keywords, region, product focus; outputs `company_relevance_score`, `company_signal_type`, `impact_score` |
| 5 | insertCompanyIntelligenceSignals | Upsert with `onConflict: company_id,signal_id`; invalidates cache on insert |

**Job payload:** Unchanged `{ apiSourceId, companyId?, purpose? }`.

---

## 6. Redis Cache Architecture

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `virality:company:intelligence:{companyId}` | 300s | Full insights (trend_clusters, competitor_activity, market_shifts, customer_sentiment) |
| `virality:company:intelligence:clusters:{companyId}` | 300s | Trend cluster summaries only |

**Failure handling:** In-memory fallback when Redis is unavailable (same pattern as Phase 1 external API cache).

**Invalidation:** `invalidateCompanyCache(companyId)` called when new company signals are inserted.

---

## 7. API Endpoints Created

| Endpoint | Method | Query Params | Response |
|----------|--------|--------------|----------|
| `/api/company-intelligence/signals` | GET | `companyId?`, `limit?`, `windowHours?` | `{ signals: CompanySignalWithTopic[] }` |
| `/api/company-intelligence/insights` | GET | `companyId?`, `windowHours?`, `skipCache?` | `{ insights: CompanyIntelligenceInsights }` |
| `/api/company-intelligence/clusters` | GET | `companyId?`, `windowHours?`, `skipCache?` | `{ clusters: TrendClusterItem[] }` |

**Auth:** Uses `resolveUserContext(req)` for `defaultCompanyId`; `companyId` can also be passed as query param.

---

## 8. Performance Considerations

| Area | Notes |
|------|-------|
| Polling worker | Extra ~50–200 ms per job when `companyId` present and signals inserted (fetch signals, load context, score, insert) |
| Aggregator | Joins `company_intelligence_signals` with `intelligence_signals`; indexes support `(company_id, created_at)` |
| Cache | 300s TTL reduces aggregation load for repeat API calls |
| Company context | Loaded once per batch in `processInsertedSignalsForCompany` |

**Scaling:** For many companies, consider batching or a separate job to backfill company signals for global signals that lack them.

---

## 9. Backward Compatibility Verification

- **signalClusterEngine:** No changes; operates on `intelligence_signals` only.
- **signalIntelligenceEngine:** No changes; uses `intelligence_signals` and `signal_clusters`.
- **strategicThemeEngine:** No changes; uses `signal_intelligence`, `strategic_themes`.
- **companyTrendRelevanceEngine:** No changes; uses `strategic_themes`, `signal_intelligence`, `signal_clusters`.
- **campaignOpportunityEngine:** No changes; uses `strategic_themes`.

Company intelligence is additive; no existing queries or joins were modified.

---

## 10. Risks or Limitations Discovered

| Risk | Severity | Mitigation |
|------|----------|------------|
| Company signals only for newly inserted global signals | Low | Duplicate global signals (skipped) do not get company processing; acceptable for Phase 2. Backfill job could be added later. |
| Supabase relation `intelligence_signals!inner` | Low | May return object or array depending on PostgREST version; code handles both. |
| Empty company context | Low | If no profile/industry, all signals may fall below relevance threshold; no company signals inserted. |
| Redis connection per cache module | Low | `companyIntelligenceCache` creates its own client; shared Redis connection could be refactored later. |

---

## Summary

Phase 2 implements the Company Intelligence Layer as specified:

- Company Intelligence Signal Engine: filters and scores global signals by company context.
- Database table `company_intelligence_signals` with required indexes.
- Company Intelligence Aggregator: trend_clusters, competitor_activity, market_shifts, customer_sentiment.
- Redis cache with keys `virality:company:intelligence:{companyId}` and `virality:company:intelligence:clusters:{companyId}` (300s TTL).
- API endpoints for signals, insights, clusters.
- Polling integration: company signals generated after global signals are inserted, without changing job payload.
