-- =====================================================
-- PLAN FEATURES (Governance Layer) — DEPRECATED
-- Phase-2: Super Admin Governance
-- =====================================================
-- SUPERSEDED BY: plan_limits_feature_unification.sql
-- This table was unified into plan_limits. Feature flags are now
-- represented as limit_value (1 = enabled, 0 = disabled).
-- Do not run this file in new environments.
-- =====================================================

CREATE TABLE IF NOT EXISTS plan_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES pricing_plans(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (plan_id, feature)
);

CREATE INDEX IF NOT EXISTS index_plan_features_plan_id
  ON plan_features (plan_id);
CREATE INDEX IF NOT EXISTS index_plan_features_feature
  ON plan_features (feature);
