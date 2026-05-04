-- opportunity_reports
-- Persists OpportunityReport from Opportunity Detection Engine

CREATE TABLE IF NOT EXISTS opportunity_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  report_json JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opportunity_count INT NOT NULL DEFAULT 0,
  analysis_version TEXT
);

ALTER TABLE opportunity_reports
  ADD COLUMN IF NOT EXISTS analysis_version TEXT;

CREATE INDEX IF NOT EXISTS idx_opportunity_reports_company
  ON opportunity_reports (company_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_reports_company_time
  ON opportunity_reports (company_id, generated_at DESC);
