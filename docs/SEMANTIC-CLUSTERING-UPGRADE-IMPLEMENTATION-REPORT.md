# Semantic Clustering Upgrade — Implementation Report

---

## 1. Schema Changes

| Table | Change |
|-------|--------|
| `intelligence_signals` | Added `topic_embedding vector(1536)` |
| `signal_clusters` | Added `topic_embedding vector(1536)` |

**Migration file:** `database/add_signal_embeddings.sql`

---

## 2. Vector Extension Installation

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- pgvector is enabled at the start of the migration.
- Supabase projects typically have pgvector enabled; the migration is idempotent.

---

## 3. New Embedding Service

**File:** `backend/services/signalEmbeddingService.ts`

| Function | Purpose |
|----------|---------|
| `generateTopicEmbedding(topic: string)` | Calls OpenAI text-embedding-3-small; returns 1536-dim vector |
| `embeddingToPgVector(embedding: number[])` | Converts array to pgvector string `[0.1,0.2,...]` |
| `cosineSimilarity(a, b)` | Computes cosine similarity between two vectors |

**Configuration:**
- `OPENAI_EMBEDDING_MODEL` — default: `text-embedding-3-small`
- `OPENAI_API_KEY` — required

---

## 4. Clustering Engine Modifications

**File:** `backend/services/signalClusterEngine.ts`

| Change | Description |
|--------|-------------|
| Hybrid similarity | `finalScore = 0.7 * embeddingSimilarity + 0.3 * tokenSimilarity` |
| Threshold | `finalScore ≥ 0.80` → same cluster (when embeddings present) |
| Fallback | `tokenSimilarity ≥ 0.75` when embeddings missing |
| Lazy embedding | `ensureSignalEmbedding()` generates and stores embedding if null |
| Cluster embedding | New clusters get `topic_embedding` from `cluster_topic` |
| Vector search | RPC `match_clusters_by_embedding` used for nearest-cluster lookup when signal has embedding |

**Behavior:**
1. Fetch unclustered signals; include `topic_embedding`.
2. For each signal, generate embedding if missing and persist.
3. When signal has embedding, call RPC to get top 5 nearest clusters (cosine distance).
4. Check hybrid similarity only against those clusters.
5. If no match, add to remaining; run greedy grouping with hybrid similarity.
6. Create new clusters with `topic_embedding` from `cluster_topic`.

---

## 5. Vector Index Creation

| Index | Table | Type | Ops |
|-------|-------|------|-----|
| `idx_signal_embedding` | intelligence_signals | hnsw | vector_cosine_ops |
| `idx_signal_clusters_embedding` | signal_clusters | hnsw | vector_cosine_ops |

**RPC:** `match_clusters_by_embedding(query_embedding, match_limit, since_ts)`  
Returns nearest clusters by cosine distance, with optional `last_updated >= since_ts` filter.

---

## 6. Backfill Process

**Script:** `scripts/backfill-signal-embeddings.ts`  
**Run:** `npm run backfill:signal-embeddings` or `npx ts-node scripts/backfill-signal-embeddings.ts`

| Step | Description |
|------|-------------|
| 1 | Select signals where `topic_embedding IS NULL` and `topic IS NOT NULL` |
| 2 | Process in batches of 50; 100ms delay between batches |
| 3 | Call `generateTopicEmbedding()` for each topic |
| 4 | Update `intelligence_signals.topic_embedding` |
| 5 | Backfill `signal_clusters.topic_embedding` for clusters with null embedding |

**Prerequisites:** `OPENAI_API_KEY`, Supabase credentials.

---

## 7. Scheduler Compatibility Verification

| Item | Status |
|------|--------|
| `schedulerService.runSignalClustering()` | Unchanged; still invoked by cron |
| Cron interval | 30 minutes (`SIGNAL_CLUSTERING_INTERVAL_MS`) |
| Cron file | `backend/scheduler/cron.ts` — no changes |
| Trigger path | `cron.ts` → `runSignalClustering()` → `clusterRecentSignals()` |

Clustering continues to run as a scheduled job; the upgrade is transparent to the scheduler.

---

## 8. Performance Improvements Expected

| Aspect | Before | After |
|--------|--------|-------|
| Semantic match | None ("AI chip shortage" vs "semiconductor shortage affecting AI hardware" split) | Grouped via embedding similarity |
| Cluster lookup | Linear scan of recent clusters | Vector index + top‑5 nearest |
| Similarity | Token Jaccard only | Hybrid: 70% embedding, 30% token |
| Fallback | N/A | Token-only when embeddings missing |

---

## 9. Confirmation: Ingestion Pipeline Unchanged

| Component | Modified? |
|-----------|-----------|
| intelligencePollingWorker.ts | No |
| intelligenceIngestionModule.ts | No |
| intelligenceQueryBuilder.ts | No |
| externalApiService.ts | No |
| signalRelevanceEngine.ts | No |
| intelligenceSignalStore.ts | No |

Embeddings are produced during clustering (lazy generation on first cluster run) or by the backfill script. The ingestion path is unchanged.

---

## Summary

- Schema: `topic_embedding vector(1536)` on signals and clusters.
- Embeddings: OpenAI text-embedding-3-small via `signalEmbeddingService`.
- Clustering: Hybrid similarity (0.7 embedding + 0.3 token), threshold 0.80, fallback 0.75.
- Vector search: RPC `match_clusters_by_embedding` for nearest-cluster lookup.
- Backfill: `npm run backfill:signal-embeddings`.
- Scheduler: Still 30-minute clustering; no scheduler changes.
