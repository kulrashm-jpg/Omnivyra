-- =====================================================
-- PATCH 3: Add source_api_id to signal_clusters
-- Enables cluster → source API lookup without querying intelligence_signals.
-- =====================================================

ALTER TABLE signal_clusters
ADD COLUMN IF NOT EXISTS source_api_id UUID REFERENCES external_api_sources(id) ON DELETE SET NULL;

-- Backfill from intelligence_signals (one source_api_id per cluster, arbitrary pick via MIN)
UPDATE signal_clusters sc
SET source_api_id = sub.source_api_id
FROM (
  SELECT cluster_id, MIN(source_api_id) AS source_api_id
  FROM intelligence_signals
  WHERE cluster_id IS NOT NULL
  GROUP BY cluster_id
) sub
WHERE sc.cluster_id = sub.cluster_id;

CREATE INDEX IF NOT EXISTS index_signal_clusters_source_api_id
  ON signal_clusters (source_api_id)
  WHERE source_api_id IS NOT NULL;
