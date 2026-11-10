-- ===========================================================================
-- PI-040 — THE OUTREACH BRIDGE
--
-- The translation/handoff layer between the 036 execution substrate and the
-- EXISTING certified Outreach engine. It is not a second Outreach engine: it
-- creates one legacy task and one mapping row, atomically, and stops.
--
--   execution_tasks  (036, frozen)
--        ↓
--   outreach_bridge_handoffs      ← this migration; keyed by execution_task_id
--        ↓
--   outreach_tasks  (legacy, untouched)
--        ↓
--   existing engine: governance → approval → transport → attempts/evidence/outcomes
--
-- ─── WHY A REAL LEGACY ROW IS REQUIRED (D4-2) ─────────────────────────────
-- The existing engine is taskId-driven and database-backed end to end:
-- `dispatchInternalOutreachTask(companyId, taskId)` LOADS the task by id,
-- `listAttempts(companyId, taskId)` numbers attempts against it,
-- `evaluateTaskGovernance(companyId, taskId)` governs it, and six tables foreign
-- key `outreach_tasks(id)` ON DELETE RESTRICT. An in-memory translation cannot
-- reach any of that, so the bridge writes a real row and lets the certified
-- engine own every execution decision.
--
-- ─── WHAT THE LEGACY COLUMNS MEAN FOR A BRIDGED ROW ───────────────────────
--   lead_id       = the originating execution task's `subject_id`.
--                   `subject_kind` is NEVER encoded here and must never be
--                   inferred from it — the mapping below is the authority.
--                   This is safe because every governance, suppression and
--                   quota decision is PERSON-keyed (023), so `lead_id` carries
--                   no decision weight, and because `plan_task_id` alone makes
--                   the legacy identity tuple unique.
--   plan_task_id  = the `execution_task_id`. Globally unique and
--                   run-dimensioned, so two runs of one workflow for one subject
--                   can never collide — which is exactly what the old
--                   `task-<order>-<slug>` key could not do. Nothing is
--                   fabricated and no slug is minted. It is NOT the bridge
--                   identity: that remains `execution_task_id` in the mapping.
--   person_id     = the resolved canonical person. REQUIRED for a bridged row.
--
-- ─── IDENTITY-ONLY MAPPING, DELIBERATELY ──────────────────────────────────
-- No lifecycle column. The legacy task already owns execution state across 17
-- values, and a second `pending/sent/delivered` here would be the duplicate
-- lifecycle D1 forbids. Atomicity needs no marker either: both rows are written
-- in ONE statement's transaction, so there is no window in which one exists
-- without the other.
--
-- ─── WHAT THIS MIGRATION DOES NOT DO ──────────────────────────────────────
-- No channel engine, no provider, no transport, no dispatch, no attempt, no
-- evidence, no outcome, no message versioning. It confers NO permission to
-- contact anyone: `mayContact` and
-- `kill_switch → suppression → region → eligibility/approval → rate_limit →
-- transport` remain authoritative, untouched, and are evaluated by the existing
-- engine AFTER this handoff.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preconditions.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.execution_tasks') IS NULL
  OR to_regclass('public.execution_plan_steps') IS NULL
  OR to_regclass('public.execution_plans') IS NULL
  OR to_regclass('public.execution_instances') IS NULL THEN
    RAISE EXCEPTION 'PI-040: the 036 execution substrate is missing';
  END IF;
  IF to_regclass('public.outreach_tasks') IS NULL THEN
    RAISE EXCEPTION 'PI-040: the legacy outreach_tasks substrate is missing';
  END IF;
  IF to_regclass('public.unified_persons') IS NULL THEN
    RAISE EXCEPTION 'PI-040: unified_persons is missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The companion key 040-D explicitly authorized.
-- ---------------------------------------------------------------------------
-- 036 created `uq_execution_plans_id_org` and `uq_execution_plan_steps_id_org`
-- but not this one, so a tenant-safe composite reference to an execution task
-- was impossible. ADDITIVE ONLY: no execution-task semantics change. Note this
-- is `execution_tasks`, NOT `execution_instances` — 033's postcondition refuses
-- an unconditional composite unique key on that table and this does not touch it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_tasks_id_org
  ON public.execution_tasks (id, organization_id);

-- ---------------------------------------------------------------------------
-- 2. outreach_bridge_handoffs — identity only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_bridge_handoffs (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,

  -- THE BRIDGE IDENTITY. One handoff per execution task, enforced below.
  execution_task_id        uuid        NOT NULL,
  -- The legacy task this handoff produced.
  outreach_task_id         uuid        NOT NULL,

  -- The full execution chain, so a completed run's attribution survives without
  -- walking four parents or depending on the legacy row's shape.
  campaign_id              uuid        NOT NULL,
  workflow_id              uuid        NOT NULL,
  workflow_version_id      uuid        NOT NULL,
  execution_instance_id    uuid        NOT NULL,
  execution_plan_id        uuid        NOT NULL,
  execution_plan_step_id   uuid        NOT NULL,

  -- Subject identity is AUTHORITATIVE here. The legacy row cannot express a
  -- kind, so this is the only place that distinguishes a lead from a prospect.
  subject_kind             text        NOT NULL,
  subject_id               text        NOT NULL,

  -- The resolved canonical person. NOT NULL: a bridged row without one would
  -- make quota and suppression unanswerable, and the engine already refuses an
  -- unresolved person rather than assuming capacity.
  person_id                uuid        NOT NULL,

  -- The authorized autonomy, read from the PINNED plan snapshot at handoff and
  -- recorded so a completed run can be explained without re-reading a Version
  -- that may since have been superseded.
  execution_mode           text        NOT NULL,
  -- The WORKFLOW term of the approval union, as it stood at handoff. The legacy
  -- task carries the composed requirement; this records what Workflow asked for.
  workflow_requires_approval boolean   NOT NULL,
  -- Whether the mode was authored or defaulted for a pre-policy Version.
  policy_source            text        NOT NULL,

  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT outreach_bridge_handoffs_subject_kind_valid
    CHECK (subject_kind IN ('lead', 'prospect')),
  CONSTRAINT outreach_bridge_handoffs_subject_not_blank
    CHECK (length(btrim(subject_id)) > 0),
  CONSTRAINT outreach_bridge_handoffs_mode_valid
    CHECK (execution_mode IN ('human', 'assisted', 'autonomous')),
  CONSTRAINT outreach_bridge_handoffs_policy_source_valid
    CHECK (policy_source IN ('authored', 'legacy_default')),
  -- A `human` step always requires approval. Recording the pair incoherently
  -- would let a later reader conclude autonomy was authorized when it was not.
  CONSTRAINT outreach_bridge_handoffs_human_requires_approval
    CHECK (execution_mode <> 'human' OR workflow_requires_approval),

  -- IDEMPOTENCY. The database is the arbiter; nothing checks-then-inserts.
  CONSTRAINT outreach_bridge_handoffs_task_unique
    UNIQUE (organization_id, execution_task_id),
  -- And one legacy task belongs to exactly one handoff, so a legacy row can
  -- never be claimed by two execution tasks.
  CONSTRAINT outreach_bridge_handoffs_legacy_unique
    UNIQUE (organization_id, outreach_task_id),

  CONSTRAINT outreach_bridge_handoffs_org_fk
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  -- Tenant-safe, via the companion key added above.
  CONSTRAINT outreach_bridge_handoffs_task_fk
    FOREIGN KEY (execution_task_id, organization_id)
    REFERENCES public.execution_tasks (id, organization_id) ON DELETE NO ACTION,
  CONSTRAINT outreach_bridge_handoffs_step_fk
    FOREIGN KEY (execution_plan_step_id, organization_id)
    REFERENCES public.execution_plan_steps (id, organization_id) ON DELETE NO ACTION,
  CONSTRAINT outreach_bridge_handoffs_plan_fk
    FOREIGN KEY (execution_plan_id, organization_id)
    REFERENCES public.execution_plans (id, organization_id) ON DELETE NO ACTION,
  CONSTRAINT outreach_bridge_handoffs_campaign_fk
    FOREIGN KEY (campaign_id, organization_id)
    REFERENCES public.prospect_campaigns (id, organization_id) ON DELETE NO ACTION,
  CONSTRAINT outreach_bridge_handoffs_workflow_fk
    FOREIGN KEY (workflow_id, organization_id)
    REFERENCES public.workflows (id, organization_id) ON DELETE NO ACTION,
  CONSTRAINT outreach_bridge_handoffs_version_fk
    FOREIGN KEY (workflow_version_id, organization_id)
    REFERENCES public.workflow_versions (id, organization_id) ON DELETE NO ACTION,
  -- The legacy task: a single-column reference. `outreach_tasks.company_id` IS
  -- `uuid` (A3's `20261011000000` retyped the whole nine-table family, which the
  -- committed baseline predates), so a composite key would be TYPE-compatible —
  -- but it would need a companion UNIQUE on `outreach_tasks (id, company_id)`,
  -- and altering the legacy substrate's schema is forbidden. Tenant agreement is
  -- therefore proven by the guard below, the precedent 033 set for its
  -- polymorphic subject. Note A3 deliberately did NOT retype `lead_id`: it stays
  -- `text`, which is why a subject_id of either kind fits it.
  CONSTRAINT outreach_bridge_handoffs_legacy_task_fk
    FOREIGN KEY (outreach_task_id)
    REFERENCES public.outreach_tasks (id) ON DELETE NO ACTION,
  -- The person, tenant-safe on the canonical table.
  CONSTRAINT outreach_bridge_handoffs_person_fk
    FOREIGN KEY (person_id) REFERENCES public.unified_persons (id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS ix_outreach_bridge_handoffs_instance
  ON public.outreach_bridge_handoffs (organization_id, execution_instance_id);

CREATE INDEX IF NOT EXISTS ix_outreach_bridge_handoffs_subject
  ON public.outreach_bridge_handoffs (organization_id, subject_kind, subject_id);

ALTER TABLE public.outreach_bridge_handoffs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Guard — a handoff is historical and immutable.
-- ---------------------------------------------------------------------------
-- There is no state to move, so this is an UNCONDITIONAL refusal, unlike the
-- narrow guards on tables whose lifecycle is the point. It also proves the two
-- tenant agreements no composite foreign key could express.
CREATE OR REPLACE FUNCTION public.outreach_bridge_handoffs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_legacy_company uuid;
  v_task record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'outreach_bridge_handoffs: handoff % is an immutable historical record', OLD.id;
  END IF;

  -- The legacy task must belong to the same tenant. `outreach_tasks.company_id`
  -- is text, so this is a comparison rather than a foreign key.
  SELECT company_id INTO v_legacy_company
    FROM public.outreach_tasks WHERE id = NEW.outreach_task_id;
  IF v_legacy_company IS NULL THEN
    RAISE EXCEPTION 'outreach_bridge_handoffs: legacy task % does not exist',
      NEW.outreach_task_id;
  END IF;
  IF v_legacy_company IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION
      'outreach_bridge_handoffs: legacy task % belongs to another tenant — a handoff may never cross organizations',
      NEW.outreach_task_id;
  END IF;

  -- The recorded chain must be the execution task's ACTUAL chain, not a claim.
  SELECT t.execution_instance_id, t.plan_step_id, t.subject_kind, t.subject_id,
         s.plan_id, p.workflow_version_id, i.campaign_id, i.workflow_id
    INTO v_task
    FROM public.execution_tasks t
    JOIN public.execution_plan_steps s
      ON s.id = t.plan_step_id AND s.organization_id = t.organization_id
    JOIN public.execution_plans p
      ON p.id = s.plan_id AND p.organization_id = s.organization_id
    JOIN public.execution_instances i
      ON i.id = t.execution_instance_id AND i.organization_id = t.organization_id
   WHERE t.id = NEW.execution_task_id AND t.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outreach_bridge_handoffs: execution task % is not resolvable in this tenant',
      NEW.execution_task_id;
  END IF;

  IF NEW.execution_instance_id  IS DISTINCT FROM v_task.execution_instance_id
  OR NEW.execution_plan_step_id IS DISTINCT FROM v_task.plan_step_id
  OR NEW.execution_plan_id      IS DISTINCT FROM v_task.plan_id
  OR NEW.workflow_version_id    IS DISTINCT FROM v_task.workflow_version_id
  OR NEW.campaign_id            IS DISTINCT FROM v_task.campaign_id
  OR NEW.workflow_id            IS DISTINCT FROM v_task.workflow_id
  OR NEW.subject_kind           IS DISTINCT FROM v_task.subject_kind
  OR NEW.subject_id             IS DISTINCT FROM v_task.subject_id THEN
    RAISE EXCEPTION
      'outreach_bridge_handoffs: the recorded chain disagrees with execution task % — attribution must be the task''s own',
      NEW.execution_task_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_outreach_bridge_handoffs_guard ON public.outreach_bridge_handoffs;
CREATE TRIGGER trg_outreach_bridge_handoffs_guard
  BEFORE INSERT OR UPDATE ON public.outreach_bridge_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.outreach_bridge_handoffs_guard();

-- ---------------------------------------------------------------------------
-- 4. bridge_execution_task — the ONE atomic handoff.
-- ---------------------------------------------------------------------------
-- ATOMICITY. The legacy task and the mapping are written in ONE statement's
-- transaction, so neither of the two failure shapes the brief names is
-- reachable: there is no mapping without its legacy task, and a retry cannot
-- create a second task because `outreach_bridge_handoffs_task_unique` refuses it.
--
-- The person is resolved by the caller through the existing
-- `resolveSubjectPersonId` and passed in: there is exactly one person-resolution
-- mechanism in this repository and this does not become a second one. A NULL
-- person is refused here as well, so the rule holds even if a caller forgets.
--
-- It DISPATCHES NOTHING. Governance, approval, rate limiting and transport all
-- run afterwards, in the existing engine, against the task this created.
CREATE OR REPLACE FUNCTION public.bridge_execution_task(
  p_organization_id uuid,
  p_execution_task_id uuid,
  p_person_id uuid,
  p_execution_mode text,
  p_workflow_requires_approval boolean,
  p_policy_source text,
  p_planner_version text,
  p_translation_version text,
  p_governance_version text,
  p_execution_runtime_version text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task     record;
  v_legacy   uuid;
  v_handoff  uuid;
BEGIN
  IF p_organization_id IS NULL OR p_execution_task_id IS NULL THEN
    RAISE EXCEPTION 'ob_bridge:invalid_input';
  END IF;
  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'ob_bridge:person_unresolved';
  END IF;
  IF p_execution_mode IS NULL
     OR p_execution_mode NOT IN ('human', 'assisted', 'autonomous') THEN
    RAISE EXCEPTION 'ob_bridge:invalid_policy';
  END IF;
  IF p_workflow_requires_approval IS NULL
     OR (p_execution_mode = 'human' AND NOT p_workflow_requires_approval) THEN
    RAISE EXCEPTION 'ob_bridge:invalid_policy';
  END IF;

  -- Lock the execution task: two concurrent handoffs of one task serialize here,
  -- and the loser then meets the unique constraint.
  SELECT t.id, t.organization_id, t.execution_instance_id, t.plan_step_id,
         t.subject_kind, t.subject_id, t.channel, t.action, t.state,
         t.delay_after_previous_hours, t.requires_approval AS task_requires_approval,
         s.plan_id, s.step_order, s.step_key,
         p.workflow_version_id, i.campaign_id, i.workflow_id, i.lifecycle_state
    INTO v_task
    FROM public.execution_tasks t
    JOIN public.execution_plan_steps s
      ON s.id = t.plan_step_id AND s.organization_id = t.organization_id
    JOIN public.execution_plans p
      ON p.id = s.plan_id AND p.organization_id = s.organization_id
    JOIN public.execution_instances i
      ON i.id = t.execution_instance_id AND i.organization_id = t.organization_id
   WHERE t.id = p_execution_task_id AND t.organization_id = p_organization_id
   FOR UPDATE OF t;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ob_bridge:task_not_found';
  END IF;
  IF v_task.state <> 'prepared' THEN
    RAISE EXCEPTION 'ob_bridge:task_not_prepared';
  END IF;
  -- A cancelled or finished run must not acquire new Outreach execution, and a
  -- paused one must not either. 037 owns the run's state; this only respects it.
  IF v_task.lifecycle_state NOT IN ('created', 'queued', 'active') THEN
    RAISE EXCEPTION 'ob_bridge:run_not_executable';
  END IF;

  INSERT INTO public.outreach_tasks (
    company_id, lead_id, plan_task_id, person_id,
    task_order, kind, action, channel,
    estimated_delay_hours, status, requires_approval,
    planner_version, translation_version, governance_version,
    execution_runtime_version, materialized_at
  ) VALUES (
    p_organization_id,
    -- The originating subject_id. The kind lives in the mapping, never here.
    v_task.subject_id,
    -- The execution task id: globally unique and run-dimensioned.
    p_execution_task_id::text,
    p_person_id,
    v_task.step_order,
    'outreach',
    v_task.action,
    v_task.channel,
    v_task.delay_after_previous_hours,
    -- The composed requirement decides where the legacy lifecycle starts. The
    -- existing approval authority then owns every transition from here.
    CASE WHEN p_workflow_requires_approval OR v_task.task_requires_approval
         THEN 'awaiting_approval' ELSE 'pending' END,
    p_workflow_requires_approval OR v_task.task_requires_approval,
    p_planner_version, p_translation_version, p_governance_version,
    p_execution_runtime_version, now()
  ) RETURNING id INTO v_legacy;

  INSERT INTO public.outreach_bridge_handoffs (
    organization_id, execution_task_id, outreach_task_id,
    campaign_id, workflow_id, workflow_version_id,
    execution_instance_id, execution_plan_id, execution_plan_step_id,
    subject_kind, subject_id, person_id,
    execution_mode, workflow_requires_approval, policy_source
  ) VALUES (
    p_organization_id, p_execution_task_id, v_legacy,
    v_task.campaign_id, v_task.workflow_id, v_task.workflow_version_id,
    v_task.execution_instance_id, v_task.plan_id, v_task.plan_step_id,
    v_task.subject_kind, v_task.subject_id, p_person_id,
    p_execution_mode, p_workflow_requires_approval, p_policy_source
  ) RETURNING id INTO v_handoff;

  RETURN v_handoff;
END $$;

REVOKE ALL ON FUNCTION public.bridge_execution_task(uuid, uuid, uuid, text, boolean, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_execution_task(uuid, uuid, uuid, text, boolean, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.bridge_execution_task(uuid, uuid, uuid, text, boolean, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_execution_task(uuid, uuid, uuid, text, boolean, text, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Postconditions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
  v text;
  v_code text;
BEGIN
  -- Idempotency and legacy exclusivity are database-enforced.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.outreach_bridge_handoffs'::regclass
       AND conname = 'outreach_bridge_handoffs_task_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'PI-040 postcondition: bridge idempotency is unenforced';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.outreach_bridge_handoffs'::regclass
       AND conname = 'outreach_bridge_handoffs_legacy_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'PI-040 postcondition: a legacy task could be claimed twice';
  END IF;

  -- Subject kind must be a column here, since the legacy row cannot carry it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'outreach_bridge_handoffs'
       AND column_name = 'subject_kind'
  ) THEN
    RAISE EXCEPTION 'PI-040 postcondition: the bridge cannot distinguish lead from prospect';
  END IF;
  -- Person is mandatory on a handoff.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'outreach_bridge_handoffs'
     AND column_name = 'person_id' AND is_nullable = 'NO';
  IF n <> 1 THEN
    RAISE EXCEPTION 'PI-040 postcondition: person_id is not mandatory on a handoff';
  END IF;

  -- NO second lifecycle. A state column here would duplicate the legacy one.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'outreach_bridge_handoffs'
     AND column_name IN ('state', 'status', 'lifecycle_state', 'delivery_status',
                         'sent_at', 'delivered_at', 'provider', 'transport',
                         'attempt_number', 'message_id', 'message_version_id');
  IF n > 0 THEN
    RAISE EXCEPTION 'PI-040 postcondition: % lifecycle/dispatch column(s) leaked into the bridge', n;
  END IF;

  -- The companion key exists, and NOT on execution_instances.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uq_execution_tasks_id_org'
  ) THEN
    RAISE EXCEPTION 'PI-040 postcondition: uq_execution_tasks_id_org is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.execution_instances'::regclass
       AND i.indisunique AND i.indpred IS NULL
       AND (SELECT count(*) FROM unnest(i.indkey)) > 1
  ) THEN
    RAISE EXCEPTION 'PI-040 postcondition: an unconditional composite unique key was added to execution_instances — 033 would fail on replay';
  END IF;

  -- The handoff function must not dispatch, and must not invent a slug.
  SELECT pg_get_functiondef(p.oid) INTO v
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'bridge_execution_task';
  IF v IS NULL THEN
    RAISE EXCEPTION 'PI-040 postcondition: bridge_execution_task is missing';
  END IF;
  v_code := regexp_replace(v, '--.*', '', 'gn');
  IF v_code NOT LIKE '%INSERT INTO public.outreach_tasks%' THEN
    RAISE EXCEPTION 'PI-040 postcondition: the bridge does not create a legacy task';
  END IF;
  IF v_code NOT LIKE '%INSERT INTO public.outreach_bridge_handoffs%' THEN
    RAISE EXCEPTION 'PI-040 postcondition: the bridge does not record a mapping';
  END IF;
  IF v_code NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'PI-040 postcondition: the bridge does not lock the execution task';
  END IF;
  IF v_code LIKE '%outreach_attempts%' OR v_code LIKE '%outreach_outcomes%'
     OR v_code LIKE '%outreach_decisions%' THEN
    RAISE EXCEPTION 'PI-040 postcondition: the bridge writes an execution record that belongs to the engine';
  END IF;
  IF length(v_code) < 800 THEN
    RAISE EXCEPTION 'PI-040 postcondition: the bridge body could not be read for inspection';
  END IF;

  -- The legacy substrate is untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.outreach_tasks'::regclass
       AND conname = 'outreach_tasks_identity_unique'
  ) THEN
    RAISE EXCEPTION 'PI-040 postcondition: the legacy outreach_tasks identity was altered';
  END IF;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'outreach_tasks'
     AND column_name IN ('execution_task_id', 'execution_instance_id', 'workflow_id',
                         'campaign_id', 'subject_kind');
  IF n > 0 THEN
    RAISE EXCEPTION 'PI-040 postcondition: % execution column(s) were added to outreach_tasks', n;
  END IF;

  -- 036/037 invariants intact.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_tasks'::regclass
       AND conname = 'execution_tasks_step_unique'
  ) THEN
    RAISE EXCEPTION 'PI-040 postcondition: 036 task identity was altered';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uq_execution_instances_active'
  ) THEN
    RAISE EXCEPTION 'PI-040 postcondition: 033 active uniqueness is missing';
  END IF;

  -- RLS and the guard.
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'outreach_bridge_handoffs' AND relrowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'PI-040 postcondition: RLS is not enabled on the bridge';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE NOT tgisinternal AND tgname = 'trg_outreach_bridge_handoffs_guard'
  ) THEN
    RAISE EXCEPTION 'PI-040 postcondition: the bridge guard is missing';
  END IF;
END $$;
