-- Orchestration (G-11) — a manual closure's reopen time is stamped by the DATABASE.
--
-- WHY. closed_at takes the column default now() (the database clock) while the service stamped
-- reopened_at with the APP clock (new Date().toISOString()). contact_enrolment_closures_reopen_complete
-- requires reopened_at >= closed_at, so whenever the app clock is behind the database clock by more
-- than the time between the close and the reopen, a legitimate company-admin reopen is refused
-- (23514, surfaced as 503 closure_unavailable). Measured on the sandbox (2026-11-08): the failing row
-- held closed_at 11:13:32.146627 (DB) and reopened_at 11:13:32.146 (app); an injected 1 s
-- app-behind-DB lag reproduces it every time. Production app servers and Supabase do not share a
-- clock, and their skew is not bounded by anything this table controls.
--
-- WHAT CHANGES. contact_enrolment_closures_guard() (20270127000004) is replaced with the same body
-- plus ONE assignment: on the reopen transition (OLD.reopened_at IS NULL, NEW.reopened_by set) the
-- trigger sets NEW.reopened_at := clock_timestamp(), whatever the writer sent. clock_timestamp(),
-- not now(): a reopen transaction that began before the close committed would otherwise carry a
-- now() earlier than closed_at. Both sides of the CHECK now come from the one database clock, so
-- the comparison no longer depends on any app clock. No clamp, no tolerance: the CHECK is unchanged.
-- Every other branch (the redaction flag, the historical-record refusal, reopen-once) is verbatim.
-- clock_timestamp() is VOLATILE: one statement that reopens several rows stamps each row slightly
-- differently. That is correct for a per-row trigger; never assert that rows reopened by ONE
-- statement share a reopened_at.
-- RE-STAMP DEPENDENCY: the assignment fires on ANY update that reaches it with reopened_by set. It
-- runs only on the FIRST reopen today because every other update of a reopened row leaves first:
-- the redaction path returns before it (reopened_at pinned to OLD), an already-reopened row raises
-- 23514 before it, and the trigger is BEFORE UPDATE only. A future guard change that admits a later
-- update of a reopened row would silently re-stamp reopened_at; gate the assignment on
-- OLD.reopened_at IS NULL if that ever happens.
--
-- ORDER. Ships after 20270127000004 (it replaces that migration's guard) and needs no other G-11
-- migration. Version from the Orchestration block 20270129000000-09 (20270127* is full).
-- ORDER-INDEPENDENT of 20270127000008: 0008 re-makes contact_opt_out_reviews_guard, the
-- contact_opt_out_reviews CHECKs and the privileges on the review tables; this re-makes only
-- contact_enrolment_closures_guard. They share no function, table or constraint.
--
-- Unapplied anywhere. Rollback: rollbacks/contact_enrolment_closures_reopen_db_clock_rollback.sql.

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
  -- The reopen transition: the database, not the writer, says when it happened.
  IF NEW.reopened_by IS NOT NULL THEN
    NEW.reopened_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.contact_enrolment_closures_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_enrolment_closures_guard() FROM anon;
REVOKE ALL ON FUNCTION public.contact_enrolment_closures_guard() FROM authenticated;
