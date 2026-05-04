-- campaign_strategic_insights
-- Persists StrategicInsightReport for TTL and history

CREATE TABLE IF NOT EXISTS campaign_strategic_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  report_json JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  insight_count INT NOT NULL DEFAULT 0,
  analysis_version TEXT
);

ALTER TABLE campaign_strategic_insights
  ADD COLUMN IF NOT EXISTS analysis_version TEXT;

CREATE INDEX IF NOT EXISTS idx_campaign_strategic_insights_campaign
  ON campaign_strategic_insights (campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_strategic_insights_campaign_time
  ON campaign_strategic_insights (campaign_id, generated_at DESC);
