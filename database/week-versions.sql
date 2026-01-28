CREATE TABLE IF NOT EXISTS week_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  campaign_id TEXT,
  week_number INTEGER NOT NULL,
  week_snapshot JSONB NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE week_versions
  ADD COLUMN IF NOT EXISTS campaign_id TEXT;

CREATE INDEX IF NOT EXISTS idx_week_versions_company_week
  ON week_versions(company_id, week_number);
CREATE INDEX IF NOT EXISTS idx_week_versions_campaign_week
  ON week_versions(campaign_id, week_number);
