-- ===========================================================================
-- PI-037 — WORKFLOW EXECUTION ENGINE: step lifecycle and relative-delay readiness
--
-- 036 left prepared tasks and a step state column with no transition graph and no
-- timing. 037 adds the three things the Workflow layer needs to progress a run:
--
--   1. WHEN a step becomes eligible  — relative delay, anchored on the previous
--      step settling (or on the run's start, for the first step).
--   2. WHICH transitions are legal   — a graph, enforced in the database.
--   3. HOW the run progresses        — one idempotent, concurrency-safe advance.
--
-- It dispatches nothing. Readiness is not permission and not delivery.
--
-- ─── WHAT IS ADDED, AND WHY EACH COLUMN EXISTS ────────────────────────────
-- Four timestamps on `execution_plan_steps`, each a FACT about one transition,
-- immutable once written:
--
--   ready_at      when the step became eligible. Audits the scheduler's decision.
--   started_at    when work began (state `running`). Optional observation.
--   settled_at    when the step reached ANY settled state. THE PROGRESSION ANCHOR.
--   completed_at  set ONLY on `completed`.
--
-- `settled_at` and `completed_at` are deliberately separate. A skip advances the
-- chain (owner-ratified), so it must anchor the next step — but a skip must never
-- be readable as success. Two columns keep "the chain moved on" and "the work
-- actually happened" from collapsing into one fact.
--
-- ─── THE READINESS RULE (§6) ──────────────────────────────────────────────
--   step 1 : anchor = plan.created_at            — the run's start
--   step N : anchor = step N-1 `settled_at`, and only when that step
--            `completed` or was `skipped`
--   eligible when  now() >= anchor + delay_after_previous_hours hours
--
-- The first step anchors on the run start rather than ignoring its authored
-- delay: with the ordinary delay of 0 that IS "immediately eligible", and a
-- non-zero authored delay becomes a start lag instead of being silently
-- discarded. Owner-ratified.
--
-- A `failed` or `cancelled` predecessor anchors nothing: the chain stops there.
-- Nothing in this migration continues past a failure.
--
-- NO timezone, calendar, business day, cron, absolute schedule, recurrence or
-- event wait. The whole vocabulary is the authored relative delay, read from the
-- PLAN's frozen snapshot — never from the mutable Workflow Version, so a later
-- publication cannot retime a run already under way.
--
-- ─── THE TRANSITION GRAPH (§5) ────────────────────────────────────────────
--   pending  → ready | skipped | cancelled
--   ready    → running | completed | skipped | cancelled
--   running  → completed | failed | cancelled
--   terminal → nothing
--
-- `ready → completed` is allowed WITHOUT passing through `running`, because
-- `running` is an optional observation: an executing layer that never reports a
-- start should still be able to report an outcome. 036's certified behaviour
-- relies on exactly that path, and inventing a stricter graph would have
-- invalidated a frozen test rather than described reality.
--
-- Refused, each for a reason: `pending → running` (nothing may start before it is
-- eligible), `pending → completed` and `pending → failed` (work that never became
-- eligible cannot have an outcome), `ready → failed` (failure means executed and
-- failed, which requires a start), `running → skipped` (work already began), and
-- every reopening of a settled step.
--
-- ─── WHAT 037 DOES NOT DECIDE ─────────────────────────────────────────────
-- Completion is ALWAYS caller-asserted. This engine never infers that a step
-- completed because its task was materialized — 036 materialized every task up
-- front, so inferring completion from that would fabricate success for work that
-- never ran. The executing layer reports outcomes; this layer only decides what
-- is eligible and what follows what.
--
-- No branching, no conditions, no retries. Whole-run retry remains a NEW
-- Execution Instance; provider retry remains Outreach's `outreach_attempts`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preconditions.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.execution_plan_steps') IS NULL
  OR to_regclass('public.execution_plans') IS NULL
  OR to_regclass('public.execution_tasks') IS NULL THEN
    RAISE EXCEPTION 'PI-037: the 036 execution layer is missing — apply 20261228000001 first';
  END IF;
  IF to_regclass('public.execution_instances') IS NULL THEN
    RAISE EXCEPTION 'PI-037: execution_instances is missing — apply 20261228000000 first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Timing facts.
-- ---------------------------------------------------------------------------
ALTER TABLE public.execution_plan_steps
  ADD COLUMN IF NOT EXISTS ready_at     timestamptz,
  ADD COLUMN IF NOT EXISTS started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS settled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

DO $$
BEGIN
  -- A settled state must carry its settle time, and only `completed` may carry a
  -- completion time. This is what stops a skip from being readable as success.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_plan_steps'::regclass
       AND conname = 'execution_plan_steps_settled_coherent'
  ) THEN
    ALTER TABLE public.execution_plan_steps
      ADD CONSTRAINT execution_plan_steps_settled_coherent CHECK (
        (state IN ('completed', 'failed', 'skipped', 'cancelled')) = (settled_at IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_plan_steps'::regclass
       AND conname = 'execution_plan_steps_completed_coherent'
  ) THEN
    ALTER TABLE public.execution_plan_steps
      ADD CONSTRAINT execution_plan_steps_completed_coherent CHECK (
        (state = 'completed') = (completed_at IS NOT NULL)
      );
  END IF;
END $$;

-- The scheduler's working set: pending steps, cheapest to find by plan and order.
CREATE INDEX IF NOT EXISTS ix_execution_plan_steps_pending
  ON public.execution_plan_steps (organization_id, plan_id, step_order)
  WHERE state = 'pending';

-- ---------------------------------------------------------------------------
-- 2. The guard, superseding 036's.
-- ---------------------------------------------------------------------------
-- Everything 036 enforced is kept verbatim: the authored snapshot stays immutable
-- and a settled step cannot be reopened. 037 adds the transition graph and makes
-- the four timestamps write-once, set by the transition itself rather than by the
-- caller — a caller-supplied `settled_at` could otherwise forge an anchor and
-- retime every later step.
CREATE OR REPLACE FUNCTION public.execution_plan_steps_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id                         IS DISTINCT FROM OLD.id
  OR NEW.organization_id            IS DISTINCT FROM OLD.organization_id
  OR NEW.plan_id                    IS DISTINCT FROM OLD.plan_id
  OR NEW.step_key                   IS DISTINCT FROM OLD.step_key
  OR NEW.step_order                 IS DISTINCT FROM OLD.step_order
  OR NEW.channel                    IS DISTINCT FROM OLD.channel
  OR NEW.instruction                IS DISTINCT FROM OLD.instruction
  OR NEW.delay_after_previous_hours IS DISTINCT FROM OLD.delay_after_previous_hours
  OR NEW.created_at                 IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'execution_plan_steps: the authored snapshot of step % is immutable — only state moves',
      OLD.id;
  END IF;

  IF OLD.state IN ('completed', 'failed', 'skipped', 'cancelled')
     AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION
      'execution_plan_steps: step % is already % — a settled step cannot be re-opened',
      OLD.id, OLD.state;
  END IF;

  -- PI-037 — the transition graph.
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT (
         (OLD.state = 'pending' AND NEW.state IN ('ready', 'skipped', 'cancelled'))
      OR (OLD.state = 'ready'   AND NEW.state IN ('running', 'completed', 'skipped', 'cancelled'))
      OR (OLD.state = 'running' AND NEW.state IN ('completed', 'failed', 'cancelled'))
    ) THEN
      RAISE EXCEPTION
        'execution_plan_steps: step % cannot move from % to % — that transition has no execution meaning',
        OLD.id, OLD.state, NEW.state;
    END IF;
  END IF;

  -- PI-037 — the timestamps are write-once and belong to the transition.
  IF OLD.ready_at     IS NOT NULL AND NEW.ready_at     IS DISTINCT FROM OLD.ready_at
  OR OLD.started_at   IS NOT NULL AND NEW.started_at   IS DISTINCT FROM OLD.started_at
  OR OLD.settled_at   IS NOT NULL AND NEW.settled_at   IS DISTINCT FROM OLD.settled_at
  OR OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION
      'execution_plan_steps: the execution timestamps of step % are write-once', OLD.id;
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state = 'ready'   AND NEW.ready_at   IS NULL THEN NEW.ready_at   := now(); END IF;
    IF NEW.state = 'running' AND NEW.started_at IS NULL THEN NEW.started_at := now(); END IF;
    IF NEW.state IN ('completed', 'failed', 'skipped', 'cancelled')
       AND NEW.settled_at IS NULL THEN
      NEW.settled_at := now();
    END IF;
    IF NEW.state = 'completed' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Readiness, as a view of state — not a stored derivation.
-- ---------------------------------------------------------------------------
-- `ready_at` records WHEN a step was made ready; it is never the input to that
-- decision. The decision is recomputed from facts every time, so no derived
-- column can drift out of agreement with the steps it was derived from.
CREATE OR REPLACE FUNCTION public.execution_step_anchor(
  p_organization_id uuid,
  p_step_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_step  record;
  v_prev  record;
  v_plan  record;
BEGIN
  SELECT * INTO v_step FROM public.execution_plan_steps
   WHERE id = p_step_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_plan FROM public.execution_plans
   WHERE id = v_step.plan_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_step.step_order = 1 THEN
    -- No predecessor: the run's own start is the anchor.
    RETURN v_plan.created_at;
  END IF;

  SELECT * INTO v_prev FROM public.execution_plan_steps
   WHERE organization_id = p_organization_id
     AND plan_id = v_step.plan_id
     AND step_order = v_step.step_order - 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Only a step that COMPLETED or was SKIPPED advances the chain. A failed or
  -- cancelled predecessor anchors nothing, which is what stops progression.
  IF v_prev.state NOT IN ('completed', 'skipped') THEN
    RETURN NULL;
  END IF;
  RETURN v_prev.settled_at;
END $$;

REVOKE ALL ON FUNCTION public.execution_step_anchor(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execution_step_anchor(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.execution_step_anchor(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.execution_step_anchor(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. advance_execution_plan — the one progression operation.
-- ---------------------------------------------------------------------------
-- IDEMPOTENT AND CONCURRENCY-SAFE.
--   • It locks the Execution Instance row, so two workers advancing one run
--     serialize rather than racing.
--   • The readiness UPDATE is CONDITIONAL on `state = 'pending'`, so a second
--     worker's update matches zero rows instead of re-deciding. There is no
--     read-then-write anywhere in this function.
--   • Running it twice converges: the same state, the same timestamps, no extra
--     step made ready, no task created, no history rewritten.
--
-- It creates NOTHING. 036 materialized every step and task up front, so progression
-- only moves state. It dispatches nothing and contacts nobody.
--
-- Returns the number of steps it made ready (0 when nothing was due).
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

-- ---------------------------------------------------------------------------
-- 5. cancel_execution_run — Workflow-side coherence only.
-- ---------------------------------------------------------------------------
-- Cancelling a run must not leave steps and tasks claiming they are still live.
-- This cancels the Workflow-side records and NOTHING ELSE: no provider is told, no
-- in-flight delivery is recalled, no Outreach attempt is touched. A cancelled task
-- is never readable as a completed step — the states are disjoint.
CREATE OR REPLACE FUNCTION public.cancel_execution_run(
  p_organization_id uuid,
  p_execution_instance_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_instance record;
  v_plan_id  uuid;
  v_steps    integer := 0;
BEGIN
  SELECT * INTO v_instance
    FROM public.execution_instances
   WHERE id = p_execution_instance_id AND organization_id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ea_cancel:instance_not_found';
  END IF;
  IF v_instance.lifecycle_state IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'ea_cancel:instance_terminal';
  END IF;

  SELECT id INTO v_plan_id FROM public.execution_plans
   WHERE execution_instance_id = p_execution_instance_id
     AND organization_id = p_organization_id;

  IF v_plan_id IS NOT NULL THEN
    WITH moved AS (
      UPDATE public.execution_plan_steps AS s
         SET state = 'cancelled'
       WHERE s.organization_id = p_organization_id
         AND s.plan_id = v_plan_id
         AND s.state IN ('pending', 'ready', 'running')
      RETURNING 1
    ) SELECT count(*) INTO v_steps FROM moved;

    UPDATE public.execution_tasks AS t
       SET state = 'cancelled'
     WHERE t.organization_id = p_organization_id
       AND t.execution_instance_id = p_execution_instance_id
       AND t.state = 'prepared';
  END IF;

  UPDATE public.execution_instances AS ei
     SET lifecycle_state = 'cancelled'
   WHERE ei.id = p_execution_instance_id
     AND ei.lifecycle_state IN ('created', 'queued', 'active', 'paused');

  RETURN v_steps;
END $$;

REVOKE ALL ON FUNCTION public.cancel_execution_run(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_execution_run(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_execution_run(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_execution_run(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Postconditions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
  v text;
  v_code text;
BEGIN
  -- The four timing facts exist.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'execution_plan_steps'
     AND column_name IN ('ready_at', 'started_at', 'settled_at', 'completed_at');
  IF n <> 4 THEN
    RAISE EXCEPTION 'PI-037 postcondition: % of 4 timing columns present', n;
  END IF;

  -- Skip must not be readable as success.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_plan_steps'::regclass
       AND conname = 'execution_plan_steps_completed_coherent'
  ) THEN
    RAISE EXCEPTION 'PI-037 postcondition: completed_at is not tied to the completed state — a skip could read as success';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_plan_steps'::regclass
       AND conname = 'execution_plan_steps_settled_coherent'
  ) THEN
    RAISE EXCEPTION 'PI-037 postcondition: settled_at is not tied to the settled states — the progression anchor would be unreliable';
  END IF;

  -- The graph is enforced in the database.
  SELECT pg_get_functiondef(p.oid) INTO v
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'execution_plan_steps_guard';
  IF v IS NULL THEN
    RAISE EXCEPTION 'PI-037 postcondition: the step guard is missing';
  END IF;
  v_code := regexp_replace(v, '--.*', '', 'gn');
  IF v_code NOT LIKE '%has no execution meaning%' THEN
    RAISE EXCEPTION 'PI-037 postcondition: the step guard enforces no transition graph';
  END IF;
  -- 036's two guarantees must survive the replacement.
  IF v_code NOT LIKE '%is immutable%' OR v_code NOT LIKE '%cannot be re-opened%' THEN
    RAISE EXCEPTION 'PI-037 postcondition: the step guard lost a 036 guarantee';
  END IF;

  -- The advance function must read the PLAN snapshot's delay, never the version.
  SELECT pg_get_functiondef(p.oid) INTO v
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'advance_execution_plan';
  IF v IS NULL THEN
    RAISE EXCEPTION 'PI-037 postcondition: advance_execution_plan is missing';
  END IF;
  v_code := regexp_replace(v, '--.*', '', 'gn');
  IF v_code NOT LIKE '%delay_after_previous_hours%' THEN
    RAISE EXCEPTION 'PI-037 postcondition: advancement does not use the snapshot delay';
  END IF;
  IF v_code LIKE '%workflow_versions%' THEN
    RAISE EXCEPTION 'PI-037 postcondition: advancement reads the mutable Workflow Version — a later publication could retime a live run';
  END IF;
  -- It must create nothing: 036 materialized everything up front.
  IF v_code LIKE '%INSERT INTO%' THEN
    RAISE EXCEPTION 'PI-037 postcondition: advancement inserts rows — progression must only move state';
  END IF;
  -- Concurrency must rest on a lock plus a conditional update.
  IF v_code NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'PI-037 postcondition: advancement does not lock the run';
  END IF;
  IF v_code NOT LIKE '%s.state = ''pending''%' THEN
    RAISE EXCEPTION 'PI-037 postcondition: the readiness update is not conditional on the pending state';
  END IF;
  -- No scheduling vocabulary beyond the relative delay.
  IF v_code LIKE '%timezone%' OR v_code LIKE '%AT TIME ZONE%' OR v_code LIKE '%business%'
     OR v_code LIKE '%cron%' THEN
    RAISE EXCEPTION 'PI-037 postcondition: absolute, calendar or cron scheduling leaked into advancement';
  END IF;
  -- Paired positive, so the bans above cannot pass on an unreadable body.
  IF length(v_code) < 600 OR v_code NOT LIKE '%execution_plan_steps%' THEN
    RAISE EXCEPTION 'PI-037 postcondition: the advance body could not be read for inspection';
  END IF;

  -- No dispatch, delivery or provider surface was added anywhere.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('execution_plans', 'execution_plan_steps', 'execution_tasks')
     AND column_name IN ('provider', 'provider_message_id', 'transport', 'attempt_number',
                         'delivery_status', 'sent_at', 'delivered_at', 'scheduled_at',
                         'message_id', 'message_version_id', 'run_at', 'cron_expression');
  IF n > 0 THEN
    RAISE EXCEPTION 'PI-037 postcondition: % dispatch/delivery/schedule column(s) leaked into the execution layer', n;
  END IF;

  -- 036's and 033's invariants, and the legacy substrate, are untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_plans'::regclass
       AND conname = 'execution_plans_instance_unique'
  ) THEN
    RAISE EXCEPTION 'PI-037 postcondition: 036 plan cardinality was altered';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_tasks'::regclass
       AND conname = 'execution_tasks_step_unique'
  ) THEN
    RAISE EXCEPTION 'PI-037 postcondition: 036 task identity was altered';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uq_execution_instances_active'
  ) THEN
    RAISE EXCEPTION 'PI-037 postcondition: 033 active uniqueness is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.outreach_tasks'::regclass
       AND conname = 'outreach_tasks_identity_unique'
  ) THEN
    RAISE EXCEPTION 'PI-037 postcondition: the legacy outreach_tasks identity was altered';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.execution_instances'::regclass
       AND i.indisunique AND i.indpred IS NULL
       AND (SELECT count(*) FROM unnest(i.indkey)) > 1
  ) THEN
    RAISE EXCEPTION 'PI-037 postcondition: an unconditional composite unique key was added to execution_instances — 033 would fail on replay';
  END IF;
END $$;
