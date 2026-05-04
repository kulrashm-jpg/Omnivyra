-- =====================================================
-- COMPANY EXECUTION PRIORITY
-- Execution Control Layer: priority queue
-- =====================================================
-- Run after: companies (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS company_execution_priority (
  company_id UUID PRIMARY KEY,
  priority_level TEXT NOT NULL DEFAULT 'NORMAL',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_company_execution_priority_level
  ON company_execution_priority (priority_level);
