-- ─────────────────────────────────────────────────────────────────────────────
-- Canonical-domain foundation — additive only.
--
-- Adds columns to company_domains that separate input_domain (what was typed)
-- from final_domain (where it actually resolves), capture the redirect chain,
-- and record verification provenance. The legacy `domain` column is preserved
-- so existing reads/writes keep working — a follow-up migration will deprecate
-- it once all writers are routed through saveDomainRecord().
--
-- Backward compatibility:
--   - `domain` column is unchanged (NOT NULL, UNIQUE).
--   - input_domain / final_domain are populated from `domain` for existing rows.
--   - verification_status defaults to 'verified' for existing rows so current
--     consumers that treat presence-in-table as "verified" keep working.
--   - All new columns are NULL/DEFAULT-tolerant for existing INSERTs that
--     do not yet know about them.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. New columns on company_domains -----------------------------------------

ALTER TABLE company_domains
  ADD COLUMN IF NOT EXISTS input_domain        TEXT,
  ADD COLUMN IF NOT EXISTS final_domain        TEXT,
  ADD COLUMN IF NOT EXISTS redirect_chain      JSONB,
  ADD COLUMN IF NOT EXISTS is_forwarding       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_status TEXT    NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS override_reason     TEXT,
  ADD COLUMN IF NOT EXISTS created_via         TEXT    NOT NULL DEFAULT 'user';

-- 2. ENUM-style CHECK constraints -------------------------------------------

ALTER TABLE company_domains
  DROP CONSTRAINT IF EXISTS company_domains_verification_status_check;
ALTER TABLE company_domains
  ADD  CONSTRAINT company_domains_verification_status_check
  CHECK (verification_status IN ('unverified','pending','verified','admin_override'));

ALTER TABLE company_domains
  DROP CONSTRAINT IF EXISTS company_domains_created_via_check;
ALTER TABLE company_domains
  ADD  CONSTRAINT company_domains_created_via_check
  CHECK (created_via IN ('user','admin','system'));

-- override_reason must be present when verification_status = 'admin_override'.
-- Enforced as a row-level CHECK so DB rejects malformed admin overrides even
-- if a future code path forgets to validate.
ALTER TABLE company_domains
  DROP CONSTRAINT IF EXISTS company_domains_override_reason_required;
ALTER TABLE company_domains
  ADD  CONSTRAINT company_domains_override_reason_required
  CHECK (
    verification_status <> 'admin_override'
    OR (override_reason IS NOT NULL AND length(trim(override_reason)) > 0)
  );

-- 3. Backfill ---------------------------------------------------------------
--    Existing rows: copy `domain` into both input_domain and final_domain,
--    mark them verified (current consumers treat them as such), attribute
--    creation to 'system' so they are visibly different from new user/admin
--    inserts. is_forwarding stays FALSE; redirect_chain stays NULL.

-- Re-runnable: gate the legacy-column-dependent UPDATE on the column still
-- existing. Migration 20260612 drops `domain` once all writers/readers have
-- moved to final_domain — re-applying this file after 20260612 must be a
-- no-op, not an error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'company_domains'
      AND column_name  = 'domain'
  ) THEN
    EXECUTE $upd$
      UPDATE company_domains
      SET    input_domain        = COALESCE(input_domain, domain),
             final_domain        = COALESCE(final_domain, domain),
             verification_status = CASE
                                     WHEN verification_status = 'unverified' THEN 'verified'
                                     ELSE verification_status
                                   END,
             created_via         = CASE
                                     WHEN created_via = 'user' AND domain IS NOT NULL THEN 'system'
                                     ELSE created_via
                                   END
      WHERE  input_domain IS NULL OR final_domain IS NULL
    $upd$;
  END IF;
END $$;

-- 4. Indexes for the new columns -------------------------------------------
--    No UNIQUE on final_domain yet — production data has not been re-resolved
--    and may contain duplicates that would block this migration. A follow-up
--    migration will add UNIQUE(final_domain) once resolveDomain has run for
--    every row.

CREATE INDEX IF NOT EXISTS idx_company_domains_input_domain
  ON company_domains (input_domain);

CREATE INDEX IF NOT EXISTS idx_company_domains_final_domain
  ON company_domains (final_domain);

CREATE INDEX IF NOT EXISTS idx_company_domains_verification_status
  ON company_domains (verification_status);

-- 5. Comments — document intent for future readers --------------------------

-- Re-runnable: only set the legacy-column comment if the column still exists.
-- 20260612 drops it; re-running this file after that must not error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'company_domains'
      AND column_name  = 'domain'
  ) THEN
    EXECUTE $cmt$
      COMMENT ON COLUMN company_domains.domain IS
        'LEGACY - kept for backward compatibility. New code should write input_domain '
        'and final_domain via saveDomainRecord(). Will be deprecated once all '
        'writers are migrated.'
    $cmt$;
  END IF;
END $$;
COMMENT ON COLUMN company_domains.input_domain IS
  'Domain as entered by the user/admin (post-normalization: lowercase, no protocol, no www).';
COMMENT ON COLUMN company_domains.final_domain IS
  'Canonical domain after redirect resolution. Equal to input_domain when no redirect occurred.';
COMMENT ON COLUMN company_domains.redirect_chain IS
  'Ordered JSONB array of hostnames traversed during redirect resolution. NULL if not yet resolved.';
COMMENT ON COLUMN company_domains.is_forwarding IS
  'TRUE when input_domain root differs from final_domain root.';
COMMENT ON COLUMN company_domains.verification_status IS
  'unverified | pending | verified | admin_override';
COMMENT ON COLUMN company_domains.override_reason IS
  'Required when verification_status = admin_override. Free-form rationale captured at override time.';
COMMENT ON COLUMN company_domains.created_via IS
  'user | admin | system — provenance of the row. Used to filter audit reports.';

COMMIT;
