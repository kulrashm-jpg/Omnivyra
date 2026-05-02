-- ─────────────────────────────────────────────────────────────────────────────
-- Fully drop the legacy `company_domains.domain` column.
--
-- Pre-conditions (already in place):
--   - 20260609_company_domains_canonical_foundation.sql added
--     input_domain / final_domain / redirect_chain / is_forwarding /
--     verification_status / override_reason / created_via.
--   - 20260610_company_domains_deprecate_legacy_domain.sql marked the
--     legacy column DEPRECATED via COMMENT.
--   - 20260611_company_domains_final_domain_unique_and_not_null.sql added
--     UNIQUE(final_domain) + NOT NULL final_domain.
--   - All readers in TS code now query final_domain.
--   - saveDomainRecord no longer dual-writes the legacy column and throws
--     ERROR_INVALID_DOMAIN_STATE when final_domain would be empty.
--   - scripts/backfillCanonicalDomains.ts no longer reads the legacy column.
--
-- Effect:
--   - DROP COLUMN domain CASCADE removes the column AND the dependent
--     company_domains_domain_unique UNIQUE constraint.
--   - UNIQUE(final_domain) (constraint unique_final_domain, added in
--     20260611) remains in place as the canonical-uniqueness gate.
--
-- Belt-and-braces:
--   - final_domain_not_empty CHECK enforces non-empty canonical at the DB
--     layer so any direct INSERT (cron, console, script) cannot bypass
--     the application-level ERROR_INVALID_DOMAIN_STATE check.
--
-- Applied to live DB via mcp__supabase__apply_migration on 2026-05-01.
-- This file mirrors the live state.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE company_domains
  DROP COLUMN IF EXISTS domain CASCADE;

ALTER TABLE company_domains
  DROP CONSTRAINT IF EXISTS final_domain_not_empty;
ALTER TABLE company_domains
  ADD  CONSTRAINT final_domain_not_empty CHECK (final_domain <> '');

COMMIT;
