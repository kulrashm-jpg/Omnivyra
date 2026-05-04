-- =====================================================
-- SYSTEM HEALTH METRICS
-- Operational health monitoring for engagement system
-- =====================================================

CREATE TABLE IF NOT EXISTS system_health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  metric_unit TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_system_health_component_time
  ON system_health_metrics (component, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_health_metric_time
  ON system_health_metrics (metric_name, observed_at DESC);
