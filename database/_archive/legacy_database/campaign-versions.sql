CREATE TABLE IF NOT EXISTS campaign_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  campaign_id TEXT,
  campaign_snapshot JSONB NOT NULL,
  status TEXT DEFAULT 'draft',
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE campaign_versions
  ADD COLUMN IF NOT EXISTS campaign_id TEXT;

CREATE INDEX IF NOT EXISTS idx_campaign_versions_company
  ON campaign_versions(company_id);
CREATE INDEX IF NOT EXISTS idx_campaign_versions_campaign
  ON campaign_versions(campaign_id);
