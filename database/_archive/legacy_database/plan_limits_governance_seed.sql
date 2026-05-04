-- =====================================================
-- PLAN LIMITS — Governance resource keys seed
-- Phase-2: Super Admin Governance
-- =====================================================
-- Adds configuration limit resource_keys for existing plans.
-- Run after: plan_limits_feature_unification.sql (column must be limit_value)
-- These limits will be enforced during company configuration (Phase-3).
-- =====================================================

-- Insert max_topics, max_competitors, max_regions, max_products, max_keywords
-- for each existing plan. Default: 10 (or null for unlimited).
-- Uses ON CONFLICT to skip if row already exists.
INSERT INTO plan_limits (plan_id, resource_key, limit_value)
SELECT id, 'max_topics', 10
FROM pricing_plans
WHERE is_active = true
ON CONFLICT (plan_id, resource_key) DO NOTHING;

INSERT INTO plan_limits (plan_id, resource_key, limit_value)
SELECT id, 'max_competitors', 10
FROM pricing_plans
WHERE is_active = true
ON CONFLICT (plan_id, resource_key) DO NOTHING;

INSERT INTO plan_limits (plan_id, resource_key, limit_value)
SELECT id, 'max_regions', 10
FROM pricing_plans
WHERE is_active = true
ON CONFLICT (plan_id, resource_key) DO NOTHING;

INSERT INTO plan_limits (plan_id, resource_key, limit_value)
SELECT id, 'max_products', 10
FROM pricing_plans
WHERE is_active = true
ON CONFLICT (plan_id, resource_key) DO NOTHING;

INSERT INTO plan_limits (plan_id, resource_key, limit_value)
SELECT id, 'max_keywords', 10
FROM pricing_plans
WHERE is_active = true
ON CONFLICT (plan_id, resource_key) DO NOTHING;
