-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260501101239  Name: company_domains_verification_proof_columns
-- Idempotency: GUARDED (ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS).

-- Verifiable domain-ownership proof.
--
-- A user-flow row gets a per-domain `verification_token` at creation time.
-- The user proves ownership by publishing the token via:
--   A) DNS TXT record:  omnivira-verification=TOKEN
--   B) HTTP file:        https://<domain>/.well-known/omnivira.txt
--
-- POST /api/domain/verify checks both methods, marks the row 'verified', and
-- stamps verified_at + verification_method. Admin / system rows skip this
-- gate (verification_status='admin_override' OR pre-verified by the admin).

ALTER TABLE company_domains
  ADD COLUMN IF NOT EXISTS verification_token  TEXT,
  ADD COLUMN IF NOT EXISTS verification_method TEXT,
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ;

ALTER TABLE company_domains
  DROP CONSTRAINT IF EXISTS company_domains_verification_method_check;
ALTER TABLE company_domains
  ADD  CONSTRAINT company_domains_verification_method_check
  CHECK (
    verification_method IS NULL
    OR verification_method IN ('dns_txt','http_file','admin_override')
  );

COMMENT ON COLUMN company_domains.verification_token IS
  'Per-domain secret token. Published by the owner via DNS TXT or '
  '/.well-known/omnivira.txt to prove ownership. NULL for admin/system rows.';
COMMENT ON COLUMN company_domains.verification_method IS
  'Method that confirmed ownership: dns_txt | http_file | admin_override. '
  'NULL while verification_status != verified.';
COMMENT ON COLUMN company_domains.verified_at IS
  'Timestamp of successful verification. NULL while unverified.';
