-- Multi-region recommendation orchestration
-- recommendation_jobs: one row per user submission
CREATE TABLE IF NOT EXISTS recommendation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  created_by_user_id UUID,
  selected_api_ids UUID[] NOT NULL DEFAULT '{}',
  regions TEXT[] NOT NULL DEFAULT '{}',
  keyword TEXT,
  goal TEXT,
  use_company_profile BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'READY_FOR_ANALYSIS', 'COMPLETED', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_jobs_company ON recommendation_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_jobs_status ON recommendation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_recommendation_jobs_created ON recommendation_jobs(created_at DESC);

-- recommendation_raw_signals: one row per (job, region, api) execution
CREATE TABLE IF NOT EXISTS recommendation_raw_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES recommendation_jobs(id) ON DELETE CASCADE,
  region_code TEXT NOT NULL,
  api_id UUID NOT NULL,
  normalized_trends_json JSONB,
  raw_payload_json JSONB,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_raw_signals_job ON recommendation_raw_signals(job_id);

-- recommendation_analysis: consolidated LLM output per job
CREATE TABLE IF NOT EXISTS recommendation_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES recommendation_jobs(id) ON DELETE CASCADE UNIQUE,
  consolidated_recommendation_json JSONB NOT NULL DEFAULT '{}',
  divergence_score FLOAT,
  disclaimer_text TEXT,
  confidence_score FLOAT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_analysis_job ON recommendation_analysis(job_id);
