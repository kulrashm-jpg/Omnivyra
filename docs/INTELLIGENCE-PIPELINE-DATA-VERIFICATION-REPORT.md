# Intelligence Pipeline Data Verification Audit Report

**Date:** 2026-03-07  
**Scope:** Final check after normalization implementation

---

## 1 — Signal Ingestion Results

| Metric | Value |
|--------|-------|
| Total signals | 0 |
| Signals last 24h | 0 |

**Recent signals (topic, source_api_id, created_at):** *(none)*

---

## 2 — Clustering Results

| Table | Row Count |
|-------|-----------|
| signal_clusters | 0 |

**Cluster sample:** *(none)*

---

## 3 — Signal Intelligence Results

| Table | Row Count |
|-------|-----------|
| signal_intelligence | 0 |

**Sample (cluster_id, momentum_score, trend_direction):** *(none)*

---

## 4 — Strategic Theme Generation

| Table | Row Count |
|-------|-----------|
| strategic_themes | 0 |

**Recent themes (theme_title, created_at):** *(none)*

---

## 5 — Company Signal Distribution

| Table | Row Count |
|-------|-----------|
| company_intelligence_signals | 0 |

**Distribution by company:** *(none)*

---

## 6 — Source Coverage

| Source | Signal Count |
|--------|--------------|
| *(none)* | |

---

## 7 — Normalization Validation

| topic | confidence_score | source_api_id |
|-------|------------------|---------------|
| *(no signals)* | | |

| Field | Status |
|-------|--------|
| topic | empty/none |
| confidence_score | empty/none |
| source_api_id | empty/none |

---

## 8 — End-to-End Pipeline Status

| Stage | Status |
|-------|--------|
| polling job executed | ○ |
| API fetch | ○ |
| normalization | ○ |
| signals inserted | ○ |
| clustering | ○ |
| signal intelligence | ○ |
| theme generation | ○ |
| company distribution | ○ |

**Legend:** ✓ = data present | ○ = no data yet

---

## Summary

The normalization fix is implemented in `intelligenceIngestionModule.ts`, but the pipeline tables remain empty. To produce data:

1. **Start workers:** `npm run start:workers` (or `npm run worker:bolt`)
2. **Start cron:** `npm run start:cron`
3. **Trigger enqueue:** `npm run intelligence:enqueue`
4. **Verify API keys:** Ensure `YOUTUBE_API_KEY`, `NEWS_API_KEY`, and/or `SERPAPI_KEY` are set in `.env.local`

**Re-run verification:** `npx ts-node backend/scripts/dataVerificationAudit.ts`
