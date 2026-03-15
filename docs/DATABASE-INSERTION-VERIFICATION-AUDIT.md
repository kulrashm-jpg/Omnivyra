# Database Insertion Verification Audit

**Date:** 2026-03-07

---

## 1 — Normalization Output Passed to Store

**Flow:** `intelligenceIngestionModule.ts` → `normalizeTrends()` → `insertFromTrendApiResults()`

**Confirmed:**
- `normalizeTrends()` returns `TrendSignal[]` (flat array)
- Each result in `normalizedResults` gets `payload.items` = all trends mapped to `{ topic, title, confidence, signal_confidence, url, raw }`
- `normalizedResults` is passed to `insertFromTrendApiResults(normalizedResults, companyId, options)`
- `totalNormalized` = `trends.length` = `payload.items.length` per result

**Example payload passed to store:**
```json
[
  {
    "source": { "id": "4464b5bb-...", "name": "NewsAPI" },
    "payload": {
      "items": [
        {
          "topic": "Quantum Artificial Intelligence (AI) Highlights",
          "title": "Quantum Artificial Intelligence (AI) Highlights",
          "confidence": 0.7,
          "signal_confidence": 0.7,
          "url": null,
          "raw": { ... }
        }
      ]
    },
    "health": { ... }
  }
]
```

---

## 2 — Rows Prepared for Insert

**Location:** `intelligenceSignalStore.ts` → `buildNormalizedSignalsFromTrendResults()` → `insertFromTrendApiResults()`

**Flow:**
1. `buildNormalizedSignalsFromTrendResults(results, companyId, detectedAt, signalType)` iterates `results` and `payload.items`
2. For each item with valid `topic`, builds `NormalizedSignalInput` with `source_api_id`, `topic`, `confidence_score`, `detected_at`, `normalized_payload`, `raw_payload`, `topics`
3. `signals.length` = sum of items across all results
4. Log: `[store] rows prepared for insert` with `{ count, exampleRow }`

**Example row prepared:**
```json
{
  "topic": "AI Test Signal",
  "source_api_id": "0643fc2a-7a92-41ad-9734-557176c5c385",
  "confidence_score": 0.9,
  "detected_at": "2026-03-07T11:32:22.604Z",
  "idempotency_key": "(computed)"
}
```

---

## 3 — Supabase Insert Response

**Location:** `intelligenceSignalStore.ts` → `insertNormalizedSignals()` → `supabase.from('intelligence_signals').upsert(...)`

**Logging:** `[store] supabase insert result` with `{ data, error }`

**Example response (successful insert):**
```json
{
  "data": [
    {
      "id": "c2ec7686-5d23-4899-9ec5-bfe3a2490b12",
      "idempotency_key": "test-1772883142604"
    }
  ],
  "error": null
}
```

**Example response (duplicate skip):** `{ data: [], error: null }` — `ignoreDuplicates: true` returns empty array when row already exists.

---

## 4 — Table Schema Verification

**Schema (from `intelligence_signals.sql` + `intelligence_signals_taxonomy.sql`):**

| column_name       | type         | nullable |
|-------------------|--------------|----------|
| id                | UUID         | NO (PK)  |
| source_api_id     | UUID         | NO (FK)  |
| company_id        | UUID         | YES      |
| signal_type       | TEXT         | NO       |
| topic             | TEXT         | YES      |
| cluster_id        | UUID         | YES      |
| confidence_score  | NUMERIC      | YES      |
| detected_at       | TIMESTAMPTZ  | NO       |
| source_url        | TEXT         | YES      |
| normalized_payload| JSONB        | YES      |
| raw_payload       | JSONB        | YES      |
| idempotency_key   | TEXT         | NO (UNIQUE) |
| created_at        | TIMESTAMPTZ  | YES (default now()) |
| primary_category  | TEXT         | YES      |
| tags              | JSONB        | YES (default []) |
| relevance_score   | NUMERIC      | YES      |

**Insert columns match:** ✓ All insert fields (`source_api_id`, `company_id`, `signal_type`, `topic`, `cluster_id`, `confidence_score`, `detected_at`, `source_url`, `normalized_payload`, `raw_payload`, `idempotency_key`, `primary_category`, `tags`, `relevance_score`) exist in schema.

---

## 5 — Idempotency Conflict Check

**Behavior:** `upsert(..., { onConflict: 'idempotency_key', ignoreDuplicates: true })` — duplicates are skipped, not updated.

**Sample idempotency keys (SHA256 hashes):**
```
412e42074f72b6df50f57e839430c43ac2880fdff9a784c9aed6ea0250f2bc3d
d94116f0e80111397b7a0cc9f1700939257ccdd803d6f830628542ea6e72a7b8
c404f7a6f51d07df4c138b8053eead283fba74e2222e78f71476a6da1928da64
...
```

**Formula:** `sha256(source_api_id + ":" + topic.toLowerCase() + ":" + detected_at_iso [+ ":" + queryHash])`

**Conclusion:** No silent conflict — skipped rows return `data: []`; insert path is not reached when duplicate.

---

## 6 — Test Insert Result

**Payload:**
```json
{
  "source_api_id": "0643fc2a-7a92-41ad-9734-557176c5c385",
  "company_id": null,
  "signal_type": "trend",
  "topic": "AI Test Signal",
  "confidence_score": 0.9,
  "detected_at": "2026-03-07T11:32:22.604Z",
  "normalized_payload": {},
  "raw_payload": {},
  "idempotency_key": "test-1772883142604"
}
```

**Result:** `inserted=1`, `skipped=0` — Supabase accepted insert. Returned `id` and `idempotency_key`.

---

## 7 — Database Signal Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM intelligence_signals` | **20** |

**Latest rows:**
| topic | confidence_score | detected_at |
|-------|------------------|--------------|
| Quantum Artificial Intelligence (AI) Highlights | 0.7 | 2026-03-07T10:32:09.616+00:00 |
| Electric Vehicle Battery Management Systems | 0.7 | 2026-03-07T10:32:09.616+00:00 |
| Autonomous Forklift Business Report 2026 | 0.7 | 2026-03-07T10:32:09.616+00:00 |
| Mutual Fund Transfer Agent Business Report | 0.7 | 2026-03-07T10:32:09.616+00:00 |
| Securities Brokerage and Stock Exchange | 0.7 | 2026-03-07T10:32:09.616+00:00 |
| Electrical Enclosure Market Size to Grow | 0.7 | 2026-03-07T10:32:09.616+00:00 |
| Global Telehealth and Telemedicine Market | 0.7 | 2026-03-07T10:32:09.616+00:00 |
| Smart Trash Bin Business Report 2026 | 0.7 | 2026-03-07T10:32:09.616+00:00 |
| War With Iran Is Turning the Energy Affordability | 0.7 | 2026-03-07T10:32:09.616+00:00 |
| Securities Brokerages and Stock Exchange | 0.7 | 2026-03-07T10:32:09.616+00:00 |

---

## Conclusion

**`insertNormalizedSignals` writes to Supabase successfully.** The pipeline is functioning: normalization → store → Supabase insert → `intelligence_signals` table. Signals are being inserted (20 rows, NewsAPI source). The test insert confirmed Supabase accepts inserts with the expected schema.
