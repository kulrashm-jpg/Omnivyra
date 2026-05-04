CREATE TABLE IF NOT EXISTS campaign_memory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  memory_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_memory_company
  ON campaign_memory_snapshots(company_id);
