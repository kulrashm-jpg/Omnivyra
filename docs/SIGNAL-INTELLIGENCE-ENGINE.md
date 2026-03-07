# Signal Intelligence Engine

Transforms **signal clusters** into **actionable intelligence** used by Theme Generation, Market Pulse, and Campaign Opportunity Detection. Does not modify signal ingestion, polling, or clustering.

---

## 1. Table: signal_intelligence

**File:** `database/signal_intelligence.sql`

| Column             | Type      | Description                          |
|--------------------|-----------|--------------------------------------|
| id                 | UUID (PK) | Default gen_random_uuid()            |
| cluster_id         | UUID (FK) | References signal_clusters(cluster_id), UNIQUE |
| topic              | TEXT      | Cluster topic                        |
| momentum_score     | NUMERIC   | 0–1 normalized momentum             |
| trend_direction    | TEXT      | UP \| STABLE \| DOWN                 |
| signal_count       | INTEGER   | Number of signals in cluster        |
| first_detected_at  | TIMESTAMPTZ | Min detected_at in cluster        |
| last_detected_at   | TIMESTAMPTZ | Max detected_at in cluster        |
| companies          | JSONB     | Array of company values             |
| keywords           | JSONB     | Array of keyword values             |
| influencers        | JSONB     | Array of influencer values          |
| created_at         | TIMESTAMPTZ | Default now()                      |

One row per cluster (upsert on `cluster_id`).

---

## 2. Service

**File:** `backend/services/signalIntelligenceEngine.ts`

**Main function:** `generateSignalIntelligence()`

**Steps:**

1. Load clusters updated in the **last 24h** from `signal_clusters`.
2. For each cluster, load signals from `intelligence_signals` (by `cluster_id`).
3. **Momentum:** Compute raw = (count_last_6h × 0.6) + (count_last_24h × 0.4); normalize to [0, 1] by dividing by max raw across clusters.
4. **Direction:** Compare count in last 6h vs previous 6h → UP / STABLE / DOWN.
5. **Entities:** Aggregate from `signal_companies`, `signal_keywords`, `signal_influencers` for all signal_ids in the cluster (unique values as JSON arrays).
6. Upsert `signal_intelligence` (on conflict `cluster_id`).

---

## 3. Momentum calculation

```
raw_momentum = (signal_count_last_6h × 0.6) + (signal_count_last_24h × 0.4)
```

- **signal_count_last_6h:** Count of signals in the cluster with `detected_at >= now() - 6 hours`.
- **signal_count_last_24h:** Count of signals in the cluster with `detected_at >= now() - 24 hours`.

**Normalization:** For all clusters in the run, `momentum_score = raw_momentum / max(raw_momentum)`, clamped to [0, 1]. If max is 0, scores stay 0.

---

## 4. Trend direction

- **Last 6h:** signals with `detected_at` in `(now - 6h, now]`.
- **Previous 6h:** signals with `detected_at` in `(now - 12h, now - 6h]`.

| Condition              | trend_direction |
|------------------------|-----------------|
| count_last_6h > count_prev_6h | UP       |
| count_last_6h < count_prev_6h | DOWN     |
| count_last_6h = count_prev_6h | STABLE   |

---

## 5. Entity extraction

For each cluster, all `intelligence_signals` with that `cluster_id` are used. Their IDs are used to query:

- `signal_companies` → distinct `value` → `companies` JSONB array.
- `signal_keywords` → distinct `value` → `keywords` JSONB array.
- `signal_influencers` → distinct `value` → `influencers` JSONB array.

---

## 6. Scheduler

**Every hour:**

- `schedulerService.runSignalIntelligenceEngine()` calls `generateSignalIntelligence()`.
- Wired in `cron.ts` via `SIGNAL_INTELLIGENCE_INTERVAL_MS = 60 * 60 * 1000`.

---

## 7. Observability

**intelligence_run_started**
```json
{"event":"intelligence_run_started"}
```

**intelligence_generated**
```json
{
  "event": "intelligence_generated",
  "cluster_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "topic": "AI productivity automation",
  "momentum_score": 0.82,
  "trend_direction": "UP",
  "signal_count": 12
}
```

**intelligence_run_completed**
```json
{
  "event": "intelligence_run_completed",
  "duration_ms": 850,
  "clusters_processed": 5,
  "records_upserted": 5
}
```

---

## 8. Example intelligence output (record)

Example row in `signal_intelligence`:

```json
{
  "id": "uuid",
  "cluster_id": "cluster-uuid",
  "topic": "AI productivity automation",
  "momentum_score": 0.82,
  "trend_direction": "UP",
  "signal_count": 12,
  "first_detected_at": "2025-03-04T08:00:00Z",
  "last_detected_at": "2025-03-04T13:30:00Z",
  "companies": ["Acme Corp", "TechCo"],
  "keywords": ["AI", "productivity", "automation", "workflow"],
  "influencers": [],
  "created_at": "2025-03-04T14:00:00Z"
}
```

Downstream use: Theme Generation, Market Pulse, and Campaign Opportunity Detection can query `signal_intelligence` by `momentum_score`, `trend_direction`, `topic`, or entity arrays.
