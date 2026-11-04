-- ROLLBACK for 20270201000000_pi_ldb_source_mapping_profiles.sql
--
-- ############################################################################
-- #  DESTRUCTIVE ONCE A TENANT HAS APPROVED A MAPPING                        #
-- ############################################################################
--
-- These tables hold decisions a HUMAN made: "our `Designation` column means
-- job title". That information exists nowhere else — it is not derivable from
-- the imported data, because once a mapping is applied the canonical column
-- holds the value and no longer records which source column it came from
-- (that is what PI-LDB-2 adds, and PI-LDB-2 references these rows).
--
-- So this script REFUSES rather than discarding. Dropping an approved profile
-- would mean every tenant is asked the same mapping questions again, and every
-- `source_assertions.mapping_profile_id` written by PI-LDB-2 would dangle.
--
-- BEFORE RUNNING, measure what would be lost:
--
--   SELECT count(*) FROM public.source_mapping_profiles;
--   SELECT count(*) FROM public.source_mapping_profile_entries;
--   SELECT count(*) FROM public.source_assertions WHERE mapping_profile_id IS NOT NULL;
--
-- If any count is non-zero, export those rows deliberately before proceeding.
-- Do not edit that decision into this file.
--
-- ─── ORDER ──────────────────────────────────────────────────────────────────
-- PI-LDB-2 adds a foreign key from `source_assertions` to these tables, so
-- that migration's rollback must run FIRST. This script checks for the
-- constraint rather than assuming, because running them out of order would
-- otherwise fail halfway with the entries table already gone.

BEGIN;

DO $guard$
DECLARE
  v_profiles INT := 0;
  v_entries  INT := 0;
BEGIN
  IF to_regclass('public.source_mapping_profiles') IS NULL THEN
    RAISE NOTICE 'PI-LDB-1 rollback: nothing to do, source_mapping_profiles does not exist.';
    RETURN;
  END IF;

  -- PI-LDB-2's foreign key must be gone first.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'source_assertions_mapping_profile_tenant_fk') THEN
    RAISE EXCEPTION
      'PI-LDB-1 rollback refused: source_assertions still references these profiles. Run pi_ldb_assertion_mapping_provenance_rollback.sql first.';
  END IF;

  SELECT count(*) INTO v_profiles FROM public.source_mapping_profiles;
  SELECT count(*) INTO v_entries  FROM public.source_mapping_profile_entries;

  IF v_profiles <> 0 OR v_entries <> 0 THEN
    RAISE EXCEPTION
      'PI-LDB-1 rollback refused: % profile(s) and % entry/entries hold tenant mapping decisions that exist nowhere else. Export them deliberately first.',
      v_profiles, v_entries;
  END IF;
END
$guard$;

-- Entries first: the composite tenant FK points at the profiles table.
DROP TABLE IF EXISTS public.source_mapping_profile_entries;
DROP TABLE IF EXISTS public.source_mapping_profiles;

DO $verify$
BEGIN
  IF to_regclass('public.source_mapping_profiles') IS NOT NULL
     OR to_regclass('public.source_mapping_profile_entries') IS NOT NULL THEN
    RAISE EXCEPTION 'PI-LDB-1 rollback postcondition: a mapping profile table survived';
  END IF;
  RAISE NOTICE 'PI-LDB-1 rollback: both mapping profile tables dropped.';
END
$verify$;

COMMIT;
