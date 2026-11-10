-- ROLLBACK — Orchestration (G-11): a manual closure's reopen time is stamped by the database.
-- Reverses supabase/migrations/20270129000003_contact_enrolment_closures_reopen_db_clock.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. contact_enrolment_closures_guard() returns to its 20270127000004 body (below,
-- verbatim), which takes reopened_at from the writer. Roll the APPLICATION back first or together:
-- the forward service no longer sends reopened_at, and without the stamp a reopen would violate
-- contact_enrolment_closures_reopen_complete (reopened_at NULL with reopened_by set).
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

CREATE OR REPLACE FUNCTION public.contact_enrolment_closures_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Set ONLY by g11_redact_enrolment_closure_reasons, transaction-local, cleared at its end.
  v_redact boolean := coalesce(current_setting('g11.redact_closure_reasons', true), '') = 'on';
BEGIN
  -- The one admitted change under the flag: the reasons become the placeholder, nothing else moves.
  IF v_redact
     AND NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.prospect_id IS NOT DISTINCT FROM OLD.prospect_id AND NEW.closed_by IS NOT DISTINCT FROM OLD.closed_by
     AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at AND NEW.reopened_by IS NOT DISTINCT FROM OLD.reopened_by
     AND NEW.reopened_at IS NOT DISTINCT FROM OLD.reopened_at
     AND NEW.close_reason = '[redacted: subject erased]'
     AND ((OLD.reopen_reason IS NULL AND NEW.reopen_reason IS NULL) OR NEW.reopen_reason = '[redacted: subject erased]') THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id
     OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.close_reason IS DISTINCT FROM OLD.close_reason THEN
    RAISE EXCEPTION 'contact_enrolment_closures: closure % is a historical record; only a reopen is recorded on it', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF OLD.reopened_at IS NOT NULL THEN
    RAISE EXCEPTION 'contact_enrolment_closures: closure % is already reopened; a new close is a new row', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.contact_enrolment_closures_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_enrolment_closures_guard() FROM anon;
REVOKE ALL ON FUNCTION public.contact_enrolment_closures_guard() FROM authenticated;

COMMIT;
