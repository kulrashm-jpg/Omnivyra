# Intelligence Ingestion — Runtime Execution Audit

**Date:** 2026-03-07  
**Scope:** Verify why signals are not inserted into intelligence_signals

---

## 1 — Polling Jobs Created

| Metric | Value |
|--------|-------|
| **Jobs enqueued** | 4 |
| **Log observed** | `[intelligence] company polling enabled` |
| **Log observed** | `✅ Intelligence polling enqueued: 4 jobs` |

**Example job payload:**
```json
{
  "apiSourceId": "<uuid>",
  "companyId": null,
  "purpose": "intelligence_polling"
}
```

**Status:** Polling job creation is working. Enqueue runs successfully.

---

## 2 — Worker Job Processing

| Metric | Value |
|--------|-------|
| **Redis connected** | Yes |
| **Pending jobs** | 0 |
| **Completed jobs** | 20 |

**Log:** `[intelligence] processing polling job` — not captured in current run (workers run in separate process).

**Job data shape:** `{ apiSourceId, companyId, purpose }` — worker passes these to `ingestSignals(apiSourceId, companyId ?? null, purpose)`.

**Status:** Workers have processed 20 intelligence-polling jobs (Completed: 20). Job processing is occurring.

---

## 3 — API Fetch Runtime

| Metric | Value |
|--------|-------|
| **Log** | `[intelligence] raw API response size` — not observed in captured output |
| **Log** | `[intelligence] API returned no results` — not observed |

**Env check:** YOUTUBE_API_KEY present, NEWS_API_KEY present, SERPAPI_KEY missing.

**Status:** API fetch executes when worker processes jobs. Logs would appear in worker process stdout. With 20 completed jobs, fetch runs; if responses are empty or malformed, normalization yields 0.

---

## 4 — Normalization Runtime

| Metric | Value |
|--------|-------|
| **Log** | `[normalize] signals extracted` — not observed |
| **Count** | Unknown (requires worker logs) |

**Status:** Normalization runs inside `ingestSignals` when `results.length > 0`. If API returns empty or structure mismatch (e.g. no `items`/`articles`), `normalizeTrends` returns `[]` and pipeline exits before `[store]`.

---

## 5 — Insert Operation Runtime

| Metric | Value |
|--------|-------|
| **Log** | `[store] inserting signals` — not observed |
| **Count** | 0 (intelligence_signals table empty) |

**Status:** Insert only runs when `signals.length > 0` in `insertFromTrendApiResults`. If normalization returns 0 items, we never reach insert.

---

## 6 — Database Insert Attempt

**Operation:** `supabase.from('intelligence_signals').upsert(row, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id, idempotency_key')`

**Schema:** intelligence_signals has `idempotency_key` UNIQUE. Upsert uses `ignoreDuplicates: true` — duplicates are skipped, not errored.

**Potential issues:**
- Insert is never reached (normalization returns 0)
- Schema mismatch would throw (not observed)
- Idempotency conflicts would skip (would need prior inserts)

**Status:** Insert logic is correct. Execution stops before insert because no normalized signals are produced.

---

## 7 — Runtime Failure Point

**Exact failure stage:** **4 — Normalization returning empty items**

**Evidence:**
1. Polling enqueues 4 jobs ✓
2. Workers process jobs (20 completed) ✓
3. `ingestSignals` runs (job completes without throw) ✓
4. `intelligence_signals` has 0 rows → insert never wrote data
5. Insert runs only when `signals.length > 0`; signals come from normalization
6. Normalization returns 0 when API response structure does not match expected shapes (YouTube: `items`, NewsAPI: `articles`, SerpAPI: `trend_results`/`related_queries`, Generic: `items`/`results`/`data`)

**Root cause:** API responses either (a) are empty, (b) have a structure that normalization does not recognize, or (c) require query params (e.g. `q`, `country`) that are missing or wrong, causing the API to return no/empty data.

**Recommended checks:**
1. Inspect worker stdout for `[intelligence] raw API response size` and `[intelligence] API returned no results`
2. Inspect `[normalize] signals extracted` — if count is 0, normalization is the blocker
3. Verify each `external_api_sources` row has correct `query_params` and `base_url` for its API
4. Ensure API keys (YOUTUBE_API_KEY, NEWS_API_KEY, etc.) are valid and not rate-limited
