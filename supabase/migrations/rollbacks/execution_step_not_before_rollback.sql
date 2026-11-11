-- ROLLBACK — Orchestration (Prompt 4): a person-supplied not_before on a journey step.
-- Reverses supabase/migrations/20270127000000_execution_step_not_before.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. Every recorded not_before is dropped with the column, so a step a person
-- deferred to a return date becomes eligible on its original schedule. Roll the application
-- back first (it selects and writes the column). advance_execution_plan is restored verbatim
-- from 20261228000002. No grant, policy or RLS is touched, as in the forward migration.
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

DROP TRIGGER IF EXISTS trg_execution_plan_steps_not_before_guard ON public.execution_plan_steps;
DROP TRIGGER IF EXISTS trg_execution_plan_steps_not_before_insert_guard ON public.execution_plan_steps;
DROP FUNCTION IF EXISTS public.execution_plan_steps_not_before_guard();
DROP FUNCTION IF EXISTS public.execution_plan_steps_not_before_insert_guard();

CREATE OR REPLACE FUNCTION public.advance_execution_plan(
  p_organization_id uuid,
  p_execution_instance_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_instance record;
  v_plan     record;
  v_step     record;
  v_anchor   timestamptz;
  v_made     integer := 0;
  v_total    integer;
  v_settled  integer;
  v_blocked  integer;
BEGIN
  IF p_organization_id IS NULL OR p_execution_instance_id IS NULL THEN
    RAISE EXCEPTION 'ea_advance:invalid_input';
  END IF;

  -- Serialize concurrent advancement of one run.
  SELECT * INTO v_instance
    FROM public.execution_instances
   WHERE id = p_execution_instance_id AND organization_id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ea_advance:instance_not_found';
  END IF;

  -- A paused run makes nothing newly eligible, and a terminal one is closed. Both
  -- are a quiet no-op rather than an error: an advance is a poll, not an assertion.
  IF v_instance.lifecycle_state NOT IN ('created', 'queued', 'active') THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_plan
    FROM public.execution_plans
   WHERE execution_instance_id = p_execution_instance_id
     AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ea_advance:no_plan';
  END IF;
  IF v_plan.status <> 'ready' THEN
    RAISE EXCEPTION 'ea_advance:plan_not_ready';
  END IF;

  -- Linear progression: the lowest-ordered pending step is the only candidate.
  -- No branching, so there is never more than one frontier.
  FOR v_step IN
    SELECT * FROM public.execution_plan_steps
     WHERE organization_id = p_organization_id
       AND plan_id = v_plan.id
       AND state = 'pending'
     ORDER BY step_order ASC
  LOOP
    v_anchor := public.execution_step_anchor(p_organization_id, v_step.id);
    EXIT WHEN v_anchor IS NULL;           -- predecessor not settled, or blocked
    EXIT WHEN now() < v_anchor
      + (v_step.delay_after_previous_hours * interval '1 hour');

    -- CONDITIONAL: whoever matches `state = 'pending'` wins; the loser updates
    -- nothing. This is the concurrency guarantee, not an application check.
    UPDATE public.execution_plan_steps AS s
       SET state = 'ready'
     WHERE s.id = v_step.id
       AND s.organization_id = p_organization_id
       AND s.state = 'pending';
    IF NOT FOUND THEN
      EXIT;                               -- another worker took it
    END IF;
    v_made := v_made + 1;
    -- Only one step may be made ready per pass: the next one's anchor cannot
    -- exist yet, because this one has not settled.
    EXIT;
  END LOOP;

  -- Instance progression, derived from step state. Minimal: begin when work is
  -- eligible, end when every step has settled.
  SELECT count(*),
         count(*) FILTER (WHERE state IN ('completed', 'failed', 'skipped', 'cancelled')),
         count(*) FILTER (WHERE state IN ('failed', 'cancelled'))
    INTO v_total, v_settled, v_blocked
    FROM public.execution_plan_steps
   WHERE organization_id = p_organization_id AND plan_id = v_plan.id;

  IF v_instance.lifecycle_state IN ('created', 'queued')
     AND EXISTS (
       SELECT 1 FROM public.execution_plan_steps
        WHERE organization_id = p_organization_id AND plan_id = v_plan.id
          AND state <> 'pending'
     ) THEN
    UPDATE public.execution_instances AS ei
       SET lifecycle_state = 'active'
     WHERE ei.id = p_execution_instance_id
       AND ei.lifecycle_state IN ('created', 'queued');
  ELSIF v_settled = v_total AND v_total > 0 THEN
    -- Every step has settled. A failed or cancelled step means the run did not
    -- succeed; otherwise it did. Neither reopens anything.
    UPDATE public.execution_instances AS ei
       SET lifecycle_state = CASE WHEN v_blocked > 0 THEN 'failed' ELSE 'completed' END
     WHERE ei.id = p_execution_instance_id
       AND ei.lifecycle_state IN ('created', 'queued', 'active');
  END IF;

  RETURN v_made;
END $$;

REVOKE ALL ON FUNCTION public.advance_execution_plan(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_execution_plan(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.advance_execution_plan(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.advance_execution_plan(uuid, uuid) TO service_role;

ALTER TABLE public.execution_plan_steps DROP COLUMN IF EXISTS not_before;

COMMIT;
