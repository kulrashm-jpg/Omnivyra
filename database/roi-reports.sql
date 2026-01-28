CREATE TABLE IF NOT EXISTS roi_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL,
  roi_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roi_reports_campaign
  ON roi_reports(campaign_id);
