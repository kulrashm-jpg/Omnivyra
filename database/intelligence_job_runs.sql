-- intelligence_job_runs
-- Logs daily intelligence scheduler execution

CREATE TABLE IF NOT EXISTS intelligence_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  campaigns_processed INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  execution_duration_ms INT,
  strategic_insights_generated INT,
  opportunities_generated INT,
  failed_campaigns INT
);

ALTER TABLE intelligence_job_runs
  ADD COLUMN IF NOT EXISTS execution_duration_ms INT;
ALTER TABLE intelligence_job_runs
  ADD COLUMN IF NOT EXISTS strategic_insights_generated INT;
ALTER TABLE intelligence_job_runs
  ADD COLUMN IF NOT EXISTS opportunities_generated INT;
ALTER TABLE intelligence_job_runs
  ADD COLUMN IF NOT EXISTS failed_campaigns INT;

ALTER TABLE intelligence_job_runs
  ADD COLUMN IF NOT EXISTS events_emitted_count INT;
ALTER TABLE intelligence_job_runs
  ADD COLUMN IF NOT EXISTS alerts_sent_count INT;
ALTER TABLE intelligence_job_runs
  ADD COLUMN IF NOT EXISTS duplicate_events_blocked INT;
ALTER TABLE intelligence_job_runs
  ADD COLUMN IF NOT EXISTS alerts_deduplicated INT;

CREATE INDEX IF NOT EXISTS idx_intelligence_job_runs_job_started
  ON intelligence_job_runs (job_name, started_at DESC);

COMMENT ON COLUMN intelligence_job_runs.status IS 'running | completed | failed';
