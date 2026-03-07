-- =====================================================
-- Plan Limits Feature Unification
-- Unifies plan_features into plan_limits. Removes plan_features table.
-- =====================================================
-- Run after: pricing_plans.sql, plan_limits exists
-- Idempotent: uses IF EXISTS / DO NOTHING where applicable
-- =====================================================

-- 1. Rename monthly_limit to limit_value (unified column for limits and flags)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plan_limits' AND column_name = 'monthly_limit'
  ) THEN
    ALTER TABLE plan_limits RENAME COLUMN monthly_limit TO limit_value;
  END IF;
END $$;

-- Ensure limit_value accepts numeric values (existing type preserved; NULL = unlimited)
-- Note: limit_value keeps BIGINT for large values (llm_tokens). Feature flags use 0/1.

-- 2. Migrate plan_features into plan_limits (before dropping)
-- Feature enabled = 1, disabled = 0. Skip if plan_features does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_features') THEN
    INSERT INTO plan_limits (plan_id, resource_key, limit_value)
    SELECT plan_id, feature, CASE WHEN enabled = true THEN 1 ELSE 0 END
    FROM plan_features
    ON CONFLICT (plan_id, resource_key) DO NOTHING;
  END IF;
END $$;

-- 3. Drop plan_features table
DROP TABLE IF EXISTS plan_features;
