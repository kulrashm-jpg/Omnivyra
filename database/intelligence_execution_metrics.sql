-- =====================================================
-- INTELLIGENCE EXECUTION METRICS
-- Execution Control Layer: quota tracking
-- =====================================================
-- Run after: companies (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS intelligence_execution_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  execution_type TEXT NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT now(),
  execution_date DATE GENERATED ALWAYS AS ((executed_at AT TIME ZONE 'UTC')::date) STORED
);

CREATE INDEX IF NOT EXISTS index_intelligence_execution_metrics_company
  ON intelligence_execution_metrics (company_id);

CREATE INDEX IF NOT EXISTS index_intelligence_execution_metrics_company_type
  ON intelligence_execution_metrics (company_id, execution_type);

CREATE INDEX IF NOT EXISTS index_intelligence_execution_metrics_company_date
  ON intelligence_execution_metrics (company_id, execution_date);

CREATE INDEX IF NOT EXISTS index_intelligence_execution_metrics_executed
  ON intelligence_execution_metrics (company_id, execution_type, executed_at DESC);
