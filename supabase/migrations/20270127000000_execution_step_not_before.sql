-- Orchestration (Prompt 4, RV-1 / Q-4) — a person-supplied "not before" on a journey step.
--
-- WHY. A journey suspended for a person (an unclassified reply, a revoked approval) may be
-- resumed with a structured return date ("back on the 30th"). The retiming engine
-- (backend/services/orchestration/journeyRetiming.ts) turns that date into the first
-- permitted moment; this column holds it, and both clocks honour it:
--   advance_execution_plan  a pending step is not made ready before `not_before`;
--   the sweeper             a ready step is deferred until `not_before`.
--
-- RULES, enforced here and not only in the application:
--   * nullable, absent by default: every existing step and every existing schedule is
--     unchanged (`now() >= anchor + delay` still holds; not_before only adds a later floor);
--   * it may only move LATER: a write that lowers or clears it is refused (greatest(), never a
--     replacement), so it can never make a step earlier than its existing schedule;
--   * a newly written value may not be in the past;
--   * only a pending or ready step may carry a new one: a settled step is history.
-- Human-supplied only: the one writer is the operator resume (PATCH /api/execution-instances/:id
-- with a return date). No classifier path writes it.
--
-- NO grant, policy or RLS change: execution_plan_steps keeps exactly the privileges and
-- policies it had (the real-schema test compares them before and after). Forward only;
-- rollback in rollbacks/execution_step_not_before_rollback.sql.

ALTER TABLE public.execution_plan_steps
  ADD COLUMN IF NOT EXISTS not_before timestamptz;

COMMENT ON COLUMN public.execution_plan_steps.not_before IS
  'Orchestration: a person-supplied floor on when this step may act (operator resume with a return date). Only ever moves later; null = no floor.';

CREATE OR REPLACE FUNCTION public.execution_plan_steps_not_before_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.not_before IS NOT DISTINCT FROM OLD.not_before THEN
    RETURN NEW;
  END IF;
  IF OLD.state NOT IN ('pending', 'ready') THEN
    RAISE EXCEPTION 'execution_plan_steps: step % is % — a settled or running step takes no new not_before', OLD.id, OLD.state
      USING ERRCODE = '23514';
  END IF;
  IF NEW.not_before IS NULL OR (OLD.not_before IS NOT NULL AND NEW.not_before < OLD.not_before) THEN
    RAISE EXCEPTION 'execution_plan_steps: not_before of step % may only move later', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.not_before < now() THEN
    RAISE EXCEPTION 'execution_plan_steps: not_before of step % may not be in the past', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.execution_plan_steps_not_before_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execution_plan_steps_not_before_guard() FROM anon;
REVOKE ALL ON FUNCTION public.execution_plan_steps_not_before_guard() FROM authenticated;

DROP TRIGGER IF EXISTS trg_execution_plan_steps_not_before_guard ON public.execution_plan_steps;
CREATE TRIGGER trg_execution_plan_steps_not_before_guard
  BEFORE UPDATE OF not_before ON public.execution_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.execution_plan_steps_not_before_guard();

-- An INSERT may not smuggle a floor in either: steps are materialized without one.
CREATE OR REPLACE FUNCTION public.execution_plan_steps_not_before_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.not_before IS NOT NULL THEN
    RAISE EXCEPTION 'execution_plan_steps: a step is materialized without not_before; only a person''s resume sets it'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.execution_plan_steps_not_before_insert_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execution_plan_steps_not_before_insert_guard() FROM anon;
REVOKE ALL ON FUNCTION public.execution_plan_steps_not_before_insert_guard() FROM authenticated;

DROP TRIGGER IF EXISTS trg_execution_plan_steps_not_before_insert_guard ON public.execution_plan_steps;
CREATE TRIGGER trg_execution_plan_steps_not_before_insert_guard
  BEFORE INSERT ON public.execution_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.execution_plan_steps_not_before_insert_guard();

-- advance_execution_plan, unchanged except the one later floor (marked 20270127000000).
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
    -- 20270127000000 — a person's later return date may only make the step LATER.
    EXIT WHEN v_step.not_before IS NOT NULL AND now() < v_step.not_before;

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

-- Postconditions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'execution_plan_steps' AND column_name = 'not_before') THEN
    RAISE EXCEPTION 'not_before postcondition: the column is missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.execution_plan_steps'::regclass
       AND tgname IN ('trg_execution_plan_steps_not_before_guard', 'trg_execution_plan_steps_not_before_insert_guard')) <> 2 THEN
    RAISE EXCEPTION 'not_before postcondition: the guards are missing';
  END IF;
  IF position('not_before' IN pg_get_functiondef('public.advance_execution_plan(uuid, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'not_before postcondition: advance_execution_plan does not honour not_before';
  END IF;
END
$$;
