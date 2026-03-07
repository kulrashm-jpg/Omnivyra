-- =====================================================
-- UNIFIED INTELLIGENCE SIGNAL STORE
-- External API Intelligence System — central signal storage
-- =====================================================
-- Run after: external-api-sources.sql (external_api_sources must exist)
-- =====================================================

-- Main table: normalized intelligence signals from external APIs
CREATE TABLE IF NOT EXISTS intelligence_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_api_id UUID NOT NULL REFERENCES external_api_sources(id) ON DELETE CASCADE,
  company_id UUID NULL,
  signal_type TEXT NOT NULL,
  topic TEXT,
  cluster_id UUID NULL,
  confidence_score NUMERIC NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  source_url TEXT NULL,
  normalized_payload JSONB NULL,
  raw_payload JSONB NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate signals when polling APIs repeatedly
ALTER TABLE intelligence_signals
  DROP CONSTRAINT IF EXISTS intelligence_signals_idempotency_key_key;
ALTER TABLE intelligence_signals
  ADD CONSTRAINT intelligence_signals_idempotency_key_key UNIQUE (idempotency_key);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS index_intelligence_signals_source_time
  ON intelligence_signals (source_api_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS index_intelligence_signals_company_time
  ON intelligence_signals (company_id, detected_at DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS index_intelligence_signals_cluster
  ON intelligence_signals (cluster_id)
  WHERE cluster_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS index_intelligence_signals_topic
  ON intelligence_signals (topic)
  WHERE topic IS NOT NULL;

-- (idempotency_key uniqueness enforced by constraint above; no separate index needed)

-- =====================================================
-- RETENTION: delete signals older than 365 days
-- Entity tables use ON DELETE CASCADE so entities are removed automatically
-- =====================================================
CREATE OR REPLACE FUNCTION delete_intelligence_signals_older_than_365_days()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM intelligence_signals
    WHERE detected_at < (now() - INTERVAL '365 days')
    RETURNING id
  )
  SELECT count(*)::INTEGER FROM deleted INTO deleted_count;
  RETURN deleted_count;
END;
$$;

-- Optional: call from cron/scheduler (e.g. daily)
-- SELECT delete_intelligence_signals_older_than_365_days();
