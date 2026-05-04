-- ─────────────────────────────────────────────────────────────────────────────
-- Align the verification_method enum to the new wire labels: 'dns' / 'http'.
--
-- Previous CHECK (from 20260613) allowed 'dns_txt' / 'http_file'. No row was
-- ever written with those values (the verify endpoint hadn't been used in
-- production), so this is a constraint rename, not a data migration.
--
-- Index idx_company_domains_verification_status was already added by
-- 20260609 — no index work needed here.
--
-- Applied to live DB via mcp__supabase__apply_migration on 2026-05-01.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE company_domains
  DROP CONSTRAINT IF EXISTS company_domains_verification_method_check;
ALTER TABLE company_domains
  ADD  CONSTRAINT company_domains_verification_method_check
  CHECK (
    verification_method IS NULL
    OR verification_method IN ('dns','http','admin_override')
  );

COMMIT;
