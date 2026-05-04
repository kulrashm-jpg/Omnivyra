-- Trend Campaign Multi-Region Recommendation Engine (v2)
-- Do not modify opportunity table or campaign promotion.
-- If table already exists with old status constraint, run:
-- ALTER TABLE recommendation_jobs_v2 DROP CONSTRAINT recommendation_jobs_v2_status_check;
-- ALTER TABLE recommendation_jobs_v2 ADD CONSTRAINT recommendation_jobs_v2_status_check CHECK (status IN ('PENDING','RUNNING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED'));

CREATE TABLE IF NOT EXISTS recommendation_jobs_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED')),
  strategic_payload JSONB,
  selected_pillars JSONB,
  regions TEXT[],
  region_results JSONB DEFAULT '{}'::jsonb,
  consolidated_result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_jobs_v2_company
ON recommendation_jobs_v2(company_id);
