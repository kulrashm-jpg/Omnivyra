-- Rollback for 20270128000003_message_content_retention.sql
--
-- Refuses while either table holds rows: notes would be lost, and approvals are the
-- only record of who authorised clearing what. Export them first.

DO $mcr_rollback$
DECLARE
  v_rows boolean;
BEGIN
  IF to_regclass('public.outreach_outcome_notes') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.outreach_outcome_notes)' INTO v_rows;
    IF v_rows THEN
      RAISE EXCEPTION 'outreach_outcome_notes has rows; export them before rolling back';
    END IF;
  END IF;
  IF to_regclass('public.message_retention_approvals') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.message_retention_approvals)' INTO v_rows;
    IF v_rows THEN
      RAISE EXCEPTION 'message_retention_approvals has rows; export them before rolling back';
    END IF;
  END IF;
END
$mcr_rollback$;

DROP TABLE IF EXISTS public.outreach_outcome_notes;
DROP TABLE IF EXISTS public.message_retention_approvals;
DROP FUNCTION IF EXISTS public.outreach_outcome_notes_guard();
DROP FUNCTION IF EXISTS public.message_retention_approvals_guard();
