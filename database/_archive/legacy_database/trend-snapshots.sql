CREATE TABLE IF NOT EXISTS trend_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  campaign_id TEXT,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trend_snapshots
  ADD COLUMN IF NOT EXISTS campaign_id TEXT;

CREATE INDEX IF NOT EXISTS idx_trend_snapshots_company
  ON trend_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_trend_snapshots_campaign
  ON trend_snapshots(campaign_id);
