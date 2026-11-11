-- ROLLBACK for 20270211000008_pi_ldb_origin_category_backfill.sql
--
-- WHAT IS RESTORED, AND FROM WHERE: a data migration is not reversible by DDL.
-- For every lead listed in public.pi_ldb_origin_backfill_snapshot whose
-- origin_category STILL equals what the backfill wrote, origin_category and
-- origin_observed_at are set back to NULL (the state the backfill found:
-- it wrote only where origin_category was NULL). A lead whose category has
-- since CHANGED (a later, genuine classification) is left alone and counted.
-- The snapshot is then dropped.
--
-- THE TRIGGER: 20270211000005's guard refuses to ERASE a stored category on an
-- ordinary write ("a write asserting no category cannot erase"). This rollback
-- disables that ONE trigger for its own statement inside one transaction and
-- re-enables it before COMMIT; the postcondition asserts it is enabled again.
-- Run only on the owner's instruction, with the dry-run count in hand.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.pi_ldb_origin_backfill_snapshot') IS NULL THEN
    RAISE NOTICE 'origin backfill rollback: no snapshot table; nothing to restore.';
  END IF;
END
$guard$;

ALTER TABLE public.lead_intelligence DISABLE TRIGGER trg_lead_intelligence_origin_evidence;

DO $restore$
DECLARE
  v_restored bigint := 0;
  v_changed  bigint := 0;
BEGIN
  IF to_regclass('public.pi_ldb_origin_backfill_snapshot') IS NOT NULL THEN
    UPDATE public.lead_intelligence li
       SET origin_category = NULL, origin_observed_at = NULL
      FROM public.pi_ldb_origin_backfill_snapshot s
     WHERE li.id = s.lead_intelligence_id AND li.origin_category = s.category;
    GET DIAGNOSTICS v_restored = ROW_COUNT;
    SELECT count(*) INTO v_changed
      FROM public.pi_ldb_origin_backfill_snapshot s
      JOIN public.lead_intelligence li ON li.id = s.lead_intelligence_id
     WHERE li.origin_category IS DISTINCT FROM s.category AND li.origin_category IS NOT NULL;
    RAISE NOTICE 'origin backfill rollback: % restored to NULL; % left alone (category changed since)', v_restored, v_changed;
  END IF;
END
$restore$;

ALTER TABLE public.lead_intelligence ENABLE TRIGGER trg_lead_intelligence_origin_evidence;

DROP TABLE IF EXISTS public.pi_ldb_origin_backfill_snapshot;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.lead_intelligence'::regclass
                  AND tgname = 'trg_lead_intelligence_origin_evidence' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'origin backfill rollback postcondition: trg_lead_intelligence_origin_evidence is not re-enabled';
  END IF;
END
$verify$;

COMMIT;
