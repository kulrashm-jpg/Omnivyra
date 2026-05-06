-- Identity spine enforcement — Phase 2B / file 5 of 6
-- Replaces non-unique partial indexes on (company_id, primary_email) and
-- (company_id, primary_phone) with UNIQUE versions.
--
-- FIX D: phone unique index includes a LENGTH guard (>= 10 normalized digits)
--        so test-data short phones / placeholder fragments don't fight the
--        constraint. Real phones (E.164) are always >= 10 digits.
--
-- Must run AFTER backfill (file 3) and AFTER linking (file 4) so we know
-- there are no duplicates. If CREATE UNIQUE fails, run section D of
-- _identity_spine_phase2b/verification.sql to find the duplicate group,
-- patch file 3 / file 4, and retry.

DROP INDEX IF EXISTS public.idx_unified_persons_company_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unified_persons_company_email_unique
  ON public.unified_persons(company_id, primary_email)
  WHERE primary_email IS NOT NULL;

DROP INDEX IF EXISTS public.idx_unified_persons_company_phone;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unified_persons_company_phone_unique
  ON public.unified_persons(company_id, primary_phone)
  WHERE primary_phone IS NOT NULL
    AND LENGTH(primary_phone) >= 10;

-- GIN index on external_keys (FIX 5) — accelerates jsonb path lookups used by
-- file 4 enrichment + future identityResolutionService queries against
-- external_keys.contact_keys[] / external_keys.external_user_keys[].
CREATE INDEX IF NOT EXISTS idx_unified_persons_external_keys
  ON public.unified_persons USING GIN (external_keys);
