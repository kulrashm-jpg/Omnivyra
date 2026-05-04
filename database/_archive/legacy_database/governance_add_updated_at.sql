-- =====================================================
-- Phase-2 Governance Enhancement: updated_at columns
-- Adds updated_at to intelligence_categories (and plan_features if exists)
-- Schema-level metadata for admin visibility and auditing
-- =====================================================
-- Run after: intelligence_categories.sql
-- Note: plan_features was removed by plan_limits_feature_unification.sql
-- =====================================================

-- 1. Add updated_at columns
ALTER TABLE intelligence_categories
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- plan_features: only if table exists (removed by plan_limits_feature_unification)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_features') THEN
    ALTER TABLE plan_features ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- 2. Create trigger function (governance-specific to avoid conflicts)
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Add triggers (idempotent: drop if exists before create)
DROP TRIGGER IF EXISTS intelligence_categories_updated_at ON intelligence_categories;
CREATE TRIGGER intelligence_categories_updated_at
BEFORE UPDATE ON intelligence_categories
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- plan_features trigger: only if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_features') THEN
    DROP TRIGGER IF EXISTS plan_features_updated_at ON plan_features;
    EXECUTE 'CREATE TRIGGER plan_features_updated_at BEFORE UPDATE ON plan_features FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp()';
  END IF;
END $$;
