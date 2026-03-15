# Downstream Pipeline Activation Audit

**Date:** 2026-03-07

---

## 1 — Signal Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM intelligence_signals` | **21** |

---

## 2 — Cluster Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM signal_clusters` | **16** |

**Verification:**
- Clustering job exists: `runSignalClustering()` in `schedulerService.ts`
- Scheduler triggers clustering: `cron.ts` runs every 30 minutes
- Clustering reads from `intelligence_signals`: `signalClusterEngine.fetchUnclusteredSignals()` selects `intelligence_signals` where `cluster_id IS NULL` and `detected_at` in last 6 hours

---

## 3 — Intelligence Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM signal_intelligence` | **16** |

**Verification:**
- Clusters → intelligence pipeline exists: `signalIntelligenceEngine.generateSignalIntelligence()` loads clusters from `signal_clusters` (last 24h), loads signals per cluster from `intelligence_signals`, upserts `signal_intelligence`
- Scheduler: `runSignalIntelligenceEngine()` every hour

---

## 4 — Strategic Theme Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM strategic_themes` | **5** |

**Verification:**
- Themes generated from `signal_intelligence`: `strategicThemeEngine.generateStrategicThemes()` loads `signal_intelligence` where `momentum_score >= 0.6` and `trend_direction = 'UP'`, inserts into `strategic_themes`
- Scheduler: `runStrategicThemeEngine()` every hour

---

## 5 — Company Signal Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM company_intelligence_signals` | **0** |

**Verification:**
- `companySignalDistributionService.distributeSignalsToCompanies()` is invoked from `intelligenceIngestionModule` after `insertFromTrendApiResults` when `storeResult.inserted > 0`
- Requires `fetchActiveCompanies()`: companies with at least one `enabled = true` in `company_intelligence_topics`, `company_intelligence_competitors`, `company_intelligence_products`, `company_intelligence_regions`, or `company_intelligence_keywords`
- If no active companies, returns `{ companiesProcessed: 0, totalInserted: 0, totalSkipped: 0 }`

---

## 6 — Pipeline Stage Status

| Stage | Table | Count | Status |
|-------|-------|-------|--------|
| Signals | `intelligence_signals` | 21 | ✓ Active |
| Clusters | `signal_clusters` | 16 | ✓ Active |
| Intelligence | `signal_intelligence` | 16 | ✓ Active |
| Themes | `strategic_themes` | 5 | ✓ Active |
| Company signals | `company_intelligence_signals` | 0 | ○ Blocked |

---

## Blocked Stage: Company Intelligence Signals

**Condition:** No rows in `company_intelligence_signals`.

**Root cause:** `fetchActiveCompanies()` returns empty — no companies have `enabled = true` in any of:

- `company_intelligence_topics`
- `company_intelligence_competitors`
- `company_intelligence_products`
- `company_intelligence_regions`
- `company_intelligence_keywords`

**Fix:** Add at least one enabled row for a company in one of these Phase-3 config tables. Example:

```sql
-- Example: enable topic "AI" for a company
INSERT INTO company_intelligence_topics (company_id, topic, enabled)
VALUES ('<company_uuid>', 'AI', true)
ON CONFLICT (company_id, topic) DO UPDATE SET enabled = true;
```

Once a company has enabled config, `distributeSignalsToCompanies()` will run on the next intelligence insert and populate `company_intelligence_signals`.
