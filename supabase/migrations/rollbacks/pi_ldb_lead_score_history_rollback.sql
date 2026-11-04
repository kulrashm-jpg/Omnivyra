-- ROLLBACK for 20270201000002_pi_ldb_lead_score_history.sql
--
-- ############################################################################
-- #  DESTRUCTIVE ONCE ANY SCORE HAS BEEN RECORDED                            #
-- ############################################################################
--
-- This table is the only record of why a prospect's score changed and what it
-- was before. `canonical_leads.qualification_score` holds the current value
-- alone, so dropping this table does not degrade the history — it erases it,
-- and nothing else in the schema can reconstruct it.
--
-- So this script REFUSES when any row exists.
--
-- BEFORE RUNNING, measure what would be lost:
--
--   SELECT count(*) FROM public.lead_score_history;
--   SELECT score_kind, count(*) FROM public.lead_score_history GROUP BY 1;
--
-- If that count is non-zero, export those rows deliberately before proceeding.
-- Do not edit that decision into this file.
--
-- ─── WHY THE GUARD READS THE TABLE BEFORE DROPPING IT ───────────────────────
-- `DROP TABLE` is not refused by the append-only triggers: they fire on row
-- DELETE, and a drop removes the relation without deleting rows one by one. The
-- guarantee the triggers give is therefore narrower than it looks, and this
-- explicit count is what actually stops an accidental rollback from discarding
-- a populated history.

BEGIN;

DO $guard$
DECLARE
  v_rows INT := 0;
BEGIN
  IF to_regclass('public.lead_score_history') IS NULL THEN
    RAISE NOTICE 'PI-LDB-3 rollback: nothing to do, lead_score_history does not exist.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_rows FROM public.lead_score_history;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'PI-LDB-3 rollback refused: % score history row(s) exist. canonical_leads holds only the current value, so this history cannot be reconstructed. Export it deliberately first.',
      v_rows;
  END IF;
END
$guard$;

-- The table takes its own triggers and indexes with it; the function does not
-- belong to it, so it is dropped separately.
DROP TABLE IF EXISTS public.lead_score_history;
DROP FUNCTION IF EXISTS public.trg_lead_score_history_append_only();

DO $verify$
BEGIN
  IF to_regclass('public.lead_score_history') IS NOT NULL THEN
    RAISE EXCEPTION 'PI-LDB-3 rollback postcondition: lead_score_history survived';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname = 'trg_lead_score_history_append_only') THEN
    RAISE EXCEPTION 'PI-LDB-3 rollback postcondition: the append-only trigger function survived';
  END IF;

  -- `canonical_leads` must be exactly as it was: this rollback touches no
  -- prospect and removes no existing constraint.
  IF to_regclass('public.canonical_leads') IS NULL THEN
    RAISE EXCEPTION 'PI-LDB-3 rollback postcondition: canonical_leads is missing';
  END IF;

  RAISE NOTICE 'PI-LDB-3 rollback: lead_score_history and its trigger function dropped; canonical_leads untouched.';
END
$verify$;

COMMIT;
