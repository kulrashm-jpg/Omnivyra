-- =====================================================
-- EXTERNAL API HEALTH (Trend Source Monitoring)
-- =====================================================
CREATE TABLE IF NOT EXISTS external_api_health (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_source_id UUID NOT NULL REFERENCES external_api_sources(id) ON DELETE CASCADE,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    last_payload_hash TEXT,
    freshness_score FLOAT DEFAULT 1.0,
    reliability_score FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_api_health_source
ON external_api_health(api_source_id);
