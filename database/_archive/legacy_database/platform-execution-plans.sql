CREATE TABLE IF NOT EXISTS platform_execution_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  campaign_id TEXT,
  week_number INTEGER NOT NULL,
  plan_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_execution_company
  ON platform_execution_plans(company_id);
CREATE INDEX IF NOT EXISTS idx_platform_execution_campaign_week
  ON platform_execution_plans(campaign_id, week_number);
