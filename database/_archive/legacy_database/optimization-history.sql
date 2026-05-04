CREATE TABLE IF NOT EXISTS optimization_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  campaign_id TEXT,
  week_number INTEGER NOT NULL,
  proposal JSONB NOT NULL,
  status TEXT DEFAULT 'proposal',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE optimization_history
  ADD COLUMN IF NOT EXISTS campaign_id TEXT;

CREATE INDEX IF NOT EXISTS idx_optimization_history_company_week
  ON optimization_history(company_id, week_number);
CREATE INDEX IF NOT EXISTS idx_optimization_history_campaign_week
  ON optimization_history(campaign_id, week_number);
