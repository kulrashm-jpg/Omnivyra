-- Campaign Strategy Memory (Company-level)
-- Lightweight strategy memory for brand voice, tone, preferred platforms and content types.
-- Run in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS campaign_strategy_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL UNIQUE,
  preferred_tone TEXT NULL,
  preferred_platforms JSONB DEFAULT '[]'::jsonb,
  preferred_content_types JSONB DEFAULT '[]'::jsonb,
  last_updated TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_strategy_memory_company ON campaign_strategy_memory(company_id);

COMMENT ON TABLE campaign_strategy_memory IS 'Company-level strategic preferences: tone, platforms, content types for consistent campaign identity';
