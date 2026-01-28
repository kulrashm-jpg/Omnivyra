CREATE TABLE IF NOT EXISTS scheduler_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  campaign_id TEXT,
  week_number INTEGER NOT NULL,
  platform TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_campaign_week
  ON scheduler_jobs(campaign_id, week_number);
