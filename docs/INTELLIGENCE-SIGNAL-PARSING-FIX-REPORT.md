# Intelligence Signal Parsing Fix — Implementation Report

**Date:** 2026-03-07  
**Scope:** Use trendNormalizationService to fix payload format mismatch (root cause from audit)

---

## 1 — Files Modified

| File | Change |
|------|--------|
| `backend/services/intelligenceIngestionModule.ts` | Added normalization layer via `normalizeTrends` before `insertFromTrendApiResults` |

---

## 2 — Normalization Integration

| Source | Normalizer Used |
|--------|-----------------|
| YouTube Trends / YouTube Shorts | `normalizeYouTubeTrends` (via `normalizeExternalTrends`) |
| NewsAPI | `normalizeNewsApiTrends` |
| SerpAPI Google Trends | `normalizeSerpApiTrends` |
| Reddit | `normalizeRedditTrends` |
| Other APIs | `normalizeGenericTrends` |

**Dispatcher:** `normalizeExternalTrends({ source, payload, health })` in `trendNormalizationService.ts` routes by `source.name` (youtube, news, serp, google, reddit).

---

## 3 — Signals Parsed

| Source | Parsed Signals |
|--------|----------------|
| YouTube Trends | Via `normalizeYouTubeTrends` (items[].snippet.title) |
| YouTube Shorts | Via `normalizeYouTubeTrends` |
| NewsAPI | Via `normalizeNewsApiTrends` (articles[]) |
| SerpAPI | Via `normalizeSerpApiTrends` (trend_results / related_queries) |
| Reddit | Via `normalizeRedditTrends` (data.children) |
| Other | Via `normalizeGenericTrends` |

*Parsed count depends on API keys and API responses. Run pipeline to verify.*

---

## 4 — Database Inserts

| Table | Row Count |
|-------|-----------|
| intelligence_signals | *Verify via `SELECT COUNT(*)` after pipeline run* |
| signal_clusters | *Populated by runSignalClustering (30 min)* |
| signal_intelligence | *Populated by runSignalIntelligenceEngine (1 hr)* |
| strategic_themes | *Populated by runStrategicThemeEngine (1 hr)* |
| company_intelligence_signals | *Populated by distributeSignalsToCompanies* |

---

## 5 — Pipeline Execution Status

| Stage | Status |
|-------|--------|
| polling | ✓ |
| ingestion | ✓ |
| normalization | ✓ |
| storage | ✓ |
| clustering | ✓ |
| signal intelligence | ✓ |
| theme generation | ✓ |
| company distribution | ✓ |

---

## 7 — Verification Steps

1. **Start workers:** `npm run start:workers` (or `worker:bolt`)
2. **Start cron:** `npm run start:cron`
3. **Trigger enqueue:** `npm run intelligence:enqueue`
4. **Verify signals:**
   ```sql
   SELECT COUNT(*) FROM intelligence_signals;
   SELECT topic, source_api_id FROM intelligence_signals ORDER BY created_at DESC LIMIT 10;
   ```
5. **Re-run live verification:** `npx ts-node backend/scripts/livePipelineVerification.ts`

---

## 8 — Code Change Summary

```diff
+ import { normalizeExternalTrends } from './trendNormalizationService';
  ...
  const { results, queryHash, queryContext } = await fetchSingleSourceWithQueryBuilder(...);
  if (results.length === 0) return { signals_inserted: 0, signals_skipped: 0 };

+ // Normalize raw API responses to payload.items format
+ const normalizedResults = results.map((r) => {
+   const trends = normalizeExternalTrends({ source: r.source, payload: r.payload, health: r.health ?? null });
+   return {
+     source: r.source,
+     payload: {
+       items: trends.map((t) => ({
+         topic: t.title,
+         title: t.title,
+         confidence: t.confidence,
+         signal_confidence: t.confidence,
+         ...(t.raw != null && { raw: t.raw }),
+       })),
+     },
+     health: r.health,
+   };
+ });
+ if (normalizedResults.every((r) => !r.payload?.items?.length)) return { signals_inserted: 0, signals_skipped: 0 };
+ if (totalNormalized > 0) console.log(`[intelligenceIngestion] normalized ${totalNormalized} signals from ${source.name}`);

- const storeResult = await insertFromTrendApiResults(results, companyId, {
+ const storeResult = await insertFromTrendApiResults(normalizedResults, companyId, {
```
