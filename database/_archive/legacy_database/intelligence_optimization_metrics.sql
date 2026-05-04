-- =====================================================
-- INTELLIGENCE OPTIMIZATION METRICS
-- Phase 6: Optimization metrics with integrity protection
-- =====================================================
-- Run after: companies (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS intelligence_optimization_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  metric_type TEXT NOT NULL,
  metric_value NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  metric_date DATE GENERATED ALWAYS AS ((created_at AT TIME ZONE 'UTC')::date) STORED
);

-- Metric Integrity Protection: one metric per company per type per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_optimization_metrics_company_type_date
  ON intelligence_optimization_metrics (company_id, metric_type, metric_date);

CREATE INDEX IF NOT EXISTS index_intelligence_optimization_metrics_company
  ON intelligence_optimization_metrics (company_id);

CREATE INDEX IF NOT EXISTS index_intelligence_optimization_metrics_type
  ON intelligence_optimization_metrics (metric_type);

CREATE INDEX IF NOT EXISTS index_intelligence_optimization_metrics_company_created
  ON intelligence_optimization_metrics (company_id, created_at DESC);
