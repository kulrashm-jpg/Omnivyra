CREATE TABLE IF NOT EXISTS campaign_health_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  campaign_id TEXT,
  status TEXT NOT NULL,
  confidence INTEGER DEFAULT 0,
  issues JSONB NOT NULL,
  scores JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_health_company
  ON campaign_health_reports(company_id);
CREATE INDEX IF NOT EXISTS idx_campaign_health_campaign
  ON campaign_health_reports(campaign_id);
