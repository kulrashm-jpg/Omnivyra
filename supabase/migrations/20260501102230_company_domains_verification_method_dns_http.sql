-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260501102230  Name: company_domains_verification_method_dns_http
-- Idempotency: GUARDED (DROP CONSTRAINT IF EXISTS).

-- Align the verification_method enum to the spec's wire labels: 'dns' / 'http'.
-- The previous CHECK allowed 'dns_txt' / 'http_file' — those tokens were never
-- written to any row (verification flow had not yet been used in production),
-- so this migration is purely a constraint rename, not a data migration.
--
-- Index on verification_status was already added by migration 20260609; this
-- migration only updates the CHECK constraint.

ALTER TABLE company_domains
  DROP CONSTRAINT IF EXISTS company_domains_verification_method_check;
ALTER TABLE company_domains
  ADD  CONSTRAINT company_domains_verification_method_check
  CHECK (
    verification_method IS NULL
    OR verification_method IN ('dns','http','admin_override')
  );
