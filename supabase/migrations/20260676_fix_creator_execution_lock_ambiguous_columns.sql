-- ============================================================
-- Fix: "column reference ... is ambiguous" in the creator
--      execution lock functions
-- ------------------------------------------------------------
-- `claim_creator_execution_lock` and `extend_creator_execution_lock`
-- (migration 20260422_creator_execution_reliability.sql) both declare
-- `RETURNS TABLE (... <name> ...)`. In PL/pgSQL those OUT column names
-- are in scope as variables inside the function body, so any UNqualified
-- reference to a same-named real column in the WHERE clause is ambiguous
-- and Postgres aborts with:
--   column reference "plan_version" is ambiguous
--   column reference "locked_by" is ambiguous   (extend, next failure)
--
-- Symptom: every BOLT Creator asset row failed permanently at
-- "Failed to claim creator execution lock: column reference
-- \"plan_version\" is ambiguous" — creator content never rendered even
-- when the row was correctly tagged intent_type='creator'.
--
-- Fix: table-qualify every colliding column in the WHERE clauses
-- (SET targets and the already-qualified RETURNING list were fine).
-- `CREATE OR REPLACE` is non-destructive — replaces the function body
-- in place, no rows touched, no signature change.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_creator_execution_lock(
  p_daily_plan_id UUID,
  p_lock_owner TEXT,
  p_expected_plan_version INTEGER,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  locked_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER,
  retry_count INTEGER,
  max_retries INTEGER,
  plan_version INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE daily_content_plans
     SET locked_by = p_lock_owner,
         lease_expires_at = now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 300), 900))),
         attempt_count = COALESCE(daily_content_plans.attempt_count, 0) + 1,
         updated_at = now()
   WHERE daily_content_plans.id = p_daily_plan_id
     AND daily_content_plans.plan_version = COALESCE(p_expected_plan_version, 1)
     AND (
       daily_content_plans.locked_by IS NULL
       OR daily_content_plans.lease_expires_at IS NULL
       OR daily_content_plans.lease_expires_at <= now()
       OR daily_content_plans.locked_by = p_lock_owner
     )
  RETURNING daily_content_plans.locked_by,
            daily_content_plans.lease_expires_at,
            daily_content_plans.attempt_count,
            daily_content_plans.retry_count,
            daily_content_plans.max_retries,
            daily_content_plans.plan_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.extend_creator_execution_lock(
  p_daily_plan_id UUID,
  p_lock_owner TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  locked_by TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE daily_content_plans
     SET lease_expires_at = now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 300), 900))),
         updated_at = now()
   WHERE daily_content_plans.id = p_daily_plan_id
     AND daily_content_plans.locked_by = p_lock_owner
     AND daily_content_plans.lease_expires_at IS NOT NULL
     AND daily_content_plans.lease_expires_at > now()
  RETURNING daily_content_plans.locked_by,
            daily_content_plans.lease_expires_at;
END;
$$;
