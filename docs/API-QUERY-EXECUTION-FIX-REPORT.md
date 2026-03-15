# API Query Execution Fix Report

**Date:** 2026-03-07

---

## 1 — Files Modified

| File | Changes |
|------|---------|
| `backend/services/externalApiService.ts` | Added `getIntelligenceApiOverrides()` for YouTube/NewsAPI; integrated overrides into `fetchSingleSourceWithQueryBuilder`; added missing-key skip log; consolidated response logging |

---

## 2 — API Source Configuration

**Query:**
```sql
SELECT id, name, base_url, query_params, is_active
FROM external_api_sources;
```

**Typical rows (from activateIntelligenceSystem / migrations):**

| name | base_url | query_params | is_active |
|------|----------|--------------|-----------|
| news_trends | https://newsapi.org/v2/top-headlines | {} | true |
| google_trends | https://trends.google.com/trending/rss | {} | true |
| reddit_trends | https://www.reddit.com/r/trending.json | {} | true |

**Overrides applied at runtime (by source name):**
- **YouTube** (name contains "youtube"): `https://www.googleapis.com/youtube/v3/search`, `part=snippet`, `type=video`, `q`, `maxResults=25`, `key=YOUTUBE_API_KEY`
- **NewsAPI** (name contains "news"): `https://newsapi.org/v2/everything`, `q`, `language=en`, `sortBy=publishedAt`, `pageSize=20`, `apiKey=NEWS_API_KEY`

---

## 3 — Example API Request URLs

**YouTube:**
```
https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=AI&maxResults=25&key=...
```

**NewsAPI:**
```
https://newsapi.org/v2/everything?q=AI&language=en&sortBy=publishedAt&pageSize=20&apiKey=...
```

---

## 4 — Example API Response Payload

**YouTube:**
```json
{
  "items": [
    {
      "snippet": {
        "title": "AI Trends 2025",
        "description": "..."
      }
    }
  ]
}
```

**NewsAPI:**
```json
{
  "articles": [
    {
      "title": "Tech Industry Update",
      "description": "..."
    }
  ]
}
```

**Log output:** `[intelligence] raw API response size` with `{ source, keys, items, articles }`

---

## 5 — Signals Extracted Count

- Depends on normalization and pipeline execution.
- When APIs return data, `[normalize] signals extracted` logs the count.

---

## 6 — Database Signal Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM intelligence_signals` | **0** |
| Latest signals | *(none)* |

**Note:** Count stays 0 until workers run with valid API keys and the pipeline ingests data. The API overrides ensure YouTube and NewsAPI use the correct endpoints and parameters.
