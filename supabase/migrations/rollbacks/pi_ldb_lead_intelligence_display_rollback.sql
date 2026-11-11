-- ROLLBACK for 20270211000003_pi_ldb_lead_intelligence_display.sql
--
-- ############################################################################
-- #  DESTRUCTIVE ONCE ANY LEAD CARRIES A DISPLAY LABEL                       #
-- ############################################################################
--
-- Dropping this column discards the stored name and job title for every lead
-- that has one. For a lead whose source row still exists the label could in
-- principle be re-derived by re-projecting that row — but for a lead ingested
-- through the adapter contract there IS no source row to re-read, because the
-- durable store is where the canonical lead lives. So for those, this is
-- permanent.
--
-- The script therefore REFUSES when any row carries a label.
--
-- BEFORE RUNNING, measure what would be lost:
--
--   SELECT count(*) FROM public.lead_intelligence WHERE display IS NOT NULL;
--   SELECT count(*) FROM public.lead_intelligence
--    WHERE display ->> 'name' IS NOT NULL OR display ->> 'title' IS NOT NULL;
--
-- If either count is non-zero, export those rows deliberately before
-- proceeding. Do not edit that decision into this file.
--
-- Nothing else about `lead_intelligence` is touched: no row is deleted, and
-- `dedupe_key`, `identity`, `scores`, `attribution` and `metadata` are all
-- left exactly as they were.

BEGIN;

DO $guard$
DECLARE
  v_rows INT := 0;
BEGIN
  IF to_regclass('public.lead_intelligence') IS NULL THEN
    RAISE NOTICE 'PI-LDB-4 rollback: nothing to do, lead_intelligence does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'lead_intelligence'
                    AND column_name = 'display') THEN
    RAISE NOTICE 'PI-LDB-4 rollback: nothing to do, the display column is absent.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_rows FROM public.lead_intelligence WHERE display IS NOT NULL;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'PI-LDB-4 rollback refused: % lead(s) carry a display label. For a lead ingested through the adapter contract there is no source row to re-derive it from. Export them deliberately first.',
      v_rows;
  END IF;
END
$guard$;

DROP INDEX IF EXISTS public.idx_lead_intelligence_display_name;

ALTER TABLE public.lead_intelligence
  DROP CONSTRAINT IF EXISTS lead_intelligence_display_is_object;

ALTER TABLE public.lead_intelligence
  DROP COLUMN IF EXISTS display;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'lead_intelligence'
                AND column_name = 'display') THEN
    RAISE EXCEPTION 'PI-LDB-4 rollback postcondition: the display column survived';
  END IF;

  -- What must still be there. A rollback that quietly took the store's identity
  -- key with it would be far worse than no rollback.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'lead_intelligence'
                    AND column_name = 'dedupe_key') THEN
    RAISE EXCEPTION 'PI-LDB-4 rollback postcondition: dedupe_key was removed';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'lead_intelligence'
         AND column_name IN ('identity', 'scores', 'attribution', 'metadata')) <> 4 THEN
    RAISE EXCEPTION 'PI-LDB-4 rollback postcondition: a core lead_intelligence column was removed';
  END IF;

  RAISE NOTICE 'PI-LDB-4 rollback: display column, shape check and name index removed; the rest of lead_intelligence intact.';
END
$verify$;

COMMIT;
