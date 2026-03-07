# Intelligence Platform Operational Audit Report

**Date:** 2025-03-07  
**Purpose:** Confirm end-to-end operational status and downstream integration

---

## 1 — Intelligence Ingestion Status

### External Intelligence Sources

| Source | Enabled | Notes |
|--------|---------|------|
| (none) | — | `external_api_sources`: 0 rows returned. Verification script filters by `enabled`; schema has `is_active`. Enqueue uses `is_active`. |

**Schema note:** Table `external_api_sources` has columns `name`, `is_active`. Enqueue logic uses `company_api_configs.enabled` (per-company) + `external_api_sources.is_active`.

### Polling Worker

| File | Scheduler | Poll Interval | Active |
|------|-----------|---------------|--------|
| `backend/workers/intelligencePollingWorker.ts` | `backend/scheduler/cron.ts` | 2 hours (INTELLIGENCE_POLLING_INTERVAL_MS) | ✅ Worker exists; `getIntelligencePollingWorker()`; processes `intelligence-polling` queue |
| `backend/queue/startWorkers.ts` | — | — | ✅ Imports and starts `getIntelligencePollingWorker()` |

### Ingestion Pipeline — Execution Flow

| Module | File | Invoked By | Status |
|--------|------|------------|--------|
| intelligenceIngestionModule | `backend/services/intelligenceIngestionModule.ts` | intelligencePollingWorker (job handler) | ✅ `ingestSignals(apiSourceId, companyId, purpose)` |
| intelligenceQueryBuilder | `backend/services/intelligenceQueryBuilder.ts` | externalApiService (fetchSingleSourceWithQueryBuilder) | ✅ `expand()` loads templates |
| externalApiService | `backend/services/externalApiService.ts` | intelligenceIngestionModule | ✅ `fetchSingleSourceWithQueryBuilder()` |
| signalRelevanceEngine | `backend/services/signalRelevanceEngine.ts` | intelligenceSignalStore (insertFromTrendApiResults) | ✅ Used in store path |
| intelligenceSignalStore | `backend/services/intelligenceSignalStore.ts` | intelligenceIngestionModule | ✅ `insertFromTrendApiResults()` |
| companySignalDistributionService | `backend/services/companySignalDistributionService.ts` | intelligenceIngestionModule (after insert) | ✅ `distributeSignalsToCompanies(insertedIds)` |

**Flow:** intelligencePollingWorker → ingestSignals → fetchSingleSourceWithQueryBuilder (externalApiService + intelligenceQueryBuilder) → insertFromTrendApiResults → distributeSignalsToCompanies

---

## 2 — Signal Storage Status

**Source:** `fullIntelligenceSystemVerification.ts` (2025-03-07)

| Metric | Count |
|--------|-------|
| Total signals (`intelligence_signals`) | 0 |
| Signals created in last 24 hours | 0 |
| Signals created in last 7 days | 0 |

---

## 3 — Signal Processing Engines

### Cluster Engine

| Engine | File | Table | Row Count |
|--------|------|-------|-----------|
| signalClusterEngine | `backend/services/signalClusterEngine.ts` | `signal_clusters` | 0 |

**Scheduler:** `runSignalClustering()` every 30 minutes (cron.ts)

### Signal Intelligence Engine

| Engine | File | Table | Row Count |
|--------|------|-------|-----------|
| signalIntelligenceEngine | `backend/services/signalIntelligenceEngine.ts` | `signal_intelligence` | 0 |

**Scheduler:** `runSignalIntelligenceEngine()` every 1 hour (cron.ts)

### Strategic Theme Engine

| Engine | File | Table | Row Count |
|--------|------|-------|-----------|
| strategicThemeEngine | `backend/services/strategicThemeEngine.ts` | `strategic_themes` | 0 |

**Scheduler:** `runStrategicThemeEngine()` every 1 hour (cron.ts)

**Source:** `loadEligibleIntelligence()` reads from `signal_intelligence` (momentum >= 0.6, trend_direction = 'UP')

---

## 4 — Company Intelligence Pipeline

### Distribution

| Service | File | Status |
|---------|------|--------|
| companySignalDistributionService | `backend/services/companySignalDistributionService.ts` | ✅ `distributeSignalsToCompanies(insertedSignalIds)`; calls `processInsertedSignalsForCompany` per company |

### Filtering

| Engine | File | Status |
|--------|------|--------|
| companySignalFilteringEngine | `backend/services/companySignalFilteringEngine.ts` | ✅ `filterSignalsForCompany()`; used by companyIntelligenceStore.processInsertedSignalsForCompany |

### Ranking

| Engine | File | Status |
|--------|------|--------|
| companySignalRankingEngine | `backend/services/companySignalRankingEngine.ts` | ✅ `rankSignalsForCompany()`; computes signal_score, priority_level; uses signal_intelligence when available |

### Company Intelligence Signals Table

| Metric | Count |
|--------|-------|
| Total rows (`company_intelligence_signals`) | 0 |
| Companies with signals | 0 |
| Rows with signal_score | 0 |
| Rows with priority_level | 0 |

**Enqueue gating:** `enqueueIntelligencePolling()` only enqueues sources that appear in `company_api_configs` with `enabled = true`. If no company has enabled any API, 0 jobs are enqueued.

---

## 5 — Intelligence Usage by Platform

### Company Profile

| System | Usage |
|--------|-------|
| companyProfileService.ts | No direct use of intelligence signals. Profile fields (target_audience, brand_voice, etc.) feed prompts; intelligence config (topics, competitors, products, regions, keywords) is used by filtering/ranking, not profile service. |

### Strategic Themes

| System | Usage |
|--------|-------|
| strategicThemeEngine.ts | ✅ Themes generated from `signal_intelligence` (loadEligibleIntelligence). `getStrategicThemesAsOpportunities()` returns themes from `strategic_themes` for Campaign Builder, suggest-themes, regenerate-blueprint. |

### Weekly Planning

| System | Usage |
|--------|-------|
| campaignAiOrchestrator.ts | ✅ Uses `prefilledPlanning.strategic_themes` and `recommended_topics` in prompts. Strategic themes come from recommendation/campaign builder flow (getStrategicThemesAsOpportunities, etc.), not directly from intelligence pipeline. Themes influence weekly theme selection and topic seeds. |

### Activity Generation

| System | Usage |
|--------|-------|
| Activity engines | Strategic themes flow via prefilledPlanning into campaignAiOrchestrator; activity/topic generation uses weekly plan themes. No direct activity-engine dependency on `intelligence_signals` or `company_intelligence_signals`. |

### Daily Plan

| System | Usage |
|--------|-------|
| dailyContentDistributionPlanService.ts | Uses `companyPerformanceInsights` (high_performing_platforms, high_performing_content_types, low_performing_patterns) for slot allocation. These are performance/analytics signals, not market intelligence. No direct use of `company_intelligence_signals` or `strategic_themes`. |

### Repurposing

| System | Usage |
|--------|-------|
| repurpose engines | Content repurposing uses weekly plan context and intent; no direct dependency on intelligence signals or themes. |

---

## 6 — Architecture Gaps

| Gap | Description |
|-----|-------------|
| No enabled external API sources | `external_api_sources`: script returns 0 (filter may use `enabled`; schema has `is_active`). Enqueue requires `company_api_configs.enabled = true` for at least one source. |
| No company config | `companies_with_active_config: 0` — no company has Phase-3 config (topics, competitors, products, regions, keywords) enabled. Distribution targets zero companies. |
| Empty operational state | All tables (intelligence_signals, signal_clusters, signal_intelligence, strategic_themes, company_intelligence_signals) have 0 rows. Pipeline code is wired; no data flows without enabled sources and company config. |
| Scheduler/workers must run | Cron (`npm run start:cron`) and workers (`startWorkers.ts`) must be running for ingestion, clustering, and theme generation to execute. |

---

## Pipeline Summary (Code-Verified)

```
intelligencePollingWorker (BullMQ job)
  → ingestSignals (intelligenceIngestionModule)
    → fetchSingleSourceWithQueryBuilder (externalApiService + intelligenceQueryBuilder)
    → insertFromTrendApiResults (intelligenceSignalStore + signalRelevanceEngine)
    → intelligence_signals
    → distributeSignalsToCompanies (companySignalDistributionService)
      → processInsertedSignalsForCompany (companyIntelligenceStore)
        → filterSignalsForCompany (companySignalFilteringEngine)
        → rankSignalsForCompany (companySignalRankingEngine)
        → company_intelligence_signals

[intelligence_signals] → clusterRecentSignals (signalClusterEngine) → signal_clusters
[signal_clusters] → generateSignalIntelligence (signalIntelligenceEngine) → signal_intelligence
[signal_intelligence] → generateStrategicThemes (strategicThemeEngine) → strategic_themes
```

All code paths exist. Data flow is empty until external APIs are enabled and scheduler/workers run.
