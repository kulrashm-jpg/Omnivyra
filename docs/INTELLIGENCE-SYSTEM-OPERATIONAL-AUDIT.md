# INTELLIGENCE SYSTEM OPERATIONAL AUDIT

**End-to-End Pipeline Verification**

---

## 1 Signal Pipeline

| Step | Table/Output | Service | Mechanism |
|------|--------------|---------|-----------|
| External signal ingestion | `intelligence_signals` | `intelligenceSignalStore.insertFromTrendApiResults` | Called by `intelligenceIngestionModule.ingestSignals`; invoked by `intelligencePollingWorker` (BullMQ) |
| Signal filtering | `company_intelligence_signals` | `companySignalFilteringEngine` + `companySignalRankingEngine` + `companyIntelligenceStore` | `distributeSignalsToCompanies()` runs after `insertFromTrendApiResults`; `processInsertedSignalsForCompany` → `filterSignalsForCompany` → `rankSignalsForCompany` → `insertRankedCompanyIntelligenceSignals` |
| Clustering | `signal_clusters` | `signalClusterEngine.clusterRecentSignals` | Reads unclustered `intelligence_signals` (cluster_id IS NULL); groups by topic similarity; INSERT/UPDATE `signal_clusters`; UPDATE `intelligence_signals.cluster_id` |
| Cluster intelligence | `signal_intelligence` | `signalIntelligenceEngine.generateSignalIntelligence` | Reads clusters updated in last 24h; computes momentum, trend_direction, entities; UPSERT on `signal_intelligence` |
| Company intelligence aggregation | `CompanyIntelligenceInsights` (in-memory) | `companyIntelligenceAggregator.aggregateCompanyIntelligence` | Reads `company_intelligence_signals` + join `intelligence_signals`; in-memory topic clustering → trend_clusters, competitor_activity, market_shifts, customer_sentiment |

**Note:** Company insights (used by Phase 3 orchestration) are derived from `company_intelligence_signals` → `companyIntelligenceAggregator`. The `signal_clusters` / `signal_intelligence` path feeds `strategicThemeEngine` and Campaign Builder, not the Phase 3 opportunity pipeline.

---

## 2 Graph Build Pipeline

| Check | Status |
|-------|--------|
| Input | `company_intelligence_signals` (with `intelligence_signals` join) |
| Engine | `intelligenceGraphEngine.buildGraphForCompanySignals(companyId, windowHours)` |
| Output | `intelligence_graph_edges` |
| Flow | Fetch company signals in window → `buildEdgesFromSignals()` → `deduplicateEdgesByType()` → `insertGraphEdges()` (upsert with conflict on source, target, edge_type) |
| Trigger | **Manual only** — via API `?buildGraph=true` when calling opportunities or recommendations. **Not scheduled in cron.** |

---

## 3 Correlation Pipeline

| Check | Status |
|-------|--------|
| Input | `company_intelligence_signals` + `intelligence_signals` (id, topic, detected_at, normalized_payload) |
| Engine | `signalCorrelationEngine.detectCorrelations(companyId, windowHours)` |
| Output | `CorrelationResult[]` (in-memory; not persisted) |
| Correlation types | topic_similarity, temporal_proximity, competitor_overlap |
| Uses | `tokenizeTopic`, `tokenSimilarity` from `signalClusterEngine` |

---

## 4 Opportunity Pipeline

| Check | Status |
|-------|--------|
| Input | `CompanyIntelligenceInsights` (from `getCompanyInsights` = `companyIntelligenceAggregator`) + `intelligence_graph_edges` (via `fetchRecentEdgesForCompany`) |
| Engine | `opportunityDetectionEngine.detectOpportunities(companyId, insights, windowHours)` |
| Output | `Opportunity[]` (emerging_trend, competitor_weakness, market_gap, customer_pain_signal) |
| Flow | `getOpportunitiesForCompany` → (optional) `buildGraphForCompanySignals` → `getCompanyInsights` → `detectOpportunities` |

---

## 5 Recommendation Pipeline

| Check | Status |
|-------|--------|
| Input | `Opportunity[]` |
| Engine | `strategicRecommendationEngine.opportunitiesToRecommendations(opportunities)` |
| Output | `StrategicRecommendation[]` (content_opportunity, product_opportunity, marketing_opportunity, competitive_opportunity) |
| Flow | `getRecommendationsForCompany` → `getOpportunitiesForCompany` → `opportunitiesToRecommendations` |

---

## 6 API Execution

| Endpoint | Route File | Status |
|----------|------------|--------|
| `GET /api/intelligence/opportunities` | `pages/api/intelligence/opportunities.ts` | Exists; handler resolves companyId from user or query; returns `{ opportunities }` |
| `GET /api/intelligence/recommendations` | `pages/api/intelligence/recommendations/index.ts` | Exists; returns `{ recommendations }` |
| `GET /api/intelligence/correlations` | `pages/api/intelligence/correlations.ts` | Exists; returns `{ correlations }` |

| Check | Status |
|-------|--------|
| Method | GET only; 405 for other methods |
| Company scoping | `companyId` from `user?.defaultCompanyId ?? req.query.companyId`; 400 if missing |
| Query params | `windowHours` (1–168, default 24); `buildGraph` (opportunities, recommendations only) |
| Response structures | `opportunities`: array of `{ opportunity_type, opportunity_score, supporting_signals, summary }`; `recommendations`: array of `{ recommendation_type, confidence_score, action_summary, supporting_signals }`; `correlations`: array of `{ correlated_signals, correlation_score, correlation_type }` |

**Execution test:** Unauthenticated requests return 401 (likely from auth/session layer). Handler logic and response shapes verified via code review.

---

## 7 Scheduling

| Process | Mechanism | Interval | Cron Entry |
|---------|------------|----------|------------|
| Signal ingestion | `enqueueIntelligencePolling()` → BullMQ → `intelligencePollingWorker` → `ingestSignals` → `insertFromTrendApiResults` + `distributeSignalsToCompanies` | Every 2h | `cron.ts` |
| Cluster updates | `runSignalClustering()` → `clusterRecentSignals()` | Every 30 min | `cron.ts` |
| Signal intelligence | `runSignalIntelligenceEngine()` → `generateSignalIntelligence()` | Every 1h | `cron.ts` |
| **Graph building** | **Not scheduled** | — | — |

**Graph build:** Only triggered when `?buildGraph=true` is passed to opportunities or recommendations API. No cron or queue job.

**Cron/workers:** Run via `backend/scheduler/cron.ts` when started (`npm run start:cron`). Auto-start via `instrumentation.ts` when `ENABLE_AUTO_WORKERS=1`.

---

## 8 Data Flow Consistency

| Link | Verified |
|------|----------|
| `intelligence_signals` → `company_intelligence_signals` | Yes — `distributeSignalsToCompanies` after ingestion; `processInsertedSignalsForCompany` filters/ranks and inserts |
| `intelligence_signals` → `signal_clusters` | Yes — `clusterRecentSignals` reads `intelligence_signals`, writes clusters, updates `intelligence_signals.cluster_id` |
| `signal_clusters` → `signal_intelligence` | Yes — `generateSignalIntelligence` reads clusters, upserts `signal_intelligence` |
| `company_intelligence_signals` → company insights | Yes — `companyIntelligenceAggregator` reads `company_intelligence_signals` + `intelligence_signals` join |
| Company insights → orchestration | Yes — `getCompanyInsights` → `detectOpportunities`; `getOpportunitiesForCompany` → `getRecommendationsForCompany` |
| Graph edges → opportunity detection | Yes — `fetchRecentEdgesForCompany` reads `intelligence_graph_edges` filtered by company signals |

**Parallel paths:**  
- **Path A:** `intelligence_signals` → `signal_clusters` → `signal_intelligence` → `strategic_themes` (Campaign Builder)  
- **Path B:** `intelligence_signals` → `company_intelligence_signals` → company insights → Phase 3 (opportunities, recommendations, correlations)

---

## 9 Operational Gaps

1. **Graph build not scheduled**  
   `buildGraphForCompanySignals` runs only when `?buildGraph=true` is passed to the API. No cron or queue job. Edges may be stale unless explicitly refreshed.

2. **Company signal distribution depends on config**  
   `distributeSignalsToCompanies` runs only for companies with enabled entries in `company_intelligence_topics`, `company_intelligence_competitors`, etc. Companies without config receive no `company_intelligence_signals`.

3. **API auth**  
   Unauthenticated requests to the intelligence APIs return 401. Structure validation of responses requires an authenticated session.

4. **Empty state**  
   With no `intelligence_signals` or `company_intelligence_signals`, opportunities/recommendations/correlations return empty arrays. Pipeline is wired; data availability depends on enabled API sources and company configuration.

---

**Audit complete.** End-to-end pipeline verified; scheduling and data flow documented.
