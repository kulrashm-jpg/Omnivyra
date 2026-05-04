CREATE TABLE IF NOT EXISTS business_intelligence_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL,
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_reports_campaign
  ON business_intelligence_reports(campaign_id);
