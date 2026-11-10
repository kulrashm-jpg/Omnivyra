-- ROLLBACK for 20261231000009_migration_rerun_safety.sql
--
-- ROLLBACK ORDER for the 20261231 chain (verified on real PostgreSQL 2026-10-28):
--   0009 -> 0008 -> 0007 -> 0006 -> 0003 -> 0004 -> 0005 -> 0002 -> 0001 -> 0000
-- THIS FILE IS FIRST. Removing the guard is safe only while the installed lease
-- reaper is the 20261231000005 uncertain-outcome body.
--
-- Refuses (raises, changing nothing) when the installed
-- reap_community_ai_action_leases() still marks rows 'failed' (a legacy body
-- from 20260522..20260525 / 20260713, or the acknowledged restore in
-- extension_dispatch_safety_rollback.sql): without this guard that reaper turns a
-- claimed, possibly-performed action into "not acted" — the duplicate-send path.
-- Re-apply 20261231000005 first, or, accepting that risk explicitly, set in the
-- same transaction:
--   SET LOCAL omnivyra.migration_rerun_safety_drop_guard = 'i-accept-duplicate-send-risk';
--
-- 'uncertain' rows the guard produced are never rewritten.
-- Run inside a transaction; every refusal aborts it.

DO $$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.reap_community_ai_action_leases()');
  IF v_src IS NOT NULL
     AND v_src ~ 'status\s*=\s*''failed'''
     AND coalesce(current_setting('omnivyra.migration_rerun_safety_drop_guard', true), '')
           <> 'i-accept-duplicate-send-risk' THEN
    RAISE EXCEPTION 'migration re-run safety rollback refused: the installed lease reaper marks claimed rows failed; this guard is what keeps them uncertain. Re-apply 20261231000005 first';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_community_ai_actions_reap_uncertain_guard ON public.community_ai_actions;
DROP FUNCTION IF EXISTS public.community_ai_actions_reap_uncertain_guard();

-- Postcondition: the guard is gone.
DO $$
BEGIN
  IF to_regprocedure('public.community_ai_actions_reap_uncertain_guard()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgname = 'trg_community_ai_actions_reap_uncertain_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'migration re-run safety rollback postcondition: the guard remains';
  END IF;
END
$$;
