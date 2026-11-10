-- ===========================================================================
-- PI-036 — EXECUTION PLAN, PLAN STEPS, EXECUTION TASKS
--
-- The durable bridge between an Execution Instance and the Outreach boundary.
-- It executes nothing: it records what a run is going to execute, in a form that
-- survives the authored definition changing underneath it.
--
--   execution_instances (033, frozen)
--        ↓ 1:1
--   execution_plans            one durable snapshot per run
--        ↓ 1:N
--   execution_plan_steps       one per authored Workflow Version step
--        ↓ 1:1
--   execution_tasks            one prepared action per step
--        ↓
--   [Outreach — NOT in this migration]
--
-- ─── WHY THE PLAN SNAPSHOTS THE DEFINITION (J-2) ──────────────────────────
-- `workflow_versions.definition` is immutable at publication, so a reference
-- alone would survive. The snapshot exists for a different reason: a version can
-- be ARCHIVED, and a tenant can be offboarded, after which the run's own history
-- would answer nothing. `definition_snapshot` is therefore the frozen bytes this
-- run was built from, and `workflow_version_id` is kept beside it so provenance
-- stays checkable. Nothing mutable from Prospect Intelligence is copied in:
-- campaign, target, subject, ICP and score stay reachable through the Instance,
-- which 033 already froze.
--
-- ─── WHY THE PINNED VERSION, NEVER THE CURRENT ONE (J-1) ──────────────────
-- `create_execution_plan` reads `workflow_version_id` OFF THE INSTANCE. It never
-- resolves `status = 'published'`: that resolution already happened once, at
-- invocation, and repeating it here would silently re-point a historical run at
-- whatever was published later. The persona planner is not consulted at all —
-- `PERSONA_PLAYBOOKS` is not a workflow definition.
--
-- ─── WHY THE PLAN'S TENANT IS CHECKED BY A TRIGGER, NOT A COMPOSITE FK ────
-- Every other PI reference here is a tenant-safe composite FK
-- `(child_id, organization_id) → parent(id, organization_id)`, which makes a
-- cross-tenant row unrepresentable. The Plan's reference to the INSTANCE cannot
-- be: that shape needs a companion `(id, organization_id)` unique key on
-- `execution_instances`, and 033's own postcondition REFUSES any unconditional
-- composite unique index on that table — it would, by its reasoning, collapse
-- historical instances. Creating the companion key would therefore make 033's
-- frozen migration fail on replay.
--
-- So the Plan follows the precedent 033 set for its own polymorphic subject,
-- where a composite FK was equally impossible: the check lives in a trigger,
-- still in the database, never in application code. The single-column FK keeps
-- referential integrity; the trigger keeps tenant agreement.
--
-- ─── WHY A NEW TASK TABLE RATHER THAN EVOLVING `outreach_tasks` (J-4) ──────
-- Determined from repository evidence, not preference:
--   • SIX tables FK `outreach_tasks(id)` with ON DELETE RESTRICT — approvals,
--     attempts, decisions, delivery evidence, internal work items, outcomes.
--   • Its identity `(company_id, lead_id, plan_task_id)` is load-bearing for the
--     legacy materializer's idempotency, and `depends_on_plan_task_id` expresses
--     the step chain as that STRING rather than as a foreign key. Re-keying would
--     break the chain representation, not merely the constraint.
--   • 033's postcondition asserts that constraint is unchanged.
--   • Thirteen modules read or write the table, including the PI outcome corpus.
-- Evolving it would mean nullable run columns (legacy rows have none), so the new
-- identity could not be NOT NULL and database-enforced — which is the one thing
-- J-4 requires. A separate substrate keeps every dependent, the legacy contract
-- and 033's certification untouched, and lets the new identity be total.
-- `outreach_tasks` is NOT modified by this migration.
--
-- ─── WHAT THIS MIGRATION DOES NOT DO ──────────────────────────────────────
-- No scheduler, no branching, no conditions, no event waits, no business-day
-- timing, no message versioning, no provider, no transport, no dispatch, no
-- attempt, no outcome. Creating a task confers NO permission to contact anyone:
-- `mayContact` and `kill_switch → suppression → region → approval → rate_limit
-- → transport` remain authoritative and are untouched.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preconditions — fail loudly rather than build something half-anchored.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.execution_instances') IS NULL THEN
    RAISE EXCEPTION 'PI-036: execution_instances is missing — apply 20261228000000 first';
  END IF;
  IF to_regclass('public.workflow_versions') IS NULL THEN
    RAISE EXCEPTION 'PI-036: workflow_versions is missing — apply 20261227000000 first';
  END IF;
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PI-036: companies is missing';
  END IF;
  -- The companion (id, tenant) key the version reference resolves against. 032
  -- created it; a plain (id) FK would let a plan cite another tenant's version.
  IF to_regclass('public.uq_workflow_versions_id_org') IS NULL THEN
    RAISE EXCEPTION 'PI-036: uq_workflow_versions_id_org is missing — tenant-safe version references cannot be created';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. execution_plans — one durable snapshot per Execution Instance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.execution_plans (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL,

  -- 1:1 WITH THE RUN. The UNIQUE is the whole cardinality rule: a second plan
  -- for one instance is unrepresentable, not merely discouraged.
  execution_instance_id uuid        NOT NULL,

  -- The PINNED version this plan was built from, kept beside the bytes so the
  -- snapshot's provenance stays checkable.
  workflow_version_id   uuid        NOT NULL,

  -- The frozen authored definition. Immutable once written (trigger below).
  definition_snapshot   jsonb       NOT NULL,

  -- Materialized from the snapshot, so a reader can detect truncation without
  -- parsing jsonb. The creation function sets it; the guard freezes it.
  step_count            integer     NOT NULL,

  -- materializing → ready | failed. `ready` means EVERY step and task exists,
  -- which is why it is set last inside the same transaction.
  status                text        NOT NULL DEFAULT 'materializing',

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT execution_plans_status_valid
    CHECK (status IN ('materializing', 'ready', 'failed')),
  CONSTRAINT execution_plans_step_count_sane
    CHECK (step_count >= 0),
  CONSTRAINT execution_plans_snapshot_is_object
    CHECK (jsonb_typeof(definition_snapshot) = 'object'),
  CONSTRAINT execution_plans_snapshot_has_steps
    CHECK (jsonb_typeof(definition_snapshot -> 'steps') = 'array'),

  CONSTRAINT execution_plans_instance_unique
    UNIQUE (execution_instance_id),

  CONSTRAINT execution_plans_org_fk
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,

  -- Single-column by necessity, not by choice — see the header. Tenant agreement
  -- is enforced by execution_plans_guard().
  CONSTRAINT execution_plans_instance_fk
    FOREIGN KEY (execution_instance_id)
    REFERENCES public.execution_instances (id) ON DELETE NO ACTION,

  -- Tenant-safe: a plan cannot cite another tenant's version.
  CONSTRAINT execution_plans_version_fk
    FOREIGN KEY (workflow_version_id, organization_id)
    REFERENCES public.workflow_versions (id, organization_id) ON DELETE NO ACTION
);

-- The companion key this migration's OWN children resolve against.
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_plans_id_org
  ON public.execution_plans (id, organization_id);

CREATE INDEX IF NOT EXISTS ix_execution_plans_org_status
  ON public.execution_plans (organization_id, status);

ALTER TABLE public.execution_plans ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. execution_plan_steps — one per authored step, with run state.
-- ---------------------------------------------------------------------------
-- A Workflow Version step is a reusable authored INSTRUCTION. A plan step is one
-- run's immutable snapshot of it PLUS the state that run accumulates. Conflating
-- them would mean execution state living on an immutable authored row.
CREATE TABLE IF NOT EXISTS public.execution_plan_steps (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid        NOT NULL,
  plan_id                     uuid        NOT NULL,

  -- The authored key, durable WITHIN its version (032's contract). Combined with
  -- the plan it is this step's stable identity for the life of the run.
  step_key                    text        NOT NULL,
  step_order                  integer     NOT NULL,

  -- CHANNEL INTENT, from the authored definition. Deliberately NOT narrowed to
  -- the dispatchable transports: a plan may legitimately record a channel that
  -- cannot be sent yet. Narrowing here would silently rewrite authored intent.
  channel                     text        NOT NULL,

  -- Authoring text, personalization INSTRUCTIONS only, never data. This is NOT a
  -- message and claims no message identity — J-5 is deferred.
  instruction                 text,

  delay_after_previous_hours  numeric     NOT NULL,

  state                       text        NOT NULL DEFAULT 'pending',

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT execution_plan_steps_state_valid
    CHECK (state IN ('pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
  CONSTRAINT execution_plan_steps_order_positive
    CHECK (step_order >= 1),
  CONSTRAINT execution_plan_steps_delay_sane
    CHECK (delay_after_previous_hours >= 0 AND delay_after_previous_hours <= 2160),
  CONSTRAINT execution_plan_steps_key_shape
    CHECK (step_key ~ '^[A-Za-z0-9._-]{1,120}$'),
  CONSTRAINT execution_plan_steps_channel_not_blank
    CHECK (length(btrim(channel)) > 0),

  -- Stable identity within the plan, and a stable order within the plan.
  CONSTRAINT execution_plan_steps_key_unique
    UNIQUE (organization_id, plan_id, step_key),
  CONSTRAINT execution_plan_steps_order_unique
    UNIQUE (organization_id, plan_id, step_order),

  CONSTRAINT execution_plan_steps_org_fk
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT execution_plan_steps_plan_fk
    FOREIGN KEY (plan_id, organization_id)
    REFERENCES public.execution_plans (id, organization_id) ON DELETE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_plan_steps_id_org
  ON public.execution_plan_steps (id, organization_id);

CREATE INDEX IF NOT EXISTS ix_execution_plan_steps_plan_order
  ON public.execution_plan_steps (organization_id, plan_id, step_order);

ALTER TABLE public.execution_plan_steps ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. execution_tasks — one prepared action per plan step.
-- ---------------------------------------------------------------------------
-- THE IDENTITY J-4 REQUIRES. `UNIQUE (organization_id, plan_step_id)` carries the
-- run dimension transitively and totally: a step belongs to exactly one plan, a
-- plan to exactly one instance, so two runs can never share a task identity even
-- when subject, order and action are identical. Nothing resembling
-- `task-<order>-<slug>` appears anywhere — that key had no run dimension and
-- silently swallowed a second run as "already materialised".
--
-- `subject_kind` is a COLUMN, so a lead and a prospect whose opaque ids happen to
-- match can never collapse into one task.
CREATE TABLE IF NOT EXISTS public.execution_tasks (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid        NOT NULL,

  -- Denormalized for attribution, so Outreach can answer "which run?" without
  -- walking two parents. The guard proves it agrees with the step's plan.
  execution_instance_id       uuid        NOT NULL,
  plan_step_id                uuid        NOT NULL,

  subject_kind                text        NOT NULL,
  subject_id                  text        NOT NULL,

  channel                     text        NOT NULL,
  action                      text,
  delay_after_previous_hours  numeric     NOT NULL,

  -- Already-defined approval requirement, carried forward. It is a REQUIREMENT,
  -- never a grant: the approval gate still runs in Outreach.
  requires_approval           boolean     NOT NULL DEFAULT false,

  -- PREPARATION state only. Dispatch, attempts, delivery and outcomes belong to
  -- Outreach and are not represented here.
  state                       text        NOT NULL DEFAULT 'prepared',

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT execution_tasks_state_valid
    CHECK (state IN ('prepared', 'cancelled', 'failed')),
  CONSTRAINT execution_tasks_subject_kind_valid
    CHECK (subject_kind IN ('lead', 'prospect')),
  CONSTRAINT execution_tasks_subject_not_blank
    CHECK (length(btrim(subject_id)) > 0),
  CONSTRAINT execution_tasks_channel_not_blank
    CHECK (length(btrim(channel)) > 0),
  CONSTRAINT execution_tasks_delay_sane
    CHECK (delay_after_previous_hours >= 0),

  -- ONE task per plan step. Database-enforced, so a duplicate preparation is a
  -- constraint violation rather than an application decision.
  CONSTRAINT execution_tasks_step_unique
    UNIQUE (organization_id, plan_step_id),

  CONSTRAINT execution_tasks_org_fk
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT execution_tasks_step_fk
    FOREIGN KEY (plan_step_id, organization_id)
    REFERENCES public.execution_plan_steps (id, organization_id) ON DELETE NO ACTION,
  -- Single-column for the same reason the plan's is — see the header.
  CONSTRAINT execution_tasks_instance_fk
    FOREIGN KEY (execution_instance_id)
    REFERENCES public.execution_instances (id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS ix_execution_tasks_instance
  ON public.execution_tasks (organization_id, execution_instance_id);

CREATE INDEX IF NOT EXISTS ix_execution_tasks_subject
  ON public.execution_tasks (organization_id, subject_kind, subject_id);

ALTER TABLE public.execution_tasks ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Guards — snapshots freeze, state moves, tenants must agree.
-- ---------------------------------------------------------------------------
-- Narrow by design, exactly as 033's is: an unconditional UPDATE refusal would
-- make these tables useless, because state is the point.

CREATE OR REPLACE FUNCTION public.execution_plans_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  inst_org     uuid;
  inst_version uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- TENANT AGREEMENT, and agreement with the PINNED version. This is what the
    -- composite FK would have done had 033's postcondition permitted one.
    SELECT organization_id, workflow_version_id
      INTO inst_org, inst_version
      FROM public.execution_instances
     WHERE id = NEW.execution_instance_id;

    IF inst_org IS NULL THEN
      RAISE EXCEPTION 'execution_plans: instance % does not exist', NEW.execution_instance_id;
    END IF;
    IF inst_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION
        'execution_plans: instance % belongs to another tenant — a plan may never cross organizations',
        NEW.execution_instance_id;
    END IF;
    IF inst_version IS DISTINCT FROM NEW.workflow_version_id THEN
      RAISE EXCEPTION
        'execution_plans: plan cites version % but instance % pinned % — the pinned version is authoritative',
        NEW.workflow_version_id, NEW.execution_instance_id, inst_version;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id                    IS DISTINCT FROM OLD.id
  OR NEW.organization_id       IS DISTINCT FROM OLD.organization_id
  OR NEW.execution_instance_id IS DISTINCT FROM OLD.execution_instance_id
  OR NEW.workflow_version_id   IS DISTINCT FROM OLD.workflow_version_id
  OR NEW.definition_snapshot   IS DISTINCT FROM OLD.definition_snapshot
  OR NEW.step_count            IS DISTINCT FROM OLD.step_count
  OR NEW.created_at            IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'execution_plans: the snapshot and attribution of plan % are immutable — only status moves',
      OLD.id;
  END IF;

  -- A settled plan is settled. Re-materializing is not a status change.
  IF OLD.status IN ('ready', 'failed')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'execution_plans: plan % is already % — a settled plan cannot be re-opened',
      OLD.id, OLD.status;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_execution_plans_guard ON public.execution_plans;
CREATE TRIGGER trg_execution_plans_guard
  BEFORE INSERT OR UPDATE ON public.execution_plans
  FOR EACH ROW EXECUTE FUNCTION public.execution_plans_guard();

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

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_execution_plan_steps_guard ON public.execution_plan_steps;
CREATE TRIGGER trg_execution_plan_steps_guard
  BEFORE UPDATE ON public.execution_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.execution_plan_steps_guard();

CREATE OR REPLACE FUNCTION public.execution_tasks_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  step_instance uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The denormalized instance must be the step's plan's instance. Without this
    -- a task could claim a run it does not belong to, and every downstream
    -- attribution would be wrong.
    SELECT p.execution_instance_id INTO step_instance
      FROM public.execution_plan_steps s
      JOIN public.execution_plans p
        ON p.id = s.plan_id AND p.organization_id = s.organization_id
     WHERE s.id = NEW.plan_step_id AND s.organization_id = NEW.organization_id;

    IF step_instance IS NULL THEN
      RAISE EXCEPTION
        'execution_tasks: plan step % does not exist in this tenant', NEW.plan_step_id;
    END IF;
    IF step_instance IS DISTINCT FROM NEW.execution_instance_id THEN
      RAISE EXCEPTION
        'execution_tasks: task cites instance % but its step belongs to run % — attribution must agree',
        NEW.execution_instance_id, step_instance;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id                         IS DISTINCT FROM OLD.id
  OR NEW.organization_id            IS DISTINCT FROM OLD.organization_id
  OR NEW.execution_instance_id      IS DISTINCT FROM OLD.execution_instance_id
  OR NEW.plan_step_id               IS DISTINCT FROM OLD.plan_step_id
  OR NEW.subject_kind               IS DISTINCT FROM OLD.subject_kind
  OR NEW.subject_id                 IS DISTINCT FROM OLD.subject_id
  OR NEW.channel                    IS DISTINCT FROM OLD.channel
  OR NEW.action                     IS DISTINCT FROM OLD.action
  OR NEW.delay_after_previous_hours IS DISTINCT FROM OLD.delay_after_previous_hours
  OR NEW.requires_approval          IS DISTINCT FROM OLD.requires_approval
  OR NEW.created_at                 IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'execution_tasks: the identity and prepared content of task % are immutable — only state moves',
      OLD.id;
  END IF;

  IF OLD.state IN ('cancelled', 'failed')
     AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION
      'execution_tasks: task % is already % — a settled task cannot be re-opened',
      OLD.id, OLD.state;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_execution_tasks_guard ON public.execution_tasks;
CREATE TRIGGER trg_execution_tasks_guard
  BEFORE INSERT OR UPDATE ON public.execution_tasks
  FOR EACH ROW EXECUTE FUNCTION public.execution_tasks_guard();

-- ---------------------------------------------------------------------------
-- 5. create_execution_plan — the ONE atomic materialization.
-- ---------------------------------------------------------------------------
-- ATOMICITY (§16). Plan, every step and every task are written in ONE statement's
-- transaction, and `status` only becomes 'ready' after all of them exist. So a
-- failure anywhere rolls the whole structure back: there is no path that leaves a
-- plan claiming `ready` without its children, and none that leaves orphan steps.
-- The `ready` flip is deliberately the LAST act.
--
-- PLAN CREATION IS A SEPARATE TRANSITION, NOT PART OF INVOCATION. That is forced
-- by evidence, not chosen: 033's `create_execution_instance` is a frozen artefact,
-- so making planning synchronous with invocation would require editing it.
--
-- It takes only the tenant and the instance. There is deliberately no version
-- parameter: the pinned version is read off the instance, so no caller can
-- re-point a historical run.
CREATE OR REPLACE FUNCTION public.create_execution_plan(
  p_organization_id uuid,
  p_execution_instance_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_instance   record;
  v_definition jsonb;
  v_plan_id    uuid;
  v_steps      jsonb;
  v_step       jsonb;
  v_count      integer := 0;
  v_order      integer := 0;
  v_step_id    uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'ep_create:invalid_org';
  END IF;
  IF p_execution_instance_id IS NULL THEN
    RAISE EXCEPTION 'ep_create:invalid_instance';
  END IF;

  -- Lock the run: two concurrent materializations of one instance serialize here,
  -- and the loser then meets execution_plans_instance_unique.
  SELECT * INTO v_instance
    FROM public.execution_instances
   WHERE id = p_execution_instance_id
     AND organization_id = p_organization_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ep_create:instance_not_found';
  END IF;

  -- A settled run must not acquire a new plan: its history is closed.
  IF v_instance.lifecycle_state IN ('completed', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'ep_create:instance_terminal';
  END IF;

  -- THE PINNED VERSION. Never `status = 'published'`.
  SELECT definition INTO v_definition
    FROM public.workflow_versions
   WHERE id = v_instance.workflow_version_id
     AND organization_id = p_organization_id;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'ep_create:pinned_version_missing';
  END IF;

  v_steps := v_definition -> 'steps';
  IF v_steps IS NULL OR jsonb_typeof(v_steps) <> 'array' THEN
    RAISE EXCEPTION 'ep_create:definition_has_no_steps';
  END IF;
  v_count := jsonb_array_length(v_steps);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'ep_create:definition_has_no_steps';
  END IF;

  INSERT INTO public.execution_plans (
    organization_id, execution_instance_id, workflow_version_id,
    definition_snapshot, step_count, status
  ) VALUES (
    p_organization_id, p_execution_instance_id, v_instance.workflow_version_id,
    v_definition, v_count, 'materializing'
  ) RETURNING id INTO v_plan_id;

  FOR v_step IN SELECT jsonb_array_elements(v_steps)
  LOOP
    v_order := v_order + 1;

    INSERT INTO public.execution_plan_steps (
      organization_id, plan_id, step_key, step_order, channel, instruction,
      delay_after_previous_hours, state
    ) VALUES (
      p_organization_id,
      v_plan_id,
      v_step ->> 'key',
      v_order,
      v_step ->> 'channel',
      v_step ->> 'instruction',
      COALESCE((v_step ->> 'delay_after_previous_hours')::numeric, 0),
      'pending'
    ) RETURNING id INTO v_step_id;

    -- ONE task per step. Preparation only: nothing is scheduled or dispatched,
    -- and `requires_approval` defaults false because the authored definition
    -- carries no approval vocabulary yet — the approval GATE still runs in
    -- Outreach regardless of this flag.
    INSERT INTO public.execution_tasks (
      organization_id, execution_instance_id, plan_step_id,
      subject_kind, subject_id, channel, action,
      delay_after_previous_hours, state
    ) VALUES (
      p_organization_id,
      p_execution_instance_id,
      v_step_id,
      v_instance.subject_kind,
      v_instance.subject_id,
      v_step ->> 'channel',
      v_step ->> 'instruction',
      COALESCE((v_step ->> 'delay_after_previous_hours')::numeric, 0),
      'prepared'
    );
  END LOOP;

  IF v_order <> v_count THEN
    RAISE EXCEPTION 'ep_create:partial_materialization';
  END IF;

  -- LAST: the plan becomes ready only once every child exists.
  UPDATE public.execution_plans AS ep
     SET status = 'ready'
   WHERE ep.id = v_plan_id;

  RETURN v_plan_id;
END $$;

REVOKE ALL ON FUNCTION public.create_execution_plan(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_execution_plan(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_execution_plan(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_execution_plan(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Postconditions — assert the contract, not the code.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
  v text;
  -- `v` with `--` comments removed. Every word ban below reads THIS, never `v`:
  -- `pg_get_functiondef` returns the body's comments too, and the function's own
  -- comment explaining that it never re-resolves a published version would
  -- otherwise trip the ban that checks exactly that. The `n` flag keeps `.` from
  -- crossing line boundaries, so each comment is cut at its own end of line.
  v_code text;
BEGIN
  -- 1:1 cardinality must be database-enforced.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_plans'::regclass
       AND conname = 'execution_plans_instance_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'PI-036 postcondition: execution_plans_instance_unique is missing — a run could acquire two plans';
  END IF;

  -- Task identity must carry the run dimension.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_tasks'::regclass
       AND conname = 'execution_tasks_step_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'PI-036 postcondition: execution_tasks_step_unique is missing — task identity is unenforced';
  END IF;

  -- The legacy unsafe key must NOT have been reproduced here.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'execution_tasks'
       AND column_name IN ('plan_task_id', 'lead_id')
  ) THEN
    RAISE EXCEPTION 'PI-036 postcondition: execution_tasks reproduces the legacy plan_task_id/lead_id identity';
  END IF;

  -- subject_kind must be a column, so lead and prospect cannot collapse.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'execution_tasks'
       AND column_name = 'subject_kind'
  ) THEN
    RAISE EXCEPTION 'PI-036 postcondition: execution_tasks has no subject_kind — lead and prospect could collapse';
  END IF;

  -- No dispatch, delivery or provider column may exist on the execution layer:
  -- those belong to Outreach.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('execution_plans', 'execution_plan_steps', 'execution_tasks')
     AND column_name IN ('provider', 'provider_message_id', 'transport', 'attempt_number',
                         'delivery_status', 'sent_at', 'delivered_at', 'scheduled_at',
                         'message_id', 'message_version_id');
  IF n > 0 THEN
    RAISE EXCEPTION 'PI-036 postcondition: % dispatch/delivery/message column(s) leaked into the execution layer', n;
  END IF;

  -- The creation function must read the PINNED version, never re-resolve.
  SELECT pg_get_functiondef(p.oid) INTO v
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'create_execution_plan';
  IF v IS NULL THEN
    RAISE EXCEPTION 'PI-036 postcondition: create_execution_plan is missing';
  END IF;
  v_code := regexp_replace(v, '--.*', '', 'gn');

  IF v_code NOT LIKE '%v_instance.workflow_version_id%' THEN
    RAISE EXCEPTION 'PI-036 postcondition: create_execution_plan does not read the instance pinned version';
  END IF;
  IF v_code LIKE '%published%' THEN
    RAISE EXCEPTION 'PI-036 postcondition: create_execution_plan re-resolves a published version — the pin would be bypassed';
  END IF;
  IF v_code LIKE '%PERSONA_PLAYBOOK%' OR v_code LIKE '%persona%' THEN
    RAISE EXCEPTION 'PI-036 postcondition: create_execution_plan consults the persona planner — the Workflow Version is authoritative';
  END IF;
  -- Paired positive: the stripping above must not have emptied the body, or every
  -- ban would pass vacuously.
  IF length(v_code) < 400 OR v_code NOT LIKE '%execution_plan_steps%' THEN
    RAISE EXCEPTION 'PI-036 postcondition: the function body could not be read for inspection';
  END IF;

  -- The ready flip must come after the children, so a partial plan cannot claim
  -- readiness. Asserted by ORDER inside the function body.
  IF position('INSERT INTO public.execution_tasks' in v_code) > position('SET status = ''ready''' in v_code) THEN
    RAISE EXCEPTION 'PI-036 postcondition: the plan is marked ready before its tasks are written';
  END IF;

  -- Three guards present.
  SELECT count(*) INTO n FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('trg_execution_plans_guard', 'trg_execution_plan_steps_guard',
                    'trg_execution_tasks_guard');
  IF n <> 3 THEN
    RAISE EXCEPTION 'PI-036 postcondition: % of 3 guards present', n;
  END IF;

  -- RLS on all three.
  SELECT count(*) INTO n FROM pg_class
   WHERE relname IN ('execution_plans', 'execution_plan_steps', 'execution_tasks')
     AND relrowsecurity;
  IF n <> 3 THEN
    RAISE EXCEPTION 'PI-036 postcondition: RLS enabled on % of 3 tables', n;
  END IF;

  -- 033 AND THE LEGACY SUBSTRATE MUST BE UNTOUCHED.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.outreach_tasks'::regclass
       AND conname = 'outreach_tasks_identity_unique'
  ) THEN
    RAISE EXCEPTION 'PI-036 postcondition: outreach_tasks_identity_unique was altered — the legacy substrate must stay isolated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uq_execution_instances_active'
  ) THEN
    RAISE EXCEPTION 'PI-036 postcondition: 033 active uniqueness is missing';
  END IF;
  -- And 036 must NOT have added the companion key that would break 033's own
  -- postcondition. This is the shape the header explains.
  IF EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.execution_instances'::regclass
       AND i.indisunique AND i.indpred IS NULL
       AND (SELECT count(*) FROM unnest(i.indkey)) > 1
  ) THEN
    RAISE EXCEPTION 'PI-036 postcondition: an unconditional composite unique key was added to execution_instances — 033 would fail on replay';
  END IF;
END $$;
