# Intelligence System Post-Activation Verification Report

**Date:** 2026-03-07  
**Scope:** Read-only verification after activation SQL execution

---

## 1 — External API Source Status

| ID | Source | Category | Active |
|----|--------|----------|--------|
| 0643fc2a | YouTube Trends | - | ✓ |
| 0a4446bb | YouTube Shorts Trends | - | ✓ |
| 2bce9d84 | SerpAPI Google Trends | - | ✓ |
| 4464b5bb | NewsAPI Everything | - | ✓ |

---

## 2 — Company API Configuration

| Company | API Source | Enabled | Polling Frequency |
|---------|------------|---------|-------------------|
| Drishiq | YouTube Trends | ✓ | daily |
| Drishiq | YouTube Shorts Trends | ✓ | daily |
| Drishiq | NewsAPI Everything | ✓ | daily |
| Drishiq | SerpAPI Google Trends | ✓ | daily |

---

## 3 — Intelligence Topic Configuration

| Company ID | Topic | Enabled |
|------------|-------|---------|
| *(none)* | | |

*Phase-3 targeting config (`company_intelligence_topics`) is empty. Run activation SQL step 3 to add topics if needed.*

---

## 4 — Polling Queue Status

| Queue | Pending Jobs | Completed Jobs |
|-------|--------------|----------------|
| intelligence-polling | 0 | 0 |

---

## 5 — Signal Ingestion

| Metric | Count |
|--------|-------|
| Total signals | 0 |
| Signals (last 24h) | 0 |

---

## 6 — Signal Clustering

| Table | Row Count |
|-------|-----------|
| signal_clusters | 0 |

---

## 7 — Signal Intelligence

| Table | Row Count |
|-------|-----------|
| signal_intelligence | 0 |

---

## 8 — Strategic Themes

| Table | Row Count |
|-------|-----------|
| strategic_themes | 0 |

---

## 9 — Company Intelligence Distribution

| Company | Signal Count |
|---------|--------------|
| **Total** | 0 |

---

## 10 — End-to-End Pipeline Status

| Stage | Status |
|-------|--------|
| external_api_sources | ✓ (configured) |
| polling worker | ✓ (queue exists) |
| ingestion | ○ (no signals yet) |
| intelligence_signals | ○ |
| signal_clusters | ○ |
| signal_intelligence | ○ |
| strategic_themes | ○ |
| company_intelligence_signals | ○ |

**Legend:** ✓ = configured / operational | ○ = awaiting data

---

## Summary

- **Configuration:** External API sources and company API configs are correctly configured. Drishiq is linked to 4 active API sources with daily polling.
- **Queue:** `intelligence-polling` queue is reachable; no pending or completed jobs.
- **Pipeline data:** All downstream tables are empty. Signals will appear once the polling worker runs and successfully fetches data from external APIs (and cron/scheduler triggers clustering, signal intelligence, themes, and company distribution).

**To enable data flow:** Ensure workers (`startWorkers.ts`) and cron (`cron.ts`) are running, or manually trigger `enqueueIntelligencePolling()` to enqueue polling jobs.
