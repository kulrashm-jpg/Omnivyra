-- =====================================================
-- SIGNAL INTELLIGENCE
-- Actionable intelligence derived from signal clusters
-- =====================================================
-- Run after: signal_clusters.sql, intelligence_signal_entities.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS signal_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES signal_clusters(cluster_id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  momentum_score NUMERIC,
  trend_direction TEXT,
  signal_count INTEGER NOT NULL DEFAULT 0,
  first_detected_at TIMESTAMPTZ,
  last_detected_at TIMESTAMPTZ,
  companies JSONB DEFAULT '[]'::jsonb,
  keywords JSONB DEFAULT '[]'::jsonb,
  influencers JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT signal_intelligence_cluster_unique UNIQUE (cluster_id)
);

CREATE INDEX IF NOT EXISTS index_signal_intelligence_cluster
  ON signal_intelligence (cluster_id);

CREATE INDEX IF NOT EXISTS index_signal_intelligence_topic
  ON signal_intelligence (topic);

CREATE INDEX IF NOT EXISTS index_signal_intelligence_momentum
  ON signal_intelligence (momentum_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS index_signal_intelligence_created_at
  ON signal_intelligence (created_at DESC);
