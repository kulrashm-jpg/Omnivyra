# Intelligence Pipeline Live Data Verification Report

**Date:** 2026-03-07  
**Scope:** First signal flow verification (Phase 5 post-activation)

---

## 1 — Worker Status

| Worker | File |
|--------|------|
| Intelligence Polling Worker | backend/workers/intelligencePollingWorker.ts |

**Start:** `npm run start:workers` or `npm run worker:bolt`

---

## 2 — Scheduler Status

| Job | Interval |
|-----|----------|
| enqueueIntelligencePolling | 2 hours |
| runSignalClustering | 30 minutes |
| runSignalIntelligenceEngine | 1 hour |
| runStrategicThemeEngine | 1 hour |

**Start:** `npm run start:cron`

---

## 3 — Queue Execution

| Queue | Pending | Completed |
|-------|---------|-----------|
| intelligence-polling | 0 | 0 |

---

## 4 — Signal Ingestion

| Metric | Value |
|--------|-------|
| Total signals | 0 |
| Signals last 24h | 0 |

**Sample (last 20):** *(no signals)*

---

## 5 — Signal Clustering

| Table | Row Count |
|-------|-----------|
| signal_clusters | 0 |

---

## 6 — Signal Intelligence

| Table | Row Count |
|-------|-----------|
| signal_intelligence | 0 |

---

## 7 — Strategic Themes

| Table | Row Count |
|-------|-----------|
| strategic_themes | 0 |

---

## 8 — Company Signal Distribution

| Table | Row Count |
|-------|-----------|
| company_intelligence_signals | 0 |

**By company:** *(none)*

---

## 9 — End-to-End Pipeline Status

| Stage | Status |
|-------|--------|
| polling job created | ○ |
| polling job executed | ○ |
| signals ingested | ○ |
| clusters generated | ○ |
| signal intelligence generated | ○ |
| themes generated | ○ |
| company signals distributed | ○ |

**Legend:** ✓ = data flowing | ○ = no data yet

---

## Summary

- **Workers / cron:** Code paths are in place; queue is reachable.
- **Pipeline data:** All tables are empty. No signals have been ingested.
- **Next steps:** Run `npm run start:workers` and `npm run start:cron` concurrently, then `npm run intelligence:enqueue` to enqueue polling jobs. Once external APIs return data, workers will ingest it and the pipeline will populate downstream tables.

**Re-run verification:** `npx ts-node backend/scripts/livePipelineVerification.ts`
