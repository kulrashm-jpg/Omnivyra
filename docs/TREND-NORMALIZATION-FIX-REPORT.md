# Trend Normalization Fix Report

**Date:** 2026-03-07  
**Scope:** trendNormalizationService.ts — ensure API responses reliably produce signals

---

## 1 — Files Modified

| File | Changes |
|------|---------|
| `backend/services/trendNormalizationService.ts` | Fixed YouTube, NewsAPI, SerpAPI extraction; added generic fallback cascade; fixed confidence values; added no-signals log |

---

## 2 — Normalization Logic Added

### YouTube (response.items[])
- **Topic:** `item.snippet.title` or `item.title`
- **Source:** `"YouTube"`
- **Confidence:** `0.8`
- **Metadata:** `item` (raw)
- Returns item if `snippet.title` or `title` exists

### NewsAPI (response.articles[])
- **Topic:** `article.title`
- **Source:** `"NewsAPI"`
- **Confidence:** `0.7`
- **Metadata:** `article` (raw)
- Returns item if `title` exists

### SerpAPI (trend_results | related_queries | interest_over_time.timeline_data)
- **Topic:** `item.query` or `item.title` or `item.keyword` or `item.topic` (or `formattedTime`/`time`/`date` for timeline)
- **Source:** `"SerpAPI"`
- **Confidence:** `0.6`
- Handles all three response structures

### Generic Fallback (items[] | results[] | data[] | data.items[])
- **Topic:** `title` or `name` or `query` or `keyword` or `term` or `headline`
- **Source:** `"GenericAPI"`
- **Confidence:** `0.5`
- **Cascade:** When source-specific normalizer returns `[]`, generic fallback is attempted

### Logging
- `[normalize] no signals extracted` when count is 0
- `[normalize] signals extracted` `{ count }` when count > 0
- Never returns `undefined` — always returns `TrendSignal[]`

---

## 3 — Example Normalized Signals

**YouTube:**
```json
{
  "source": "YouTube",
  "title": "AI Trends 2025",
  "description": "...",
  "confidence": 0.8,
  "raw": { "snippet": { "title": "AI Trends 2025" }, ... }
}
```

**NewsAPI:**
```json
{
  "source": "NewsAPI",
  "title": "Tech giants announce AI partnership",
  "description": "...",
  "confidence": 0.7,
  "raw": { "title": "Tech giants announce AI partnership", ... }
}
```

**SerpAPI:**
```json
{
  "source": "SerpAPI",
  "title": "marketing automation",
  "description": "",
  "confidence": 0.6,
  "raw": { "query": "marketing automation", ... }
}
```

**Generic:**
```json
{
  "source": "GenericAPI",
  "title": "startup trends",
  "description": "",
  "confidence": 0.5,
  "raw": { "name": "startup trends", ... }
}
```

---

## 4 — Signals Extracted Count

Runtime count depends on API responses. After pipeline runs with valid API data:
- Log `[normalize] signals extracted` `{ count: N }` when extraction succeeds
- Log `[normalize] no signals extracted` when payload structure does not match any pattern

---

## 5 — Database Signal Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM intelligence_signals` | **0** |
| Latest signals | *(none)* |

**Note:** Count remains 0 until workers process polling jobs and APIs return data. Normalization fix ensures valid responses are extracted; insertion requires the full pipeline (enqueue → worker → fetch → normalize → store) to run with successful API calls.

---

## Validation Queries

```sql
SELECT COUNT(*) FROM intelligence_signals;

SELECT topic, source_api_id, confidence_score, detected_at
FROM intelligence_signals
ORDER BY detected_at DESC
LIMIT 10;
```
