-- Opportunity Engine Error Tracking
-- Persists scanner/engine errors for observability.
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS opportunity_engine_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_engine_errors_occurred
  ON opportunity_engine_errors(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_engine_errors_org
  ON opportunity_engine_errors(organization_id) WHERE organization_id IS NOT NULL;
