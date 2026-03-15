# Google Trends & Reddit Normalization Extension Report

**Date:** 2026-03-07

---

## 1 — Files Modified

| File | Changes |
|------|---------|
| `backend/services/trendNormalizationService.ts` | Added `normalizeGoogleTrendsRss()`; updated `normalizeRedditTrends()` with fixed confidence 0.65; added structure-based detection (payload.rss → GoogleTrends, payload.data.children → Reddit); added `[normalize] google trends signals extracted` and `[normalize] reddit signals extracted` logging |

---

## 2 — Google Trends Normalization Logic

**Structure:** `response.rss.channel[0].item[]` (or `response.rss.channel.item[]` when channel is object)

**Extraction:**
- `topic` = `item.title`
- `source` = "GoogleTrends"
- `confidence` = 0.75
- `metadata` = `item` (stored in `raw`)

**Detection:** By payload structure (`payload.rss?.channel`) or source name containing "google" (when not SerpAPI-like).

**Logging:** `[normalize] google trends signals extracted` with `{ count }` when signals > 0.

---

## 3 — Reddit Normalization Logic

**Structure:** `response.data.children[]`

**Extraction:**
- `post` = `child.data`
- `topic` = `post.title`
- `source` = "Reddit"
- `confidence` = 0.65
- `metadata` = `post` (stored in `raw`)

**Detection:** By payload structure (`payload.data?.children`) or source name containing "reddit".

**Logging:** `[normalize] reddit signals extracted` with `{ count }` when signals > 0.

---

## 4 — Signals Extracted Count

- **Google Trends:** Logged when `normalizeGoogleTrendsRss` returns > 0 signals
- **Reddit:** Logged when `normalizeRedditTrends` returns > 0 signals
- **Aggregate:** `[normalize] signals extracted` with `{ count, sources }` in `normalizeTrends()`

---

## 5 — Database Signal Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM intelligence_signals` | **0** |
| Latest signals | *(none)* |

**Note:** Count remains 0 until the pipeline runs with Google Trends RSS or Reddit API responses. The normalization layer is ready to extract signals when those APIs return data.

---

## Source Detection Order

1. **Structure-based:** `payload.rss?.channel` → GoogleTrends
2. **Structure-based:** `payload.data?.children` → Reddit
3. **Source name:** youtube → YouTube, news → NewsAPI, reddit → Reddit, serp/google → SerpAPI
4. **Generic fallback** when above return empty
