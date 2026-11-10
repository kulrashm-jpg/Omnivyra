-- ROLLBACK for 20270201000005_pi_ldb_lead_intelligence_origin_category.sql
--
-- ############################################################################
-- #  DESTRUCTIVE ONCE ANY LEAD CARRIES AN ORIGIN CLASSIFICATION              #
-- ############################################################################
--
-- D2 made `origin_category` the AUTHORITATIVE durable classification for
-- scoring and journey presentation, not a cache. Dropping it is therefore not
-- the same shape of loss as dropping a derived column:
--
--   * for a prospect whose originating `prospect_source_contributions` row
--     still exists, the category could in principle be re-derived — but the
--     ACCEPTANCE TIME could not. `origin_observed_at` is when Omnivyra first
--     accepted the evidence, and nothing else in the schema records it;
--   * for a lead ingested through the adapter contract there is no contribution
--     to re-read at all, so for those the classification is gone for good.
--
-- A re-derivation is also not a safe default: the only values available to one
-- are the two display-source inferences in adapters.ts that the migration
-- exists to keep OUT of durable data. Re-deriving would manufacture exactly the
-- claims D2 forbids.
--
-- The script therefore REFUSES while any row carries a classification.
--
-- BEFORE RUNNING, measure what would be lost:
--
--   SELECT count(*) FROM public.lead_intelligence WHERE origin_category IS NOT NULL;
--   SELECT origin_category, count(*) FROM public.lead_intelligence
--    WHERE origin_category IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
--   SELECT count(*) FROM public.lead_intelligence WHERE origin_observed_at IS NOT NULL;
--
-- If any count is non-zero, export those rows deliberately before proceeding.
-- Do not edit that decision into this file.
--
-- Scoring consequence worth stating plainly: every lead that held
-- `inbound_form` loses its +15 `lead_captured` contribution and its "Converted
-- / Lead captured" journey step, and a 15-point swing crosses the stage
-- thresholds in buyingIntent.ts. Removing this column CHANGES SCORES. It does
-- so in the fail-closed direction, which is the safe one, but it is not a
-- no-op.
--
-- Nothing else about `lead_intelligence` is touched: no row is deleted, and
-- `dedupe_key`, `identity`, `scores`, `attribution`, `display` and `metadata`
-- are all left exactly as they were.

BEGIN;

DO $guard$
DECLARE
  v_classified bigint;
  v_observed   bigint;
BEGIN
  IF to_regclass('public.lead_intelligence') IS NULL THEN
    RAISE NOTICE 'lead_intelligence is absent; nothing to roll back.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_classified FROM public.lead_intelligence WHERE origin_category IS NOT NULL;
  SELECT count(*) INTO v_observed   FROM public.lead_intelligence WHERE origin_observed_at IS NOT NULL;

  IF v_classified > 0 OR v_observed > 0 THEN
    RAISE EXCEPTION
      'REFUSING: % row(s) carry an origin_category and % carry an origin_observed_at. Dropping these columns would discard the authoritative classification and the only record of when it was accepted. Export them first, then re-run.',
      v_classified, v_observed;
  END IF;
END
$guard$;

-- Order matters: the trigger references the columns, so it goes first.
DROP TRIGGER IF EXISTS trg_lead_intelligence_origin_evidence ON public.lead_intelligence;
DROP FUNCTION IF EXISTS public.lead_intelligence_origin_evidence();

DROP INDEX IF EXISTS public.idx_lead_intelligence_company_origin_category;

ALTER TABLE public.lead_intelligence
  DROP CONSTRAINT IF EXISTS lead_intelligence_origin_observed_needs_category;
ALTER TABLE public.lead_intelligence
  DROP CONSTRAINT IF EXISTS lead_intelligence_origin_category_valid;

ALTER TABLE public.lead_intelligence DROP COLUMN IF EXISTS origin_observed_at;
ALTER TABLE public.lead_intelligence DROP COLUMN IF EXISTS origin_category;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'lead_intelligence'
                AND column_name IN ('origin_category', 'origin_observed_at')) THEN
    RAISE EXCEPTION 'rollback postcondition: an origin column survived the drop';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lead_intelligence_origin_evidence') THEN
    RAISE EXCEPTION 'rollback postcondition: the D3 trigger survived the drop';
  END IF;
  -- The identity key, and the columns an earlier migration added, are intact.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'lead_intelligence'
                    AND column_name = 'dedupe_key') THEN
    RAISE EXCEPTION 'rollback postcondition: dedupe_key is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'lead_intelligence'
                    AND column_name = 'display') THEN
    RAISE EXCEPTION 'rollback postcondition: display is missing — this rollback must not touch PI-LDB-4';
  END IF;
  RAISE NOTICE 'Rolled back PI-LDB 2F: origin columns, checks, index, trigger and function removed; dedupe_key and display intact.';
END
$verify$;

COMMIT;
