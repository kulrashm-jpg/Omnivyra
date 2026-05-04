-- marketing_memory
-- Persistent marketing memory per company for AI learning from campaign performance.
-- memory_type: campaign_outcome | content_performance | narrative_performance | audience_pattern | engagement_pattern

CREATE TABLE IF NOT EXISTS marketing_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  memory_value JSONB NOT NULL DEFAULT '{}',
  confidence FLOAT DEFAULT 0.8,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_memory_company_key
  ON marketing_memory (company_id, memory_key);

CREATE INDEX IF NOT EXISTS idx_marketing_memory_company_type
  ON marketing_memory (company_id, memory_type);

CREATE INDEX IF NOT EXISTS idx_marketing_memory_created
  ON marketing_memory (company_id, created_at DESC);

COMMENT ON TABLE marketing_memory IS 'Persistent marketing memory for self-learning: campaign outcomes, narrative performance, audience patterns';