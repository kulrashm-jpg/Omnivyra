CREATE TABLE IF NOT EXISTS campaign_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL,
  forecast_json JSONB NOT NULL,
  confidence INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_forecasts_campaign
  ON campaign_forecasts(campaign_id);
