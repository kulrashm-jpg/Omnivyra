-- Orchestration (owner #12, step 7(a)): pin search_path on three trigger guard functions.
--
-- WHY. Every other Orchestration function pins `SET search_path = public, pg_temp`; these three did
-- not (MIG-2R finding 2):
--   public.execution_engine_requests_guard()      20270111100006_orchestration_engine_requests.sql
--                                                 (was 20261230000000 before GD-4)
--   public.prospect_campaigns_targeting_guard()   20270111100007_orchestration_campaign_targeting.sql
--   public.prospect_campaign_targets_guard()      (was 20261231000000 before GD-4)
-- They are SECURITY INVOKER trigger functions whose table references are already schema-qualified,
-- so the exposure is low; only built-ins and operators resolved through the caller's search_path.
-- Pinning it removes that dependence on the session.
--
-- WHAT CHANGES. ALTER FUNCTION ... SET search_path only. No body, owner, privilege, trigger or
-- policy change; service_role untouched. Each function is defined exactly once (no later CREATE OR
-- REPLACE would reset the setting; checked across git and the uncommitted worktrees, 2026-11-10).
--
-- REVIEW. These functions guard PI-consumed tables (prospect_campaigns, prospect_campaign_targets)
-- and the ledger; PI review by virality-05 before anything further (Master Architecture ruling 2).
-- The forward-fix-only ruling #11 covers the files these functions live in, so this is a new file.
--
-- ORDERING. Orchestration block 20270129000000-09 (version-reservations.json): after D-2 (0001),
-- E (0002) and G-11 B3 (0003). Rollback: rollbacks/guard_functions_search_path_rollback.sql.

ALTER FUNCTION public.execution_engine_requests_guard()    SET search_path = public, pg_temp;
ALTER FUNCTION public.prospect_campaigns_targeting_guard() SET search_path = public, pg_temp;
ALTER FUNCTION public.prospect_campaign_targets_guard()    SET search_path = public, pg_temp;

-- Postcondition: each function carries exactly this one setting, and nothing else changed about it.
DO $$
DECLARE
  f text;
  cfg text[];
  secdef boolean;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.execution_engine_requests_guard()',
    'public.prospect_campaigns_targeting_guard()',
    'public.prospect_campaign_targets_guard()'
  ] LOOP
    SELECT p.proconfig, p.prosecdef INTO cfg, secdef FROM pg_proc p WHERE p.oid = f::regprocedure;
    IF cfg IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
      RAISE EXCEPTION 'orchestration postcondition: % has proconfig %, expected {search_path=public, pg_temp}', f, cfg;
    END IF;
    IF secdef THEN
      RAISE EXCEPTION 'orchestration postcondition: % must stay SECURITY INVOKER', f;
    END IF;
  END LOOP;
END
$$;
