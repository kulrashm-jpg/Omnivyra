-- ROLLBACK for 20270211000001_pi_ldb_assertion_mapping_provenance.sql
--
-- ############################################################################
-- #  DESTRUCTIVE ONCE ANY ASSERTION CARRIES MAPPING PROVENANCE               #
-- ############################################################################
--
-- The forward migration added six nullable columns recording WHICH source
-- field fed each canonical attribute and which mapping decision sent it there.
-- Dropping them discards that link permanently: the assertion keeps its value
-- but loses the only record of where the value came from, which is exactly the
-- audit hole the forward migration closed.
--
-- So this script REFUSES when any row carries mapping provenance.
--
-- BEFORE RUNNING, measure what would be lost:
--
--   SELECT count(*) FROM public.source_assertions
--    WHERE source_field IS NOT NULL
--       OR mapping_profile_id IS NOT NULL
--       OR mapping_method IS NOT NULL
--       OR validation_state IS NOT NULL
--       OR approved_by IS NOT NULL;
--
-- If that count is non-zero, export those rows deliberately before proceeding.
-- Do not edit that decision into this file.
--
-- Everything else about `source_assertions` is untouched: no row is deleted,
-- and the LI-2 dedupe index, the five LI-2 composite tenant keys and the RLS
-- policy are all left exactly as they were.

BEGIN;

DO $guard$
DECLARE
  v_rows INT := 0;
BEGIN
  IF to_regclass('public.source_assertions') IS NULL THEN
    RAISE NOTICE 'PI-LDB-2 rollback: nothing to do, source_assertions does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'source_assertions'
                    AND column_name = 'source_field') THEN
    RAISE NOTICE 'PI-LDB-2 rollback: nothing to do, the mapping provenance columns are absent.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_rows FROM public.source_assertions
   WHERE source_field IS NOT NULL
      OR mapping_profile_id IS NOT NULL
      OR mapping_method IS NOT NULL
      OR validation_state IS NOT NULL
      OR approved_by IS NOT NULL
      OR platform_mapping_profile_id IS NOT NULL;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'PI-LDB-2 rollback refused: % assertion(s) carry mapping provenance. Dropping these columns would discard the only record of which source field produced each canonical value. Export them deliberately first.',
      v_rows;
  END IF;
END
$guard$;

-- Indexes. Dropped explicitly rather than relying on the column drop, so the
-- script states everything it removes.
DROP INDEX IF EXISTS public.idx_source_assertions_source_field;
DROP INDEX IF EXISTS public.idx_source_assertions_mapping_profile;
DROP INDEX IF EXISTS public.idx_source_assertions_unmapped;

-- Constraints, then the foreign key, then the columns.
ALTER TABLE public.source_assertions
  DROP CONSTRAINT IF EXISTS source_assertions_source_field_not_blank,
  DROP CONSTRAINT IF EXISTS source_assertions_mapping_method_valid,
  DROP CONSTRAINT IF EXISTS source_assertions_validation_state_valid,
  DROP CONSTRAINT IF EXISTS source_assertions_approval_coherent,
  DROP CONSTRAINT IF EXISTS source_assertions_invalid_not_applied,
  DROP CONSTRAINT IF EXISTS source_assertions_mapping_profile_tenant_fk,
  DROP CONSTRAINT IF EXISTS source_assertions_platform_mapping_profile_fk,
  DROP CONSTRAINT IF EXISTS source_assertions_platform_profile_scope,
  DROP CONSTRAINT IF EXISTS source_assertions_one_mapping_profile;

ALTER TABLE public.source_assertions
  DROP COLUMN IF EXISTS source_field,
  DROP COLUMN IF EXISTS mapping_profile_id,
  DROP COLUMN IF EXISTS mapping_method,
  DROP COLUMN IF EXISTS validation_state,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS platform_mapping_profile_id,
  DROP COLUMN IF EXISTS platform_mapping_profile_scope;

DO $verify$
DECLARE
  v_cols INT;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'source_assertions'
     AND column_name IN ('source_field', 'mapping_profile_id', 'mapping_method',
                         'validation_state', 'approved_by', 'approved_at',
                         'platform_mapping_profile_id', 'platform_mapping_profile_scope');
  IF v_cols <> 0 THEN
    RAISE EXCEPTION 'PI-LDB-2 rollback postcondition: % mapping provenance column(s) survived', v_cols;
  END IF;

  -- What must still be there. A rollback that quietly took the LI-2 guarantees
  -- with it would be worse than no rollback.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'uq_source_assertions_dedupe') THEN
    RAISE EXCEPTION 'PI-LDB-2 rollback postcondition: the LI-2 dedupe index was removed';
  END IF;

  -- Asserted BY NAME, not by count.
  --
  -- This was `count(*) ... <> 3`, and it broke: `origin/main` added a fourth
  -- composite tenant FK to this table (`source_assertions_relationship_tenant_fk`,
  -- 20261125000000), so after this rollback drops its own the count is 4 and the
  -- RAISE fired — a rollback that refused to run against the branch it has to
  -- merge into. A literal count over a table another track keeps extending is a
  -- postcondition that fails on someone else's correct work. The three FKs this
  -- rollback must not disturb are the three LI-2 ones, so it names them.
  IF (SELECT count(*) FROM pg_constraint con
        JOIN pg_class s ON s.oid = con.conrelid
       WHERE con.contype = 'f' AND s.relname = 'source_assertions'
         AND array_length(con.conkey, 1) = 2
         AND con.conname IN ('source_assertions_account_tenant_fk',
                             'source_assertions_person_tenant_fk',
                             'source_assertions_record_tenant_fk')) <> 3 THEN
    RAISE EXCEPTION 'PI-LDB-2 rollback postcondition: the 3 LI-2 composite tenant FKs are not intact';
  END IF;

  RAISE NOTICE 'PI-LDB-2 rollback: 6 columns, 5 checks, 1 FK and 3 indexes removed; LI-2 guarantees intact.';
END
$verify$;

COMMIT;
