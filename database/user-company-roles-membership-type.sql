-- =====================================================
-- MEMBERSHIP TYPE (Additive — agency / external user prep)
-- =====================================================
-- Do NOT modify existing columns. Adds membership_type only.
-- INTERNAL = default (company's own users). EXTERNAL = agency/external.
-- No permission or behavior change in this migration.
-- =====================================================

ALTER TABLE user_company_roles
  ADD COLUMN IF NOT EXISTS membership_type TEXT DEFAULT 'INTERNAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_company_roles_membership_type_check'
  ) THEN
    ALTER TABLE user_company_roles
      ADD CONSTRAINT user_company_roles_membership_type_check
      CHECK (membership_type IN ('INTERNAL', 'EXTERNAL'));
  END IF;
END $$;

COMMENT ON COLUMN user_company_roles.membership_type IS 'INTERNAL = company user (default). EXTERNAL = agency/external member. Used for future visibility filtering.';
