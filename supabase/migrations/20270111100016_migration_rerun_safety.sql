-- Migration re-run safety — the lease reaper can never mark a claimed row
-- 'failed' again, whichever reaper body is installed.
--
-- THE HAZARD
--   20261231000005 replaced reap_community_ai_action_leases() so that a lapsed
--   claim (DISPATCH_LEASE_EXPIRED), a lapsed in-flight command
--   (DISPATCH_LEASE_EXPIRED_IN_FLIGHT) and an executing timeout
--   (EXECUTING_TIMEOUT) become 'uncertain': the action MAY have been performed,
--   so the row is terminal, reviewed by a person and never executed again.
--   The legacy bodies of the same function (20260522, 20260523, 20260524,
--   20260525 and 20260713_fix_reap_lease_returning.sql) mark those rows
--   'failed' and clear the lease. Those files are frozen production history
--   (scripts/migrations/historical-baseline.txt) and cannot be edited. Re-running
--   any of them — or the explicitly acknowledged restore in
--   rollbacks/extension_dispatch_safety_rollback.sql — silently re-installs the
--   duplicate-send path: 'failed' reads as "not acted", and a deterministic
--   action id can revive the row to 'pending' and send the DM a second time.
--
-- THE FIX: a BEFORE UPDATE row trigger on community_ai_actions that CONVERTS
--   such a write. When an UPDATE would move a row to 'failed' carrying one of the
--   three reaper error codes (execution_result.error_code, or .error) AND the row
--   was claimed — status dispatched / acknowledged / executing, or any lease
--   column set — the row becomes 'uncertain' instead: the lease id, expiry,
--   holder and acknowledgement are KEPT (so the true claimant's late result can
--   still be authenticated by record_community_ai_late_dispatch_result), and
--   execution_result records may_have_acted = true, the prior status and the
--   prior execution_result, exactly as the 20261231000005 reaper writes them.
--
-- WHY CONVERT AND NOT REFUSE
--   A refusal would RAISE inside the reaper's UPDATE and abort the whole reaper
--   call: no phase would commit, the lease-clearing sweep would never run, every
--   cron tick would error while a single lapsed claim exists, and the lapsed
--   rows would sit in their claimed state, surfaced to nobody. Converting keeps
--   the reaper running and produces the exact safe outcome of 20261231000005.
--
-- WHAT IS NOT AFFECTED
--   * Every legitimate 'failed' write of the executor
--     (communityAiActionExecutorRuntime.ts / communityAiExecutionResultService.ts):
--     those carry may_have_acted = false outcomes with their own codes
--     (validation errors, APPROVAL_REQUIRED, PLAYBOOK_NOT_FOUND,
--     PLAYBOOK_REQUIRED, DM refusals, definite API refusals). No application code
--     writes the three reaper codes; only the reapers do.
--   * A 'failed' write on a row that was never claimed (no lease, not
--     dispatched / acknowledged / executing).
--   * A row that is already 'failed', and any non-'failed' transition.
--   * The installed 20261231000005 reaper, which already writes 'uncertain'.
--
-- Requires 20261231000002 (the status CHECK must allow 'uncertain', otherwise
-- every converted reap would error). Idempotent: CREATE OR REPLACE function and
-- trigger. Guarded by pre- and postconditions. NOT applied anywhere yet.
-- ROLLBACK: supabase/migrations/rollbacks/migration_rerun_safety_rollback.sql
-- (rolled back FIRST — see the order in that file).

-- ── Preconditions ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  IF to_regclass('public.community_ai_actions') IS NULL THEN
    RAISE EXCEPTION 'migration re-run safety: public.community_ai_actions is absent';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
         AND column_name IN ('status', 'execution_result', 'dispatch_lease_id',
                             'dispatch_lease_expires_at', 'dispatch_lease_holder_id',
                             'dispatch_acknowledged_at')) <> 6 THEN
    RAISE EXCEPTION 'migration re-run safety: community_ai_actions lacks a required column';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.community_ai_actions'::regclass
     AND c.conname  = 'community_ai_actions_status_check';
  IF v_def IS NULL OR v_def NOT LIKE '%''uncertain''%' THEN
    RAISE EXCEPTION 'migration re-run safety: status CHECK does not allow ''uncertain'' (apply 20261231000002 first): %', v_def;
  END IF;
END
$$;

-- ── The guard ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_ai_actions_reap_uncertain_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'failed' OR OLD.status IS NOT DISTINCT FROM 'failed' THEN
    RETURN NEW;
  END IF;

  v_code := COALESCE(NEW.execution_result ->> 'error_code', NEW.execution_result ->> 'error');
  IF v_code IS NULL
     OR v_code NOT IN ('DISPATCH_LEASE_EXPIRED', 'DISPATCH_LEASE_EXPIRED_IN_FLIGHT', 'EXECUTING_TIMEOUT') THEN
    RETURN NEW;                                   -- an ordinary failure: untouched
  END IF;

  -- Only a row that was CLAIMED may have reached the platform.
  IF NOT (OLD.status IN ('dispatched', 'acknowledged', 'executing')
          OR OLD.dispatch_lease_id         IS NOT NULL
          OR OLD.dispatch_lease_expires_at IS NOT NULL
          OR OLD.dispatch_lease_holder_id  IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  NEW.status                    := 'uncertain';
  -- Keep the claim: the true claimant's late result is authenticated by it.
  NEW.dispatch_lease_id         := OLD.dispatch_lease_id;
  NEW.dispatch_lease_expires_at := OLD.dispatch_lease_expires_at;
  NEW.dispatch_lease_holder_id  := OLD.dispatch_lease_holder_id;
  NEW.dispatch_acknowledged_at  := OLD.dispatch_acknowledged_at;
  NEW.execution_result          := COALESCE(NEW.execution_result, '{}'::jsonb) || jsonb_build_object(
    'status',                 'uncertain',
    'error_code',             v_code,
    'error_message',          'A lease reaper marked this claimed action failed; it may have been performed. Converted to uncertain. Review required; never retried automatically.',
    'may_have_acted',         true,
    'prior_status',           OLD.status,
    'reaped_at',              NOW(),
    'prior_execution_result', OLD.execution_result,
    'converted_from_status',  'failed',
    'converted_by',           'community_ai_actions_reap_uncertain_guard'
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.community_ai_actions_reap_uncertain_guard() IS
  'migration_rerun_safety: converts a reaper write of failed (DISPATCH_LEASE_EXPIRED, DISPATCH_LEASE_EXPIRED_IN_FLIGHT, EXECUTING_TIMEOUT) on a claimed row into uncertain, keeping the lease, whichever reaper body is installed.';

-- CREATE OR REPLACE: a re-run never leaves a window without the guard.
CREATE OR REPLACE TRIGGER trg_community_ai_actions_reap_uncertain_guard
  BEFORE UPDATE ON public.community_ai_actions
  FOR EACH ROW
  WHEN (NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed')
  EXECUTE FUNCTION public.community_ai_actions_reap_uncertain_guard();

-- ── Privileges: nobody calls a trigger function directly ────────────────────
REVOKE EXECUTE ON FUNCTION public.community_ai_actions_reap_uncertain_guard() FROM PUBLIC, anon, authenticated;

-- ── Postconditions ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
  f     regprocedure := to_regprocedure('public.community_ai_actions_reap_uncertain_guard()');
BEGIN
  IF f IS NULL THEN
    RAISE EXCEPTION 'migration re-run safety postcondition: the guard function is absent';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = f;
  IF v_src NOT LIKE '%''DISPATCH_LEASE_EXPIRED''%'
     OR v_src NOT LIKE '%''DISPATCH_LEASE_EXPIRED_IN_FLIGHT''%'
     OR v_src NOT LIKE '%''EXECUTING_TIMEOUT''%'
     OR v_src NOT LIKE '%NEW.status                    := ''uncertain''%'
     OR v_src NOT LIKE '%NEW.dispatch_lease_id         := OLD.dispatch_lease_id%'
     OR v_src NOT LIKE '%''may_have_acted'',         true%' THEN
    RAISE EXCEPTION 'migration re-run safety postcondition: the guard body is not the uncertain-converting version';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'migration re-run safety postcondition: the guard must be SECURITY INVOKER';
  END IF;
  -- Present, enabled, BEFORE, ROW, UPDATE (tgtype bits: ROW=1, BEFORE=2, UPDATE=16).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.community_ai_actions'::regclass
       AND t.tgname  = 'trg_community_ai_actions_reap_uncertain_guard'
       AND NOT t.tgisinternal
       AND t.tgenabled IN ('O', 'A')
       AND t.tgfoid  = f
       AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16
  ) THEN
    RAISE EXCEPTION 'migration re-run safety postcondition: trg_community_ai_actions_reap_uncertain_guard is missing, disabled or not BEFORE UPDATE FOR EACH ROW';
  END IF;
  IF has_function_privilege('public', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'migration re-run safety postcondition: PUBLIC can execute the guard';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'migration re-run safety postcondition: anon can execute the guard';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'migration re-run safety postcondition: authenticated can execute the guard';
  END IF;
END
$$;
