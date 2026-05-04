-- =====================================================
-- RESPONSE PATTERNS
-- Reusable response structure templates (not fixed text)
-- Run after: engagement_unified_model.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS response_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  pattern_structure JSONB NOT NULL,
  pattern_category TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_response_patterns_org_category
  ON response_patterns (organization_id, pattern_category);
