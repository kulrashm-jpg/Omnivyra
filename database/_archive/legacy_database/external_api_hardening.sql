-- =====================================================
-- EXTERNAL API SYSTEM — FINAL HARDENING
-- Run after: company_api_configs.sql, external-api-user-access.sql
-- =====================================================

-- FIX 1: Enablement must only come from company_api_configs.enabled.
-- Remove is_enabled from external_api_user_access so it can never affect availability.
ALTER TABLE external_api_user_access
  DROP COLUMN IF EXISTS is_enabled;

-- FIX 2: Orphan protection — configs disappear when API source is deleted.
ALTER TABLE company_api_configs
  DROP CONSTRAINT IF EXISTS company_api_configs_api_source_id_fkey;

ALTER TABLE company_api_configs
  ADD CONSTRAINT company_api_configs_api_source_id_fkey
  FOREIGN KEY (api_source_id)
  REFERENCES external_api_sources(id)
  ON DELETE CASCADE;

-- FIX 3: Ensure unique company config (constraint may already exist; index enforces at DB level).
CREATE UNIQUE INDEX IF NOT EXISTS company_api_configs_company_api_unique
  ON company_api_configs(company_id, api_source_id);
