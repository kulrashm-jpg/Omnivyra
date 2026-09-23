-- ROLLBACK for 20261027000000_pi_wsf_governance_anchor_after_erasure.sql
--
-- Restores `contact_governance_has_anchor` to its LI-3B form: every row, live
-- or revoked, must name a person or a target.
--
-- ─── WHAT THIS COSTS ──────────────────────────────────────────────────────
-- It re-arms DEFECT-008. Any `unified_persons` row that has, or ever had, a
-- person-only governance record becomes undeletable again: the
-- `ON DELETE SET NULL (person_id)` update leaves the row unanchored, the CHECK
-- refuses it, and the DELETE aborts with 23514. Erasure of that person stops
-- working.
--
-- ─── IT CAN ALSO FAIL, AND THAT IS THE POINT ──────────────────────────────
-- `ALTER TABLE ... ADD CONSTRAINT ... CHECK` validates existing rows. If any
-- erasure has already run, revoked person-only rows with a nulled `person_id`
-- exist and the constraint will be REFUSED with 23514. That is correct: the
-- rows are legitimate append-only history and must not be deleted to make a
-- rollback succeed.
--
-- MEASURE FIRST. If this returns anything, the rollback cannot proceed without
-- destroying compliance history, and the answer is to stay on the migration:
--
--   SELECT id, organization_id, channel, governance_type, revoked_at, revoked_reason
--     FROM public.contact_governance_records
--    WHERE person_id IS NULL
--      AND (target_normalized IS NULL OR length(btrim(target_normalized)) = 0);
--
-- DO NOT "fix" that result by deleting or back-filling those rows. Deleting
-- governance is forbidden (ADR §16) and back-filling a target onto a record
-- revoked in the past fabricates history.

BEGIN;

DO $rollback$
DECLARE
  v_orphans BIGINT;
BEGIN
  SELECT count(*) INTO v_orphans
    FROM public.contact_governance_records
   WHERE person_id IS NULL
     AND (target_normalized IS NULL OR length(btrim(target_normalized)) = 0);

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'PI/WS-F rollback refused: % revoked, unanchored governance record(s) exist. '
      'Restoring the strict CHECK would require deleting compliance history. '
      'Run the SELECT in this file''s header and take the result to the ADR owner.',
      v_orphans;
  END IF;

  ALTER TABLE public.contact_governance_records
    DROP CONSTRAINT IF EXISTS contact_governance_has_anchor;

  ALTER TABLE public.contact_governance_records
    ADD CONSTRAINT contact_governance_has_anchor
    CHECK (person_id IS NOT NULL
           OR (target_normalized IS NOT NULL AND length(btrim(target_normalized)) > 0));
END
$rollback$;

COMMENT ON CONSTRAINT contact_governance_has_anchor ON public.contact_governance_records IS
  'LI-3B: a record anchored to nothing can never be matched, so it is never valid.';

COMMIT;
