-- Market Pulse Engine v1: async multi-region pulse jobs and items.
-- Run independently of Trend, Lead, Recommendation engines.

CREATE TABLE IF NOT EXISTS market_pulse_jobs_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  regions text[],
  status text NOT NULL DEFAULT 'PENDING',
  confidence_index integer DEFAULT 0,
  region_results jsonb,
  consolidated_result jsonb,
  error text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS market_pulse_company_idx
ON market_pulse_jobs_v1(company_id);

ALTER TABLE market_pulse_jobs_v1
DROP CONSTRAINT IF EXISTS market_pulse_status_check;

ALTER TABLE market_pulse_jobs_v1
ADD CONSTRAINT market_pulse_status_check CHECK (
  status IN (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'COMPLETED_WITH_WARNINGS',
    'FAILED'
  )
);

-- Pulse items: individual topics per job.
CREATE TABLE IF NOT EXISTS market_pulse_items_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES market_pulse_jobs_v1(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  region text,
  topic text,
  spike_reason text,
  shelf_life_days integer,
  risk_level text,
  priority_score numeric,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pulse_items_company_idx
ON market_pulse_items_v1(company_id);

CREATE INDEX IF NOT EXISTS market_pulse_items_job_idx
ON market_pulse_items_v1(job_id);
