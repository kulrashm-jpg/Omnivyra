# Signal Clustering Layer Verification Report

**Audit date:** Verification audit of the signal clustering layer in the Intelligence Platform  
**Scope:** Read-only inspection; no code modifications  
**Purpose:** Pre-Phase-4 verification of clustering and intelligence aggregation

---

## 1. Cluster Tables Discovered

### 1.1 `signal_clusters`

| Attribute | Value |
|-----------|-------|
| **File** | `database/signal_clusters.sql` |
| **Schema** | |
| `cluster_id` | UUID PRIMARY KEY, DEFAULT gen_random_uuid() |
| `cluster_topic` | TEXT NOT NULL |
| `signal_count` | INTEGER NOT NULL DEFAULT 0 |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() |
| `last_updated` | TIMESTAMPTZ NOT NULL DEFAULT now() |
| **Extended** | `source_api_id` (from `database/signal_clusters_source_api_id.sql`) |
| **Relationship** | Referenced by `intelligence_signals.cluster_id`; `signal_intelligence.cluster_id`; `strategic_themes.cluster_id`; `campaign_opportunities.cluster_id` |

### 1.2 `signal_intelligence`

| Attribute | Value |
|-----------|-------|
| **File** | `database/signal_intelligence.sql` |
| **Schema** | |
| `id` | UUID PRIMARY KEY |
| `cluster_id` | UUID NOT NULL, FK → signal_clusters(cluster_id) ON DELETE CASCADE, UNIQUE |
| `topic` | TEXT NOT NULL |
| `momentum_score` | NUMERIC |
| `trend_direction` | TEXT |
| `signal_count` | INTEGER NOT NULL DEFAULT 0 |
| `first_detected_at` | TIMESTAMPTZ |
| `last_detected_at` | TIMESTAMPTZ |
| `companies` | JSONB DEFAULT '[]' |
| `keywords` | JSONB DEFAULT '[]' |
| `influencers` | JSONB DEFAULT '[]' |
| `created_at` | TIMESTAMPTZ DEFAULT now() |
| **Relationship** | One row per cluster; consumed by `strategic_themes`, `companyTrendRelevanceEngine`, `themePreviewService` |

### 1.3 `signal_cluster_members` and `signal_cluster_topics`

| Table | Status |
|-------|--------|
| `signal_cluster_members` | **Does not exist.** Cluster membership is modeled via `intelligence_signals.cluster_id` (direct FK to cluster). |
| `signal_cluster_topics` | **Does not exist.** Topic is stored as `signal_clusters.cluster_topic` (single topic per cluster). |

### 1.4 `intelligence_signals` (signal store with cluster reference)

| Attribute | Value |
|-----------|-------|
| `cluster_id` | UUID NULL — set by `signalClusterEngine` when a signal is assigned to a cluster |
| **Index** | `index_intelligence_signals_cluster` on `cluster_id` WHERE cluster_id IS NOT NULL |

---

## 2. Clustering Services Discovered

| File | Responsibility | Tables Written |
|------|----------------|----------------|
| `backend/services/signalClusterEngine.ts` | Groups unclustered `intelligence_signals` by topic similarity (Jaccard ≥ 0.75); assigns to existing clusters or creates new ones. | `signal_clusters` (INSERT, UPDATE), `intelligence_signals` (UPDATE cluster_id) |
| `backend/services/signalIntelligenceEngine.ts` | Builds intelligence from clusters updated in last 24h: momentum, trend direction, entities. | `signal_intelligence` (UPSERT on cluster_id) |
| `backend/services/intelligenceAnalysisModule.ts` | Wraps `clusterRecentSignals()` and other engines; exposes `clusterSignals()` and `analyzeSignals()`. | None (calls signalClusterEngine) |
| `backend/services/signalCorrelationEngine.ts` | Uses `tokenizeTopic`, `tokenSimilarity` from signalClusterEngine for correlation detection. | None (read-only use of clustering utilities) |

**Not found:** `signalClusteringService`, `trendClusteringService`, `signalAggregationService` — responsibilities are covered by `signalClusterEngine` and `signalIntelligenceEngine`.

---

## 3. Pipeline Integration Point

### Option B: Scheduled Job / Cron

Clustering is driven by a **periodic scheduler**, not by signal insertion:

| Component | File | Schedule | Function |
|-----------|------|----------|----------|
| Cron scheduler | `backend/scheduler/cron.ts` | Every 60 seconds (cycle) | Calls `runSignalClustering()` and `runSignalIntelligenceEngine()` based on intervals |
| Signal clustering | `schedulerService.runSignalClustering()` | Every **30 minutes** | `clusterRecentSignals()` |
| Signal intelligence | `schedulerService.runSignalIntelligenceEngine()` | Every **1 hour** | `generateSignalIntelligence()` |

**Execution flow:**
1. Ingestion: `intelligencePollingWorker` → `intelligenceIngestionModule` → `intelligenceQueryBuilder` → `externalApiService` → normalization → `signalRelevanceEngine` → `intelligenceSignalStore` → `intelligence_signals`
2. Clustering: every 30 min, `cron.ts` → `runSignalClustering()` → `clusterRecentSignals()` → reads unclustered signals (last 6h), writes `signal_clusters` and updates `intelligence_signals.cluster_id`
3. Intelligence: every hour, `cron.ts` → `runSignalIntelligenceEngine()` → `generateSignalIntelligence()` → reads clusters updated in last 24h, upserts `signal_intelligence`

**Alternative trigger:** `intelligenceAnalysisModule.analyzeSignals(companyId)` runs `clusterRecentSignals()` on demand before computing company insights.

---

## 4. Clustering Strategy

| Aspect | Implementation |
|--------|----------------|
| **Similarity metric** | Token-based Jaccard: `tokenSimilarity(tokensA, tokensB) = \|intersection\| / \|union\|` |
| **Threshold** | ≥ 0.75 (`SIMILARITY_THRESHOLD`) |
| **Tokenization** | Lowercase, remove non-alphanumeric, split on whitespace, filter empty |
| **Strategy** | Two-phase greedy: |
| | 1. **Assign to existing:** For each unclustered signal (last 6h), if topic similar to any recent cluster (`cluster_topic`), assign to that cluster |
| | 2. **New clusters:** Remaining signals are grouped by topic similarity; each group becomes a new cluster (cluster_topic = most frequent topic in group) |
| **Not used** | Shared keyword, shared entity, or semantic/embedding similarity |

---

## 5. Intelligence Aggregation Layer

### 5.1 `signal_intelligence` Schema (aggregate metrics)

| Field | Type | Description |
|-------|------|-------------|
| `trend_strength` | — | Not stored; approximated via `momentum_score` |
| `momentum_score` | NUMERIC | Normalized [0,1] from `(count_last_6h * 0.6) + (count_last_24h * 0.4)` |
| `velocity` | — | Implicit via `trend_direction` (UP/DOWN/STABLE) |
| `cluster_size` | — | Stored as `signal_count` |
| `first_detected_at` | TIMESTAMPTZ | Min `detected_at` of cluster signals |
| `last_detected_at` | TIMESTAMPTZ | Max `detected_at` of cluster signals |
| `trend_direction` | TEXT | UP \| STABLE \| DOWN (last 6h vs previous 6h) |
| `companies` | JSONB | Unique companies from `signal_companies` |
| `keywords` | JSONB | Unique keywords from `signal_keywords` |
| `influencers` | JSONB | Unique influencers from `signal_influencers` |

### 5.2 Downstream Consumers

| Consumer | Usage |
|----------|-------|
| `strategicThemeEngine` | Reads `signal_intelligence` where momentum_score ≥ 0.6, trend_direction = 'UP' → creates strategic themes |
| `companyTrendRelevanceEngine` | Joins `strategic_themes` with `signal_intelligence` for company relevance scoring |
| `themePreviewService` | Loads `signal_intelligence` by id for theme preview |
| `campaignOpportunityEngine` | Themes reference `signal_intelligence`; opportunities inherit cluster/intelligence data |

---

## 6. Operational Status of Clustering

### Status: **ACTIVE**

Clustering is implemented and wired into the runtime pipeline.

### How signals progress beyond `intelligence_signals`

1. **Ingestion:** Signals stored in `intelligence_signals` with `cluster_id = NULL`.
2. **Clustering (every 30 min):** `clusterRecentSignals()` processes unclustered signals from last 6 hours:
   - Assigns to similar recent clusters or creates new ones
   - Sets `intelligence_signals.cluster_id`
   - Inserts/updates `signal_clusters`
3. **Intelligence (every hour):** `generateSignalIntelligence()` processes clusters updated in last 24h:
   - Computes momentum, trend direction, entities
   - Upserts `signal_intelligence`
4. **Themes (every hour):** `runStrategicThemeEngine()` turns eligible `signal_intelligence` rows into `strategic_themes`.
5. **Opportunities (every hour):** `runCampaignOpportunityEngine()` turns themes into `campaign_opportunities`.
6. **Company relevance (every 6h):** `runCompanyTrendRelevance()` scores theme relevance per company.

### Prerequisites for correct operation

- `backend/scheduler/cron.ts` (or equivalent scheduler) must be running
- Migration order: `intelligence_signals` → `signal_clusters` → `signal_intelligence` → `strategic_themes` → `campaign_opportunities`
- Entity tables `signal_companies`, `signal_keywords`, `signal_influencers` (from `intelligence_signal_entities.sql`) for aggregation

### Gaps / notes

- No separate `signal_cluster_members` or `signal_cluster_topics`; membership via `intelligence_signals.cluster_id`, topic via `cluster_topic`
- Clustering is asynchronous (30 min cadence); new signals are not clustered immediately
- No semantic/embedding similarity; only token-based Jaccard on topic text

---

## 7. Summary

| Item | Status |
|------|--------|
| Cluster tables | `signal_clusters`, `signal_intelligence` exist and are used |
| Membership tables | Not used; modeled via `intelligence_signals.cluster_id` |
| signalClusterEngine | Active; writes to `signal_clusters`, updates `intelligence_signals` |
| signalIntelligenceEngine | Active; upserts `signal_intelligence` |
| Pipeline trigger | Scheduled (30 min clustering, 1 h intelligence), not on-insert |
| Clustering strategy | Token Jaccard similarity ≥ 0.75 on topic |
| Trend intelligence | Present; momentum, direction, entities, first/last detected |
| Overall clustering | **ACTIVE** — full path: signals → clusters → intelligence → themes → opportunities |
