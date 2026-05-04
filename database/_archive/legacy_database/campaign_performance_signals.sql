-- Campaign Performance Signals
-- Stores performance metrics per post/signal for the Campaign Learning Layer.
-- Used to influence future strategy via getHighPerformingThemes, etc.
-- Run in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS campaign_performance_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  campaign_id TEXT,
  theme TEXT,
  platform TEXT,
  content_type TEXT,
  post_id TEXT,
  impressions INTEGER DEFAULT 0,
  engagement INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  week_number INTEGER,
  theme_index INTEGER,
  content_slot_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add optional fields if table already exists
ALTER TABLE campaign_performance_signals ADD COLUMN IF NOT EXISTS week_number INTEGER;
ALTER TABLE campaign_performance_signals ADD COLUMN IF NOT EXISTS theme_index INTEGER;
ALTER TABLE campaign_performance_signals ADD COLUMN IF NOT EXISTS content_slot_id TEXT;

CREATE INDEX IF NOT EXISTS idx_campaign_performance_signals_company
  ON campaign_performance_signals(company_id);
CREATE INDEX IF NOT EXISTS idx_campaign_performance_signals_campaign
  ON campaign_performance_signals(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_performance_signals_created
  ON campaign_performance_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_performance_signals_theme
  ON campaign_performance_signals(company_id, theme) WHERE theme IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_performance_signals_platform
  ON campaign_performance_signals(company_id, platform) WHERE platform IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_performance_signals_content_type
  ON campaign_performance_signals(company_id, content_type) WHERE content_type IS NOT NULL;

COMMENT ON TABLE campaign_performance_signals IS 'Performance metrics per post; feeds Campaign Learning Layer for strategy refinement';
