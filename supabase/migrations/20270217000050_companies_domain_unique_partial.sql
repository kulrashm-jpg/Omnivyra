-- 20270217000050 - companies domain uniqueness, ENFORCED (e1; e9 assignment 2026-11-13; version reserved by virality-83
-- in 024781de0; review: virality-05). PRE-LAUNCH defence in depth - the fail-closed claimed-domain gate (P2) is primary.
--
-- WHY. C93: prod has NO index on companies.website_domain or admin_email_domain. 20260322_domain_credit_hardening.sql
-- (admin_email_domain unique) never ran - a VERSION COLLISION (C96: the ledger holds one row per prefix, so of the 13
-- files at 20260322 only one executed). 20260713_auth001_signup_hardening.sql only RAISEd a WARNING on duplicates, so
-- its website_domain index was never guaranteed either. The app (setup-company's race handling) already assumes both.
--
-- WHAT. Two PARTIAL UNIQUE indexes, names reused from the app's existing expectations:
--   idx_companies_website_domain_unique     ON (lower(btrim(website_domain)))     WHERE deleted_at IS NULL AND non-empty
--   idx_companies_admin_email_domain_unique ON (lower(btrim(admin_email_domain))) WHERE deleted_at IS NULL AND non-empty
-- INACTIVE companies are INCLUDED (only deleted rows are excluded) - decided on C95 evidence + product rule: C95 shows all
-- 9 non-deleted companies with a domain are active, 0 inactive companies share a domain with an active one, 0 duplicate
-- admin domains - so the choice changes nothing today; and a suspended / inactive company still OWNS its domain (letting
-- another tenant register it would be a takeover path). The app's claim gate counts active companies only; a signup
-- racing an INACTIVE owner therefore hits 23505 here and is answered by the same CLAIMED_DOMAIN refusal (app mapping).
--
-- WHAT IS AND IS NOT ENFORCED (05, finding B): uniqueness is PER COLUMN. Company A with website_domain = x and company B
-- with admin_email_domain = x satisfies both indexes; "one company per domain across both columns" is NOT a DB
-- guarantee - the app's claimed-domain gate treats either column as claimed and remains that rule's enforcer.
-- CANONICAL FORM (05, finding A): CHECK constraints require each stored value to already equal lower(btrim(value)), so
-- the exact .eq() lookups every app path uses and the index expression coincide BY CONSTRUCTION (a stored
-- ' Example.COM ' would occupy example.com in the index while invisible to the gate - a dead end). Every writer already
-- stores trimmed lowercase domains (companyIdentityWriter / normalizeCompanyDomain, create-company, onboarding/complete).
-- The CHECK is also the POSITIVE CONTROL for that enumeration: a missed writer fails loudly (23514), and the app logs it
-- as company_domain_not_canonical_write naming the constraint and the writer.
-- PRE-COMMITTED RULE for 83's non-canonical count (05), so the answer selects a path rather than opening a question:
--   0 rows                      -> keep this all-rows CHECK (simplest, strongest);
--   only SOFT-DELETED rows      -> scope the CHECK to the index predicate (deleted_at IS NOT NULL OR value IS NULL OR
--                                  value = lower(btrim(value))) - no historical rewrite; a restore re-evaluates it;
--   any LIVE (non-deleted) rows -> normalise them first (owner-approved D-step): the gate cannot see them today.
--
-- LOCK. Plain CREATE UNIQUE INDEX (not CONCURRENTLY: the apply runner may wrap the file in one transaction, where
-- CONCURRENTLY is not allowed). companies is tiny (C95: 9 rows with a domain); the ACCESS-EXCLUSIVE window is negligible.

DO $preflight$
DECLARE
  v_n int;
  v_sample text;
  v_def text;
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION '050 preflight: public.companies does not exist';
  END IF;
  -- deleted_at comes from collided migration versions (C96): assert it, never assume it.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'deleted_at') THEN
    RAISE EXCEPTION '050 preflight: companies.deleted_at does not exist - the partial predicate cannot be built';
  END IF;
  -- 0 DUPLICATES or ABORT (never a WARNING - that is how 20260713's index silently never existed).
  SELECT count(*), string_agg(d, ', ') FILTER (WHERE rn <= 20) INTO v_n, v_sample FROM (
    SELECT lower(btrim(website_domain)) AS d, row_number() OVER (ORDER BY lower(btrim(website_domain))) AS rn
      FROM public.companies
     WHERE deleted_at IS NULL AND website_domain IS NOT NULL AND btrim(website_domain) <> ''
     GROUP BY 1 HAVING count(*) > 1) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION '050 preflight: % duplicated website_domain value(s) among non-deleted companies - resolve first (owner-approved D-step): %', v_n, v_sample;
  END IF;
  SELECT count(*), string_agg(d, ', ') FILTER (WHERE rn <= 20) INTO v_n, v_sample FROM (
    SELECT lower(btrim(admin_email_domain)) AS d, row_number() OVER (ORDER BY lower(btrim(admin_email_domain))) AS rn
      FROM public.companies
     WHERE deleted_at IS NULL AND admin_email_domain IS NOT NULL AND btrim(admin_email_domain) <> ''
     GROUP BY 1 HAVING count(*) > 1) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION '050 preflight: % duplicated admin_email_domain value(s) among non-deleted companies - resolve first (owner-approved D-step): %', v_n, v_sample;
  END IF;
  -- Canonical form or ABORT: the CHECK below validates EVERY row (deleted ones too).
  SELECT count(*) INTO v_n FROM public.companies
   WHERE (website_domain IS NOT NULL AND website_domain <> lower(btrim(website_domain)))
      OR (admin_email_domain IS NOT NULL AND admin_email_domain <> lower(btrim(admin_email_domain)));
  IF v_n > 0 THEN
    RAISE EXCEPTION '050 preflight: % companies row(s) hold a non-canonical domain (not lower(btrim(...))) - normalise first (owner-approved D-step)', v_n;
  END IF;
  -- A pre-existing index under either NAME must be exactly ours (re-run) - anything else is refused, not adopted.
  SELECT pg_get_indexdef(to_regclass('public.idx_companies_website_domain_unique')) INTO v_def;
  IF v_def IS NOT NULL AND v_def <> 'CREATE ' || 'UNIQUE INDEX idx_companies_website_domain_unique ON public.companies USING btree (lower(btrim(website_domain))) WHERE ((deleted_at IS NULL) AND (btrim(website_domain) <> ''''::text))' THEN
    RAISE EXCEPTION '050 preflight: idx_companies_website_domain_unique exists with another definition: %', v_def;
  END IF;
  SELECT pg_get_indexdef(to_regclass('public.idx_companies_admin_email_domain_unique')) INTO v_def;
  IF v_def IS NOT NULL AND v_def <> 'CREATE ' || 'UNIQUE INDEX idx_companies_admin_email_domain_unique ON public.companies USING btree (lower(btrim(admin_email_domain))) WHERE ((deleted_at IS NULL) AND (btrim(admin_email_domain) <> ''''::text))' THEN
    RAISE EXCEPTION '050 preflight: idx_companies_admin_email_domain_unique exists with another definition: %', v_def;
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_website_domain_unique
  ON public.companies (lower(btrim(website_domain)))
  WHERE deleted_at IS NULL AND btrim(website_domain) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_admin_email_domain_unique
  ON public.companies (lower(btrim(admin_email_domain)))
  WHERE deleted_at IS NULL AND btrim(admin_email_domain) <> '';

DO $canonical$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.companies'::regclass
                  AND conname = 'companies_website_domain_canonical') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_website_domain_canonical
      CHECK (website_domain IS NULL OR website_domain = lower(btrim(website_domain)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.companies'::regclass
                  AND conname = 'companies_admin_email_domain_canonical') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_admin_email_domain_canonical
      CHECK (admin_email_domain IS NULL OR admin_email_domain = lower(btrim(admin_email_domain)));
  END IF;
END
$canonical$;

-- POSTCONDITION (05/e9): each index EXISTS, is UNIQUE, VALID and READY, with exactly our definition - created is not
-- the same as present (C93/C96).
DO $verify$
DECLARE
  v_name text;
  v_ok boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['idx_companies_website_domain_unique', 'idx_companies_admin_email_domain_unique'] LOOP
    SELECT i.indisunique AND i.indisvalid AND i.indisready
      INTO v_ok
      FROM pg_index i
     WHERE i.indexrelid = to_regclass('public.' || v_name)
       AND i.indrelid = 'public.companies'::regclass;
    IF v_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION '050 postcondition: % is missing, not unique, or not valid/ready', v_name;
    END IF;
  END LOOP;
  IF pg_get_indexdef(to_regclass('public.idx_companies_website_domain_unique'))
       <> 'CREATE ' || 'UNIQUE INDEX idx_companies_website_domain_unique ON public.companies USING btree (lower(btrim(website_domain))) WHERE ((deleted_at IS NULL) AND (btrim(website_domain) <> ''''::text))'
     OR pg_get_indexdef(to_regclass('public.idx_companies_admin_email_domain_unique'))
       <> 'CREATE ' || 'UNIQUE INDEX idx_companies_admin_email_domain_unique ON public.companies USING btree (lower(btrim(admin_email_domain))) WHERE ((deleted_at IS NULL) AND (btrim(admin_email_domain) <> ''''::text))' THEN
    RAISE EXCEPTION '050 postcondition: a domain index has an unexpected definition';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.companies'::regclass AND contype = 'c' AND convalidated
         AND conname IN ('companies_website_domain_canonical', 'companies_admin_email_domain_canonical')) <> 2 THEN
    RAISE EXCEPTION '050 postcondition: the canonical-domain CHECK constraints are missing or not validated';
  END IF;
END
$verify$;

-- ROLLBACK: supabase/migrations/rollbacks/companies_domain_unique_partial_rollback.sql
