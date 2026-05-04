-- =====================================================
-- Signal Embeddings (pgvector)
-- Adds vector support for semantic clustering
-- =====================================================
-- Run after: intelligence_signals.sql, signal_clusters.sql
-- Requires: pgvector extension (Supabase has it by default)
-- =====================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column to intelligence_signals
ALTER TABLE intelligence_signals
ADD COLUMN IF NOT EXISTS topic_embedding vector(1536);

-- 3. Add vector index for cosine similarity search (hnsw)
CREATE INDEX IF NOT EXISTS idx_signal_embedding
ON intelligence_signals
USING hnsw (topic_embedding vector_cosine_ops)
WHERE topic_embedding IS NOT NULL;

-- 4. Add embedding column to signal_clusters (for vector search)
ALTER TABLE signal_clusters
ADD COLUMN IF NOT EXISTS topic_embedding vector(1536);

-- 5. Add vector index on signal_clusters for nearest-neighbor queries
CREATE INDEX IF NOT EXISTS idx_signal_clusters_embedding
ON signal_clusters
USING hnsw (topic_embedding vector_cosine_ops)
WHERE topic_embedding IS NOT NULL;

-- 6. RPC for nearest-cluster search (cosine distance <=>).
-- When since_ts is provided, only clusters with last_updated >= since_ts are considered.
CREATE OR REPLACE FUNCTION match_clusters_by_embedding(
  query_embedding vector(1536),
  match_limit int DEFAULT 5,
  since_ts timestamptz DEFAULT NULL
)
RETURNS TABLE (
  cluster_id uuid,
  cluster_topic text,
  topic_embedding vector(1536),
  signal_count int,
  last_updated timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT sc.cluster_id, sc.cluster_topic, sc.topic_embedding, sc.signal_count, sc.last_updated
  FROM signal_clusters sc
  WHERE sc.topic_embedding IS NOT NULL
    AND (since_ts IS NULL OR sc.last_updated >= since_ts)
  ORDER BY sc.topic_embedding <=> query_embedding
  LIMIT match_limit;
$$;
