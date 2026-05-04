-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260501100836  Name: company_domains_drop_legacy_domain_and_add_check
-- Idempotency: NOT GUARDED — DROP COLUMN + ADD CONSTRAINT will fail on second apply. Flagged.

-- Fully drop the legacy `company_domains.domain` column.
-- All readers and writers have been migrated to final_domain.
-- saveDomainRecord no longer dual-writes; every consumer uses final_domain.
--
-- CASCADE removes the dependent company_domains_domain_unique UNIQUE
-- constraint at the same time. UNIQUE(final_domain) (constraint
-- unique_final_domain) remains in place as the canonical-uniqueness gate.

ALTER TABLE company_domains
  DROP COLUMN domain CASCADE;

-- Belt-and-braces: the application throws ERROR_INVALID_DOMAIN_STATE on an
-- empty final_domain, but enforce it at the DB layer too so any future direct
-- INSERT (script, console, etc.) cannot create a row with empty canonical.
ALTER TABLE company_domains
  ADD CONSTRAINT final_domain_not_empty CHECK (final_domain <> '');
