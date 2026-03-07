-- =====================================================
-- INTELLIGENCE EXECUTION LOGS
-- Execution Control Layer: execution metrics store
-- =====================================================
-- Run after: companies (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS intelligence_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  execution_type TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_intelligence_execution_logs_company
  ON intelligence_execution_logs (company_id);

CREATE INDEX IF NOT EXISTS index_intelligence_execution_logs_type
  ON intelligence_execution_logs (execution_type);

CREATE INDEX IF NOT EXISTS index_intelligence_execution_logs_created
  ON intelligence_execution_logs (company_id, created_at DESC);
