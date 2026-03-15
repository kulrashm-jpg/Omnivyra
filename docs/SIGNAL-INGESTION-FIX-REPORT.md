# Signal Ingestion Fix Report

**Date:** 2026-03-07  
**Scope:** API fetch → normalization → signal insertion

---

## 1 — Files Modified

| File | Changes |
|------|---------|
| `backend/services/intelligenceQueryBuilder.ts` | Default fallback topic "AI" when `companyId = null`; fallback `q`/`query` when no templates |
| `backend/services/externalApiService.ts` | `[intelligence] raw API response size`; `[intelligence] API returned no results` when missing env or HTTP error |
| `backend/services/trendNormalizationService.ts` | `[normalize] signals extracted` with count |
| `backend/services/intelligenceSignalStore.ts` | `[store] inserting signals` with count |
| `backend/services/intelligenceIngestionModule.ts` | Pipeline debug logs: polling started, raw results fetched, normalized count, signals inserted |

---

## 2 — API Fetch Verification

**Logging added:**
- `[intelligence] raw API response size` — `{ size, keys, hasItems, hasArticles }`
- `[intelligence] API returned no results` — when `missingEnv.length > 0` or `!response.ok`

**Example raw response payload (structure):**
- YouTube: `{ items: [{ snippet: { title }, statistics: { viewCount } }] }`
- NewsAPI: `{ articles: [{ title, description }], totalResults }`
- SerpAPI: `{ trend_results: [{ query, value }] }` or `interest_over_time.timeline_data`
- Generic: `{ items }`, `{ results }`, `{ data }`

---

## 3 — Query Builder Output

**Default fallback topics (when `companyId = null`):**
```ts
['AI', 'marketing automation', 'content marketing', 'startup trends', 'SaaS tools']
```

**Behavior:**
- When `companyId == null` and `topic` is empty → use `"AI"`
- When no templates and no `q`/`query` in `baseParams` → set `q` and `query` to fallback topic
- Templates expand with fallback, e.g. `"{topic} market trends {region}"` → `"AI market trends"`

**Example generated queries:**
- With template `{topic} market trends {region}`: `"AI market trends"`
- With template `{topic} marketing strategy`: `"AI marketing strategy"`
- No templates: `q: "AI"`, `query: "AI"`

---

## 4 — Normalization Output

**Structure:** `TrendSignal[]` → mapped to `payload.items` in ingestion:

```ts
{
  items: [
    { topic: string, source: string, confidence: number, metadata?: { raw } }
  ]
}
```

**Logging:** `[normalize] signals extracted` `{ count }`

**Example normalized output:**
```json
{
  "items": [
    {
      "topic": "AI in Marketing",
      "source": "NewsAPI",
      "confidence": 0.75,
      "metadata": { "raw": { "title": "AI in Marketing", "url": "..." } }
    }
  ]
}
```

---

## 5 — Signal Insert Operation

**Flow:** `insertFromTrendApiResults` → `buildNormalizedSignalsFromTrendResults` → `insertNormalizedSignals` → Supabase upsert

**Logging:** `[store] inserting signals` `{ count }`

**Columns written:** `source_api_id`, `company_id`, `signal_type`, `topic`, `cluster_id`, `confidence_score`, `detected_at`, `source_url`, `normalized_payload`, `raw_payload`, `idempotency_key`, `primary_category`, `tags`, `relevance_score`

**SQL:** `UPSERT INTO intelligence_signals (...) ON CONFLICT (idempotency_key) DO NOTHING`

---

## 6 — Database Signal Count

**After fix (verification run):**
- `SELECT COUNT(*) FROM intelligence_signals` → **0**

**Note:** Count remains 0 until the full pipeline runs (server + workers + cron + Redis + valid API keys). The fix ensures:
1. Global polling uses fallback topic when no company config
2. Query builder always produces a non-empty query for APIs
3. Pipeline stages are logged for debugging

**Latest inserted signals query:**
```sql
SELECT topic, source_api_id, confidence_score, detected_at
FROM intelligence_signals
ORDER BY detected_at DESC
LIMIT 10;
```
*(none)*
