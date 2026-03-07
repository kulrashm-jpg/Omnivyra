# Phase-4 Company Intelligence Layer — Technical Audit Report

---

## 1. Files Created

| Expected File | Status |
|---------------|--------|
| `backend/services/companySignalFilteringEngine.ts` | **MISSING** |
| `backend/services/companySignalRankingEngine.ts` | **MISSING** |
| `backend/services/companyIntelligenceDashboardService.ts` | **MISSING** |

Existing related files (Phase-2, not Phase-4 spec):
- `backend/services/companyIntelligenceEngine.ts`
- `backend/services/companyIntelligenceStore.ts`
- `backend/services/companyIntelligenceService.ts`
- `backend/services/companyIntelligenceAggregator.ts`
- `backend/services/companyIntelligenceCache.ts`

---

## 2. Files Modified

No Phase-4–specific files were created. The implementation reuses Phase-2 components. Pipeline components (`intelligencePollingWorker`, `intelligenceIngestionModule`, `intelligenceQueryBuilder`, `externalApiService`, `signalRelevanceEngine`, `intelligenceSignalStore`) were not changed for Phase-4; `intelligenceIngestionModule` already had `processInsertedSignalsForCompany` integration from Phase-2.

---

## 3. Filtering Engine Implementation

**Status: PARTIALLY IMPLEMENTED**

- **`companySignalFilteringEngine.ts`**: **MISSING**
- Filtering behavior exists in `companyIntelligenceEngine.ts`, not as a dedicated Phase-4 filtering engine.

**Current implementation (`companyIntelligenceEngine.ts`):**

| Filter Type | Implementation |
|-------------|-----------------|
| topics | Industry terms via `industryTerms`; token overlap with topic |
| competitors | `context.competitors.some(c => topic.includes(c))` |
| products | `context.productFocus.some(p => topic.includes(p))` |
| regions | `geo.includes(context.region.toLowerCase())` |
| keywords | `content_themes` / `content_themes_list` via token overlap |

**Configuration loading:**

- `loadCompanyContextForIntelligence()` reads from `companies` and `company_profiles`
- Phase-3 config tables (`company_intelligence_topics`, `company_intelligence_competitors`, `company_intelligence_products`, `company_intelligence_regions`, `company_intelligence_keywords`) are **not used** for filtering; they are only used by `companyIntelligenceConfigService` for CRUD APIs.

**Signal retrieval:**

- `companyIntelligenceStore.fetchSignalsByIds()` selects from `intelligence_signals` by IDs
- Triggered by `processInsertedSignalsForCompany(companyId, insertedSignalIds)`

**Functions:**

- `transformToCompanySignals()` — filters via `computeCompanyRelevance()` and `MIN_RELEVANCE_THRESHOLD` (0.2)
- `computeCompanyRelevance()` — returns `null` for signals below threshold

---

## 4. Ranking Engine Implementation

**Status: INCORRECT IMPLEMENTATION**

- **`companySignalRankingEngine.ts`**: **MISSING**
- Scoring is done in `companyIntelligenceEngine.computeCompanyRelevance()`.

**Current scoring (not Phase-4 spec):**

- `WEIGHT_BASE_RELEVANCE = 0.4`
- `WEIGHT_INDUSTRY = 0.2` (topic match)
- `WEIGHT_COMPETITOR = 0.25`
- `WEIGHT_KEYWORD = 0.2`
- `WEIGHT_REGION = 0.15`
- `WEIGHT_PRODUCT = 0.2`
- Plus impact: `WEIGHT_IMPACT_MOMENTUM`, `WEIGHT_IMPACT_VOLUME`, `WEIGHT_IMPACT_CONFIDENCE`

**Phase-4 requirements not met:**

| Phase-4 Factor | Status |
|----------------|--------|
| momentum_score | **MISSING** (computed only in `signal_intelligence`, not company layer) |
| topic_match | Partial (industry/keyword overlap) |
| competitor_match | Implemented |
| region_match | Implemented |
| recency | **MISSING** (no recency in score) |

**Output field:** `company_relevance_score` — **not** `signal_score`.

---

## 5. Signal Storage Logic

**Status: PARTIALLY IMPLEMENTED**

**Insert method:** `companyIntelligenceStore.insertCompanyIntelligenceSignals()`

- Uses `supabase.from('company_intelligence_signals').upsert(rows, { onConflict: 'company_id,signal_id', ignoreDuplicates: true })`

**Where executed:** `processInsertedSignalsForCompany()` in `companyIntelligenceStore`, invoked from `intelligenceIngestionModule.ingestSignals()` when `companyId` is set and new signals are inserted.

**Deduplication:** `UNIQUE (company_id, signal_id)` + upsert with `ignoreDuplicates: true`.

**Stored fields comparison:**

| Expected (Phase-4) | Actual |
|-------------------|--------|
| company_id | ✓ |
| signal_id | ✓ |
| signal_score | **MISSING** — stored as `relevance_score` |
| matched_topics | **MISSING** |
| matched_competitors | **MISSING** |
| matched_regions | **MISSING** |
| priority_level | **MISSING** |
| created_at | ✓ |

---

## 6. Priority Logic

**Status: MISSING**

Phase-4 rules:

- HIGH: `momentum_score > 0.7 AND strong topic match`
- MEDIUM: `momentum_score > 0.5`
- LOW: all other relevant signals

**Implementation:** None. No `priority_level` computation or storage. `company_intelligence_signals` has no `priority_level` column. `momentum_score` is not present at the company signal layer.

---

## 7. Dashboard Aggregation

**Status: INCORRECT IMPLEMENTATION**

- **`companyIntelligenceDashboardService.ts`**: **MISSING**
- Closest service: `companyIntelligenceAggregator.ts`

**Phase-4 expected categories:**

- Market Signals
- Competitor Signals
- Product Signals
- Marketing Signals
- Partnership Signals

**Actual categories (`companyIntelligenceAggregator`):**

- trend_clusters
- competitor_activity
- market_shifts
- customer_sentiment

**Grouping logic:**

- Uses `signal_type` from `company_intelligence_signals`
- Values: `competitor_activity`, `market_shift`, `trend`, `product_signal`, `keyword_trend`, `customer_sentiment`, `product_launch`
- No explicit Marketing Signals or Partnership Signals categories

**Query source:** `company_intelligence_signals` with `intelligence_signals!inner(topic)` join.

---

## 8. API Endpoint

**Status: PARTIALLY IMPLEMENTED**

**Expected route:** `/api/company/intelligence/signals`

**Actual route:** `/api/company-intelligence/signals` (file: `pages/api/company-intelligence/signals.ts`)

**Controller/service:** `getRecentCompanySignals()` from `companyIntelligenceService`

**Expected response shape:**
```json
{
  "market_signals": [],
  "competitor_signals": [],
  "product_signals": [],
  "marketing_signals": [],
  "partnership_signals": []
}
```

**Actual response shape:**
```json
{
  "signals": [ { "id", "company_id", "signal_id", "relevance_score", "impact_score", "signal_type", "created_at", "topic" } ]
}
```

---

## 9. Database Schema

**Status: PARTIALLY IMPLEMENTED**

**Definition:** `database/company_intelligence_signals.sql`

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

**Relations:** `signal_id` → `intelligence_signals(id)` ON DELETE CASCADE

**Missing per Phase-4:**

- `signal_score`
- `matched_topics`, `matched_competitors`, `matched_regions`
- `priority_level`

---

## 10. Execution Flow

**Actual flow (Phase-2, with company processing):**

```
intelligencePollingWorker
  → ingestSignals (intelligenceIngestionModule)
    → fetchSingleSourceWithQueryBuilder (externalApiService)
    → insertFromTrendApiResults (intelligenceSignalStore)
      → intelligence_signals
    → processInsertedSignalsForCompany (companyIntelligenceStore)
      → fetchSignalsByIds (intelligence_signals)
      → loadCompanyContextForIntelligence (companyIntelligenceEngine)
      → transformToCompanySignals (companyIntelligenceEngine)
      → insertCompanyIntelligenceSignals
        → company_intelligence_signals
```

**Expected Phase-4 flow (not implemented):**

```
intelligence_signals
  → companySignalFilteringEngine
  → companySignalRankingEngine
  → company_intelligence_signals
  → companyIntelligenceDashboardService
  → API endpoint
```

**Current:** No dedicated filtering/ranking engines. Company processing is a post-insert step on `intelligence_signals` via `companyIntelligenceEngine.transformToCompanySignals` and `companyIntelligenceStore.insertCompanyIntelligenceSignals`.

---

## 11. Pipeline Integrity Verification

| Component | Status |
|-----------|--------|
| intelligencePollingWorker | **UNCHANGED** |
| intelligenceIngestionModule | **UNCHANGED** (already called processInsertedSignalsForCompany) |
| intelligenceQueryBuilder | **UNCHANGED** |
| externalApiService | **UNCHANGED** |
| signalRelevanceEngine | **UNCHANGED** |
| intelligenceSignalStore | **UNCHANGED** |
| signal_clusters | **UNCHANGED** |
| signal_intelligence | **UNCHANGED** |
| strategic_themes | **UNCHANGED** |

Pipeline components were not modified for Phase-4. Company intelligence remains a post-ingestion layer built on Phase-2 services.
