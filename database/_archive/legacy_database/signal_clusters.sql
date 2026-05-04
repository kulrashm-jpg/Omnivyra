-- =====================================================
-- SIGNAL CLUSTERS
-- Clustering metadata for grouped intelligence signals
-- =====================================================
-- Run after: intelligence_signals.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS signal_clusters (
  cluster_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_topic TEXT NOT NULL,
  signal_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_signal_clusters_topic
  ON signal_clusters (cluster_topic);

CREATE INDEX IF NOT EXISTS index_signal_clusters_created_at
  ON signal_clusters (created_at DESC);

-- Optional: FK from intelligence_signals.cluster_id to signal_clusters.cluster_id
-- (intelligence_signals.cluster_id already exists; add FK if desired)
-- ALTER TABLE intelligence_signals
--   ADD CONSTRAINT fk_intelligence_signals_cluster
--   FOREIGN KEY (cluster_id) REFERENCES signal_clusters(cluster_id) ON DELETE SET NULL;
