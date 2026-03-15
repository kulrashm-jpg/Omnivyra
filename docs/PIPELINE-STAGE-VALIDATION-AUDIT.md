# Pipeline Stage Validation Audit

**Date:** 2026-03-07  
**Scope:** Downstream intelligence pipeline activation after signal insertion

---

## 1 — Signal Ingestion Status

| Check | Status |
|-------|--------|
| Source | `intelligenceSignalStore.insertFromTrendApiResults` → `intelligence_signals` |
| Columns written | `source_api_id`, `company_id`, `signal_type`, `topic`, `cluster_id`, `confidence_score`, `detected_at`, `source_url`, `normalized_payload`, `raw_payload`, `idempotency_key`, `primary_category`, `tags`, `relevance_score` |

**Database (2026-03-07):**
| Metric | Value |
|--------|-------|
| signal count | 0 |
| latest inserted signals | *(none)* |

**Query for latest signals:**
```sql
SELECT topic, source_api_id, confidence_score, detected_at
FROM intelligence_signals
ORDER BY detected_at DESC
LIMIT 10;
```

---

## 2 — Clustering Engine Status

| Check | Status |
|-------|--------|
| Clustering job exists | **Yes** — `runSignalClustering()` in `schedulerService.ts` |
| Runs on schedule | **Yes** — cron every 30 min (`SIGNAL_CLUSTERING_INTERVAL_MS`) |
| Reads from | `intelligence_signals` via `fetchUnclusteredSignals()` (cluster_id IS NULL, last 6h) |
| Writes to | `signal_clusters` (create/update), `intelligence_signals` (set cluster_id) |
| Engine | `signalClusterEngine.clusterRecentSignals()` |

**Database (2026-03-07):**
| Table | Count |
|-------|-------|
| signal_clusters | 0 |

---

## 3 — Signal Intelligence Status

| Check | Status |
|-------|--------|
| Pipeline exists | **Yes** — `signal_clusters` → `signal_intelligence` |
| Engine | `signalIntelligenceEngine.generateSignalIntelligence()` |
| Reads from | `signal_clusters` (last 24h), `intelligence_signals` (by cluster_id) |
| Writes to | `signal_intelligence` (upsert on cluster_id) |
| Schedule | Every hour (`SIGNAL_INTELLIGENCE_INTERVAL_MS`) |

**Database (2026-03-07):**
| Table | Count |
|-------|-------|
| signal_intelligence | 0 |

---

## 4 — Strategic Theme Status

| Check | Status |
|-------|--------|
| Themes from signal_intelligence | **Yes** — `strategicThemeEngine.generateStrategicThemes()` |
| Reads from | `signal_intelligence` (momentum_score >= 0.6, trend_direction = 'UP') |
| Writes to | `strategic_themes` |
| Schedule | Every hour (`STRATEGIC_THEME_INTERVAL_MS`) |

**Database (2026-03-07):**
| Table | Count |
|-------|-------|
| strategic_themes | 0 |

---

## 5 — Company Distribution Status

| Check | Status |
|-------|--------|
| Generation | `companySignalDistributionService.distributeSignalsToCompanies()` |
| Trigger | Called from `intelligenceIngestionModule.ingestSignals()` after `insertFromTrendApiResults` |
| Reads | `company_intelligence_topics`, `company_intelligence_competitors`, etc. (enabled = true) |
| Writes to | `company_intelligence_signals` via `companyIntelligenceStore.processInsertedSignalsForCompany` |
| Gating | Requires `fetchActiveCompanies()` to return non-empty (Phase-3 config tables) |

**Database (2026-03-07):**
| Table | Count |
|-------|-------|
| company_intelligence_signals | 0 |

---

## 6 — Pipeline Health Summary

| Stage | Status | Notes |
|-------|--------|-------|
| **signals** (intelligence_signals) | **NOT RUNNING** | 0 rows; ingestion not producing data |
| **clusters** (signal_clusters) | **BLOCKED** | 0 rows; blocked by empty signals |
| **intelligence** (signal_intelligence) | **BLOCKED** | 0 rows; blocked by empty clusters |
| **themes** (strategic_themes) | **BLOCKED** | 0 rows; blocked by empty intelligence |
| **company_signals** (company_intelligence_signals) | **BLOCKED** | 0 rows; blocked by empty signals |

**Root cause:** No signals in `intelligence_signals`. Downstream stages are correctly wired and scheduled but have no input. Fix signal ingestion (polling → worker → API fetch → normalize → insert) to activate the pipeline.
