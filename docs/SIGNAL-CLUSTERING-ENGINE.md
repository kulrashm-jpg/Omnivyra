# Signal Clustering Engine

Groups related intelligence signals into clusters using **token-based topic similarity**. Operates on `intelligence_signals`; does not modify ingestion or polling.

---

## 1. Service

**File:** `backend/services/signalClusterEngine.ts`

**Main function:** `clusterRecentSignals()`

- Processes signals from the **last 6 hours** where `cluster_id IS NULL`.
- **Incremental:** If a similar cluster exists (last 6h), assigns signals to it; otherwise creates new clusters.
- **Cluster topic:** Most frequent topic among signals in the group (mode).

---

## 2. SQL migration

**File:** `database/signal_clusters.sql`

**Table:** `signal_clusters`

| Column         | Type      | Description                    |
|----------------|-----------|--------------------------------|
| cluster_id     | UUID (PK) | Generated cluster id           |
| cluster_topic  | TEXT      | Representative topic           |
| signal_count   | INTEGER   | Number of signals in cluster   |
| created_at     | TIMESTAMPTZ | Creation time                |
| last_updated   | TIMESTAMPTZ | Last time cluster was updated |

**Indexes:** `cluster_topic`, `created_at DESC`.

**Signal update:** When signals are grouped, `intelligence_signals.cluster_id` is set to the cluster’s `cluster_id`.

---

## 3. Clustering algorithm

**Input query (conceptually):**

```sql
SELECT id, topic, normalized_payload, detected_at
FROM intelligence_signals
WHERE detected_at > now() - interval '6 hours'
  AND cluster_id IS NULL
```

**Similarity rules:**

1. **Topic similarity ≥ 0.75** (Jaccard on token sets).
2. **Keyword overlap:** Same token set used for Jaccard (token overlap implies keyword overlap).
3. **Window:** All signals are within the same 6-hour window by construction.

**Similarity implementation (lightweight):**

- **Tokenize:** Lowercase, split on non-alphanumeric, unique tokens.
- **Jaccard:** `|intersection| / |union|` of token sets.
- **Threshold:** `≥ 0.75` → same cluster.

**Steps:**

1. Fetch unclustered signals (last 6h).
2. Fetch existing clusters with `last_updated` in last 6h.
3. **Assign to existing:** For each signal, if topic similarity with any recent cluster’s `cluster_topic` ≥ 0.75, assign to that cluster; update `intelligence_signals.cluster_id` and `signal_clusters.signal_count`, `last_updated`.
4. **New clusters:** Remaining signals are grouped by the same similarity (greedy: first signal starts a cluster; others join if similar to any member). For each group, insert `signal_clusters` (cluster_topic = most frequent topic in group), then set `intelligence_signals.cluster_id` for all in the group.

---

## 4. Scheduler

**Every 30 minutes:**

- `schedulerService.runSignalClustering()` calls `clusterRecentSignals()`.
- Wired in `cron.ts` via `SIGNAL_CLUSTERING_INTERVAL_MS = 30 * 60 * 1000`.

No changes to ingestion or polling code.

---

## 5. Example cluster log output

**cluster_run_started**
```json
{"event":"cluster_run_started","window_hours":6}
```

**cluster_created**
```json
{"event":"cluster_created","cluster_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","cluster_topic":"AI productivity automation","signal_count":5}
```

**cluster_updated**
```json
{"event":"cluster_updated","cluster_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","cluster_topic":"AI productivity automation","signal_count":6}
```

**cluster_run_completed**
```json
{"event":"cluster_run_completed","duration_ms":420,"signals_processed":12,"clusters_created":2,"clusters_updated":1}
```

---

## Example: grouped signals → cluster topic

| Signals (topics)                 | Cluster topic              |
|----------------------------------|----------------------------|
| AI productivity tools           | **AI productivity automation** |
| AI workplace automation         |                            |
| AI workflow assistants          |                            |

Cluster topic is the **most frequent** topic among the grouped signals (mode); if there is a tie, the first occurrence wins.
