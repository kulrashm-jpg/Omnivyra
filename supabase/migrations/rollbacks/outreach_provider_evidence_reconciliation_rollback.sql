-- Rollback for 20270125000005_outreach_provider_evidence_reconciliation.sql
--
-- Refuses while any debt is still open: dropping the table would erase the
-- only record that a restriction or durable evidence is missing. Resolve (or
-- export) the open rows first.

DO $opevr_rollback$
DECLARE
  v_open boolean;
BEGIN
  -- Dynamic, so a second run (table already gone) does not fail at planning.
  IF to_regclass('public.outreach_provider_evidence_reconciliation') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.outreach_provider_evidence_reconciliation WHERE status = ''open'')' INTO v_open;
    IF v_open THEN
      RAISE EXCEPTION 'outreach_provider_evidence_reconciliation has open rows; resolve or export them before rolling back';
    END IF;
  END IF;
END
$opevr_rollback$;

-- Dropping the table drops its trigger; DROP TRIGGER ... ON a missing table
-- would fail on a second run, so the rollback does not name it.
DROP TABLE IF EXISTS public.outreach_provider_evidence_reconciliation;
DROP FUNCTION IF EXISTS public.outreach_provider_evidence_reconciliation_guard();
