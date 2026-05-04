-- Phase C fix migration — signal intelligence schema (intelligence_signals,
-- signal_clusters, embeddings, RPC). Existed in prod via database/*.sql; now canonical.
--
-- Includes the previously prod-MISSING column signal_clusters.source_api_id (the
-- runtime fallback in backend/services/signalClusterEngine.ts:302 has been
-- printing a "Run database/…" warning because of it). After this migration both
-- prod and replay will have it.

-- pgvector extension (already enabled in prod; idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── intelligence_signals ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.intelligence_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_api_id uuid NOT NULL,
  company_id uuid,
  signal_type text NOT NULL,
  topic text,
  cluster_id uuid,
  confidence_score numeric,
  detected_at timestamp with time zone NOT NULL,
  source_url text,
  normalized_payload jsonb,
  raw_payload jsonb,
  idempotency_key text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  primary_category text,
  tags jsonb DEFAULT '[]'::jsonb,
  relevance_score numeric,
  topic_embedding vector(1536)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='intelligence_signals_pkey') THEN
    ALTER TABLE public.intelligence_signals ADD CONSTRAINT intelligence_signals_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='intelligence_signals_idempotency_key_key') THEN
    ALTER TABLE public.intelligence_signals
      ADD CONSTRAINT intelligence_signals_idempotency_key_key UNIQUE (idempotency_key);
  END IF;
END $$;

CREATE INDEX        IF NOT EXISTS index_intelligence_signals_cluster
  ON public.intelligence_signals (cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS index_intelligence_signals_company_time
  ON public.intelligence_signals (company_id, detected_at DESC) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS index_intelligence_signals_idempotency
  ON public.intelligence_signals (idempotency_key);
CREATE INDEX        IF NOT EXISTS index_intelligence_signals_source_time
  ON public.intelligence_signals (source_api_id, detected_at DESC);
CREATE INDEX        IF NOT EXISTS index_intelligence_signals_topic
  ON public.intelligence_signals (topic) WHERE topic IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_signal_embedding
  ON public.intelligence_signals USING hnsw (topic_embedding vector_cosine_ops)
  WHERE topic_embedding IS NOT NULL;

-- ── signal_clusters ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signal_clusters (
  cluster_id uuid NOT NULL DEFAULT gen_random_uuid(),
  cluster_topic text NOT NULL,
  signal_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_updated timestamp with time zone NOT NULL DEFAULT now(),
  topic_embedding vector(1536)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='signal_clusters_pkey') THEN
    ALTER TABLE public.signal_clusters ADD CONSTRAINT signal_clusters_pkey PRIMARY KEY (cluster_id);
  END IF;
END $$;

-- Fill prod gap: source_api_id column (runtime expects it; was warn-and-skip).
ALTER TABLE public.signal_clusters
  ADD COLUMN IF NOT EXISTS source_api_id uuid;

CREATE INDEX IF NOT EXISTS index_signal_clusters_created_at
  ON public.signal_clusters (created_at DESC);
CREATE INDEX IF NOT EXISTS index_signal_clusters_topic
  ON public.signal_clusters (cluster_topic);
CREATE INDEX IF NOT EXISTS index_signal_clusters_source_api_id
  ON public.signal_clusters (source_api_id) WHERE source_api_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_clusters_embedding
  ON public.signal_clusters USING hnsw (topic_embedding vector_cosine_ops)
  WHERE topic_embedding IS NOT NULL;

-- ── match_clusters_by_embedding RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_clusters_by_embedding(
  query_embedding vector(1536),
  match_limit integer DEFAULT 5,
  since_ts timestamp with time zone DEFAULT NULL
)
RETURNS TABLE (
  cluster_id uuid,
  cluster_topic text,
  topic_embedding vector(1536),
  signal_count integer,
  last_updated timestamp with time zone
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT sc.cluster_id, sc.cluster_topic, sc.topic_embedding, sc.signal_count, sc.last_updated
  FROM public.signal_clusters sc
  WHERE sc.topic_embedding IS NOT NULL
    AND (since_ts IS NULL OR sc.last_updated >= since_ts)
  ORDER BY sc.topic_embedding <=> query_embedding
  LIMIT match_limit;
$$;
