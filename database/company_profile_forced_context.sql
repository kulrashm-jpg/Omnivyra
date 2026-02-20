-- =====================================================
-- Forced Context Configuration (company_profiles)
-- User-selected signals that MUST be injected into AI context.
-- =====================================================

ALTER TABLE company_profiles
    ADD COLUMN IF NOT EXISTS forced_context_fields JSONB DEFAULT '{}'::jsonb;
