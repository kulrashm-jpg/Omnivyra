-- =====================================================
-- Patch: Add company_id to social_accounts for tenant isolation (G2.1–G2.3)
-- Run after: companies, social_accounts
-- Governance: OMNIVYRA-SOCIAL-CONNECTION-GOVERNANCE-RULES.md
-- =====================================================

-- Add company_id column (nullable for legacy rows)
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

COMMENT ON COLUMN social_accounts.company_id IS 'Company context for multi-tenant isolation. New connections must set this.';

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_social_accounts_company_id
  ON social_accounts(company_id);

-- Composite index for (company_id, user_id, platform) lookups
CREATE INDEX IF NOT EXISTS idx_social_accounts_company_user_platform
  ON social_accounts(company_id, user_id, platform)
  WHERE company_id IS NOT NULL;

-- Replace legacy unique constraint with company-aware uniqueness
-- Legacy: one row per (user_id, platform, platform_user_id) when company_id IS NULL
-- New: one row per (user_id, company_id, platform, platform_user_id) when company_id IS NOT NULL
-- Drop legacy unique (PostgreSQL auto-name: social_accounts_user_id_platform_platform_user_id_key)
ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_user_id_platform_platform_user_id_key;

-- Partial unique: legacy rows (company_id NULL) — one per (user_id, platform, platform_user_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_accounts_legacy_unique
  ON social_accounts(user_id, platform, platform_user_id)
  WHERE company_id IS NULL;

-- Partial unique: tenant-scoped rows — one per (user_id, company_id, platform, platform_user_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_accounts_tenant_unique
  ON social_accounts(user_id, company_id, platform, platform_user_id)
  WHERE company_id IS NOT NULL;
