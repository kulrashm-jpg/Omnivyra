-- =====================================================
-- INTELLIGENCE SIMULATION RUNS
-- Phase 7: Stores simulation run results
-- =====================================================
-- Run after: companies (must exist), intelligence_recommendations (optional)
-- =====================================================

CREATE TABLE IF NOT EXISTS intelligence_simulation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  run_type TEXT NOT NULL,
  scenario_type TEXT NULL,
  input_recommendation_ids JSONB DEFAULT '[]'::jsonb,
  result_summary JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_intelligence_simulation_runs_company
  ON intelligence_simulation_runs (company_id);

CREATE INDEX IF NOT EXISTS index_intelligence_simulation_runs_run_type
  ON intelligence_simulation_runs (run_type);

CREATE INDEX IF NOT EXISTS index_intelligence_simulation_runs_company_created
  ON intelligence_simulation_runs (company_id, created_at DESC);
