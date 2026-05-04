ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS plan_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS creator_execution_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  daily_plan_id UUID NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_execution_audit_campaign ON creator_execution_audit_logs(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_execution_audit_plan ON creator_execution_audit_logs(daily_plan_id, created_at DESC);
