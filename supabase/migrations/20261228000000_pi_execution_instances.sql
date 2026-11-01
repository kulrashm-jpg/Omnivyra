-- PI-033 — the Execution Instance: one invocation of a Workflow for a Subject.
--
-- PORTED (2026-10-28) from the parked PI program (refs/preserve/wt/pi-consol
-- 10a046c4, 20261111000000), renumbered after main's latest migration. ONE
-- structural change: the `target_id` → prospect_campaign_targets foreign key is
-- NOT created here. The targets table belongs to the lists/campaign-targets chain
-- (LISTS-001), which lands later; that migration adds
-- `execution_instances_target_tenant_fk` with exactly the definition this file
-- used to carry, so the end state is unchanged. Until then `target_id` can only
-- be NULL: create_execution_instance refuses a target while the table is absent.
--
-- WHAT THIS ADDS
--   ONE table, `execution_instances`, and ONE function,
--   `create_execution_instance`. Nothing else.
--
--   NOT created: plans, steps, tasks, messages, schedulers, dispatch, channel
--   adapters, outcome attribution. 033 stops at the identity boundary:
--
--     Campaign + Workflow + current published Version + Subject + optional Target
--                              ↓
--                      EXECUTION INSTANCE
--                              ↓
--              [future Plan / Step / Task / Outreach]
--
-- ─── WHAT A ROW MEANS ─────────────────────────────────────────────────────
-- "Workflow W, as it stood in published Version V, was invoked for Subject S in
--  the context of Campaign C." It is durable historical evidence of exactly which
--  process was invoked, and it owns the mutable lifecycle of that one run.
--
-- ─── THE ACTIVE UNIQUENESS INVARIANT ──────────────────────────────────────
-- `uq_execution_instances_active` is the whole repeatability rule:
--
--   UNIQUE (organization_id, campaign_id, workflow_id, subject_kind, subject_id)
--     WHERE lifecycle_state IN ('created','queued','active','paused')
--
-- PARTIAL, so it constrains only OCCUPIED instances and leaves any number of
-- terminal ones alongside. That is what makes all of these simultaneously true:
--
--   * the same Campaign + Workflow + Subject may NOT have two occupied runs;
--   * a terminal run RELEASES the slot, so the same triple may run again;
--   * different Campaigns may run the same Workflow for the same Subject;
--   * different Workflows may run concurrently for the same Subject;
--   * history is never collapsed — every past run keeps its own row.
--
-- A broad unique constraint over all instances would forbid the re-entry the
-- ratified contract requires. The predicate is the point.
--
-- ─── THE VERSION IS PINNED, NOT CHOSEN ────────────────────────────────────
-- `workflow_version_id` is resolved by `create_execution_instance` from 032's
-- status invariant — `status = 'published'` — and never from MAX(version),
-- ORDER BY version, created_at or insertion order. The caller names a WORKFLOW;
-- the system resolves its current published Version and pins it.
--
-- After creation the pin is immutable, so publishing, superseding or archiving a
-- Version does not alter any instance that already referenced it. A completed run
-- therefore still answers "which process actually executed" years later, which is
-- the entire reason 031 required versioning before this table could exist.
--
-- ─── THE TARGET IS OPTIONAL, BY NECESSITY ─────────────────────────────────
-- 031 established that a Campaign Target is structurally prospect-AND-list scoped,
-- so a `lead` subject can never have one. Making `target_id` NOT NULL would have
-- meant restricting workflow execution to prospects, which reverses substrate C
-- (022/024). It is therefore nullable, and when present the function proves the
-- Target agrees with the tenant, the campaign, the subject kind and the prospect.
--
-- ─── SUBJECT IS (kind, id), AND id IS text ────────────────────────────────
-- `subject_id` is `text`, matching 024's `lead_intelligence_profiles.subject_id`,
-- so the two persisted subject-bearing tables agree and a future join between them
-- needs no cast. Both `leads.id` and `canonical_leads.id` are uuid, so the function
-- checks the shape before casting rather than letting a 22P02 escape. A polymorphic
-- (kind, id) pair cannot carry a foreign key, so tenant safety for the subject is
-- proven inside the function — which is still the database, not application code.
--
-- ─── NOT TOUCHED ──────────────────────────────────────────────────────────
-- 032's `workflows` and `workflow_versions` and their guards and FK semantics; all
-- PI tables; `prospect_campaign_targets`; the entire execution layer
-- (`outreach_tasks` and its (company_id, lead_id, plan_task_id) identity, attempts,
-- approvals, decisions, suppressions, contact_governance_records); the planner
-- (`PERSONA_PLAYBOOKS`, `automationPlanning`, `buildOutreachPlan`, `taskGenerator`);
-- and every migration through 20261110. No existing column, constraint, index,
-- trigger, policy or function is altered.

DO $$
BEGIN
  IF to_regclass('public.workflows') IS NULL
  OR to_regclass('public.workflow_versions') IS NULL THEN
    RAISE EXCEPTION 'PI-033: workflows/workflow_versions are absent — 20261227000000 must be applied first';
  END IF;
  IF to_regclass('public.prospect_campaigns') IS NULL THEN
    RAISE EXCEPTION 'PI-033: prospect_campaigns is absent — 20261226000000 must be applied first';
  END IF;
  IF to_regclass('public.canonical_leads') IS NULL OR to_regclass('public.leads') IS NULL THEN
    RAISE EXCEPTION 'PI-033: a subject source table is absent';
  END IF;

  -- The companion (id, tenant) keys every reference resolves against. A plain
  -- `REFERENCES x(id)` would permit a cross-tenant instance, so a missing key must
  -- fail the migration rather than silently degrade the contract.
  IF to_regclass('public.uq_prospect_campaigns_id_org')       IS NULL
  OR to_regclass('public.uq_workflows_id_org')                IS NULL
  OR to_regclass('public.uq_workflow_versions_id_org')        IS NULL THEN
    RAISE EXCEPTION 'PI-033: a companion (id, organization_id) key is missing — tenant-safe foreign keys cannot be created';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The instance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.execution_instances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,

  -- The business context. In the uniqueness key, so the same Workflow may run for
  -- the same Subject under two Campaigns at once.
  campaign_id         uuid NOT NULL,

  -- The process. In the uniqueness key. NOT the version: publishing a new version
  -- must never be a way to start a second concurrent run.
  workflow_id         uuid NOT NULL,

  -- THE PIN. Immutable after creation, resolved by status, never chosen by a caller.
  workflow_version_id uuid NOT NULL,

  -- Optional, and necessarily so: a `lead` subject can never have a Target.
  target_id           uuid,

  -- 024's subject contract, unchanged. `text` to match
  -- `lead_intelligence_profiles.subject_id`.
  subject_kind        text NOT NULL,
  subject_id          text NOT NULL,

  -- The only mutable field besides `updated_at`.
  lifecycle_state     text NOT NULL DEFAULT 'created',

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT execution_instances_subject_kind_valid
    CHECK (subject_kind IN ('lead', 'prospect')),
  CONSTRAINT execution_instances_subject_id_not_blank
    CHECK (length(btrim(subject_id)) > 0),
  CONSTRAINT execution_instances_lifecycle_valid
    CHECK (lifecycle_state IN (
      'created', 'queued', 'active', 'paused',     -- occupied
      'completed', 'cancelled', 'failed')),        -- terminal
  -- A `lead` subject cannot carry a Target. The database can state this one
  -- without reaching another row, so it does.
  CONSTRAINT execution_instances_lead_has_no_target
    CHECK (target_id IS NULL OR subject_kind = 'prospect'),

  CONSTRAINT execution_instances_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,

  -- ── TENANT SAFETY IS THE DATABASE'S ──
  -- Every reference is composite, so a cross-tenant instance is unrepresentable
  -- rather than merely rejected. NO ACTION on each historical reference: a direct
  -- delete of a referenced row is refused, and a tenant cascade still completes.
  -- (033 does not restate the retracted claim about RESTRICT; the T2 suite measures
  -- the actual behaviour instead.)
  CONSTRAINT execution_instances_campaign_tenant_fk
    FOREIGN KEY (campaign_id, organization_id)
    REFERENCES public.prospect_campaigns (id, organization_id) ON DELETE NO ACTION,

  CONSTRAINT execution_instances_workflow_tenant_fk
    FOREIGN KEY (workflow_id, organization_id)
    REFERENCES public.workflows (id, organization_id) ON DELETE NO ACTION,

  CONSTRAINT execution_instances_version_tenant_fk
    FOREIGN KEY (workflow_version_id, organization_id)
    REFERENCES public.workflow_versions (id, organization_id) ON DELETE NO ACTION
  -- execution_instances_target_tenant_fk (target_id, organization_id) →
  -- prospect_campaign_targets is added by the campaign-targets migration.
);

-- ---------------------------------------------------------------------------
-- 2. THE ACTIVE UNIQUENESS INVARIANT.
-- ---------------------------------------------------------------------------
-- Partial, so only occupied instances contend. This is the database half of the
-- ratified repeatability rule and it is not duplicated in application code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_instances_active
  ON public.execution_instances
     (organization_id, campaign_id, workflow_id, subject_kind, subject_id)
  WHERE lifecycle_state IN ('created', 'queued', 'active', 'paused');

-- "What has this campaign run, most recent first" — the operator read.
CREATE INDEX IF NOT EXISTS idx_execution_instances_campaign
  ON public.execution_instances (organization_id, campaign_id, created_at DESC);

-- "What has run for this subject, across campaigns and workflows" — the
-- attribution read a future Intelligence join needs.
CREATE INDEX IF NOT EXISTS idx_execution_instances_subject
  ON public.execution_instances (organization_id, subject_kind, subject_id, created_at DESC);

-- "Which instances pinned this version" — the question Model B exists to answer.
CREATE INDEX IF NOT EXISTS idx_execution_instances_version
  ON public.execution_instances (organization_id, workflow_version_id);

-- ---------------------------------------------------------------------------
-- 3. Identity immutability — narrow, so lifecycle still moves.
-- ---------------------------------------------------------------------------
-- NOT an unconditional UPDATE refusal. The whole purpose of this table is that
-- `lifecycle_state` changes; freezing the row would make it useless. So identity
-- and historical attribution freeze, and exactly one field moves.
--
-- A terminal instance is closed for good: re-entry is a NEW instance, which is the
-- ratified retry semantic and is what keeps run history honest.
CREATE OR REPLACE FUNCTION public.execution_instances_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id     IS DISTINCT FROM OLD.organization_id
  OR NEW.campaign_id         IS DISTINCT FROM OLD.campaign_id
  OR NEW.workflow_id         IS DISTINCT FROM OLD.workflow_id
  OR NEW.workflow_version_id IS DISTINCT FROM OLD.workflow_version_id
  OR NEW.target_id           IS DISTINCT FROM OLD.target_id
  OR NEW.subject_kind        IS DISTINCT FROM OLD.subject_kind
  OR NEW.subject_id          IS DISTINCT FROM OLD.subject_id
  OR NEW.created_at          IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'execution_instances: the identity and pinned attribution of instance % are immutable — a retry is a NEW instance',
      OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF OLD.lifecycle_state IN ('completed', 'cancelled', 'failed')
     AND NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    RAISE EXCEPTION
      'execution_instances: instance % is % and terminal — a terminal run may not be reopened, create a NEW instance',
      OLD.id, OLD.lifecycle_state
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_execution_instances_guard ON public.execution_instances;
CREATE TRIGGER trg_execution_instances_guard
  BEFORE UPDATE ON public.execution_instances
  FOR EACH ROW EXECUTE FUNCTION public.execution_instances_guard();

-- ---------------------------------------------------------------------------
-- 4. Atomic creation.
-- ---------------------------------------------------------------------------
-- WHY A FUNCTION. Resolving the current published Version and inserting the
-- instance must not be separable: between a store-level read and a store-level
-- insert, another transaction could publish a new Version, and the instance would
-- be created pinning a Version that is no longer current — silently, and
-- permanently, because the pin is immutable.
--
-- It also puts every cross-entity validation inside the database, which matters
-- for the two invariants no foreign key can express: that a polymorphic subject
-- belongs to this tenant, and that a supplied Target agrees with the campaign and
-- the subject.
--
-- RETURNS uuid, deliberately: a RETURNS TABLE output column is an ordinary plpgsql
-- variable, and 032 lost a T2 run to output names shadowing real columns (42702).
-- A scalar return cannot shadow anything.
CREATE OR REPLACE FUNCTION public.create_execution_instance(
  p_organization_id uuid,
  p_campaign_id     uuid,
  p_workflow_id     uuid,
  p_subject_kind    text,
  p_subject_id      text,
  p_target_id       uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version_id uuid;
  v_wf_status  text;
  v_exists     boolean;
  v_subject_uuid uuid;
  v_new_id     uuid;
BEGIN
  IF p_subject_kind NOT IN ('lead', 'prospect') THEN
    RAISE EXCEPTION 'ei_create:invalid_subject_kind' USING ERRCODE = '23514';
  END IF;
  IF p_subject_id IS NULL OR length(btrim(p_subject_id)) = 0 THEN
    RAISE EXCEPTION 'ei_create:invalid_subject_id' USING ERRCODE = '23514';
  END IF;

  -- ── the campaign must exist IN THIS TENANT ──
  SELECT true INTO v_exists FROM public.prospect_campaigns c
   WHERE c.id = p_campaign_id AND c.organization_id = p_organization_id;
  IF v_exists IS NOT TRUE THEN
    RAISE EXCEPTION 'ei_create:campaign_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- ── the workflow must exist in this tenant AND be usable ──
  SELECT w.status INTO v_wf_status FROM public.workflows w
   WHERE w.id = p_workflow_id AND w.organization_id = p_organization_id;
  IF v_wf_status IS NULL THEN
    RAISE EXCEPTION 'ei_create:workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_wf_status <> 'active' THEN
    RAISE EXCEPTION 'ei_create:workflow_not_active' USING ERRCODE = '23514';
  END IF;

  -- ── THE VERSION PIN. 032's status invariant, and nothing else. There is no
  -- ORDER BY, no MAX, no created_at: `uq_workflow_versions_one_published`
  -- guarantees at most one row matches, so this is exact rather than a best guess.
  SELECT v.id INTO v_version_id FROM public.workflow_versions v
   WHERE v.organization_id = p_organization_id
     AND v.workflow_id = p_workflow_id
     AND v.status = 'published';
  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'ei_create:no_published_version' USING ERRCODE = '23514';
  END IF;

  -- ── the subject must exist IN THIS TENANT. A polymorphic (kind, id) pair cannot
  -- carry a foreign key, so the check lives here — still in the database.
  IF p_subject_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    -- Both subject source tables key on uuid; checking the shape first keeps a
    -- 22P02 from escaping as an unhandled cast error.
    RAISE EXCEPTION 'ei_create:subject_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_subject_uuid := p_subject_id::uuid;

  v_exists := NULL;
  IF p_subject_kind = 'prospect' THEN
    SELECT true INTO v_exists FROM public.canonical_leads cl
     WHERE cl.id = v_subject_uuid AND cl.company_id = p_organization_id;
  ELSE
    SELECT true INTO v_exists FROM public.leads l
     WHERE l.id = v_subject_uuid AND l.company_id = p_organization_id;
  END IF;
  IF v_exists IS NOT TRUE THEN
    RAISE EXCEPTION 'ei_create:subject_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- ── the Target, when supplied, must agree on every axis ──
  IF p_target_id IS NOT NULL THEN
    -- Until the campaign-targets migration exists there is no Target to agree
    -- with, so a supplied one is refused rather than referenced.
    IF to_regclass('public.prospect_campaign_targets') IS NULL THEN
      RAISE EXCEPTION 'ei_create:targets_not_installed' USING ERRCODE = '23514';
    END IF;
    IF p_subject_kind <> 'prospect' THEN
      RAISE EXCEPTION 'ei_create:target_requires_prospect' USING ERRCODE = '23514';
    END IF;
    v_exists := NULL;
    SELECT true INTO v_exists FROM public.prospect_campaign_targets t
     WHERE t.id = p_target_id
       AND t.organization_id = p_organization_id
       AND t.campaign_id = p_campaign_id
       AND t.prospect_id = v_subject_uuid;
    IF v_exists IS NOT TRUE THEN
      -- One code for all three mismatches: a caller learning WHICH axis failed
      -- would learn whether another tenant's target exists.
      RAISE EXCEPTION 'ei_create:target_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- ── insert. The partial unique index is what refuses a second occupied run,
  -- including under concurrency, and it raises 23505 the caller can act on.
  INSERT INTO public.execution_instances (
    organization_id, campaign_id, workflow_id, workflow_version_id,
    target_id, subject_kind, subject_id
  ) VALUES (
    p_organization_id, p_campaign_id, p_workflow_id, v_version_id,
    p_target_id, p_subject_kind, btrim(p_subject_id)
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END
$$;

REVOKE EXECUTE ON FUNCTION
  public.create_execution_instance(uuid, uuid, uuid, text, text, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_execution_instance(uuid, uuid, uuid, text, text, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_execution_instance(uuid, uuid, uuid, text, text, uuid) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_execution_instance(uuid, uuid, uuid, text, text, uuid) TO service_role';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Tenant isolation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.execution_instances ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'execution_instances'
       AND policyname = 'execution_instances_service_role'
  ) THEN
    CREATE POLICY execution_instances_service_role ON public.execution_instances
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Documentation of the contract.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.execution_instances IS
  'PI-033. ONE invocation of a Workflow for a Subject in a Campaign context: '
  '"Workflow W, as published Version V, was invoked for Subject S in Campaign C". '
  'Owns the mutable lifecycle of that run and nothing else — no plan, step, task, '
  'message, channel, schedule or outcome. Active uniqueness is '
  '(organization_id, campaign_id, workflow_id, subject_kind, subject_id) WHERE '
  'lifecycle_state is occupied; terminal states RELEASE the slot so the same '
  'triple may run again, and a whole-run retry is a NEW instance.';

COMMENT ON COLUMN public.execution_instances.workflow_version_id IS
  'PI-033. THE PIN. Resolved by create_execution_instance from 032''s status '
  'invariant (status = ''published'') — never MAX(version), ORDER BY version, '
  'created_at or insertion order — and immutable thereafter. Publishing, '
  'superseding or archiving a version does not alter an instance that pinned it: '
  'the instance is evidence of which process actually executed.';

COMMENT ON COLUMN public.execution_instances.target_id IS
  'PI-033. OPTIONAL, by necessity. A Campaign Target is prospect-and-list scoped, '
  'so a `lead` subject can never have one; requiring it would reverse the '
  'subject-neutral architecture of 022/024. When present it is proven to agree '
  'with the tenant, the campaign and the subject prospect. Target selection '
  'evidence is NOT copied here — it is reached through the Target.';

COMMENT ON COLUMN public.execution_instances.lifecycle_state IS
  'PI-033. The ONLY mutable field besides updated_at. Occupied: created, queued, '
  'active, paused. Terminal: completed, cancelled, failed. A terminal instance may '
  'never be reopened.';

-- ---------------------------------------------------------------------------
-- 7. Postcondition.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v text;
        n integer;
BEGIN
  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'execution_instances';
  IF v IS DISTINCT FROM
     'campaign_id,created_at,id,lifecycle_state,organization_id,subject_id,'
     'subject_kind,target_id,updated_at,workflow_id,workflow_version_id' THEN
    RAISE EXCEPTION 'PI-033 postcondition: the column set is %', v;
  END IF;

  -- No downstream concern may appear on the identity row.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'execution_instances'
       AND column_name IN ('plan', 'plan_id', 'steps', 'step_id', 'task_id',
                           'message_id', 'channel', 'provider', 'scheduled_at',
                           'retry_count', 'outcome', 'definition')
  ) THEN
    RAISE EXCEPTION 'PI-033 postcondition: a downstream concern appeared on execution_instances';
  END IF;

  -- THE ACTIVE UNIQUENESS INVARIANT, and its predicate.
  SELECT indexdef INTO v FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_execution_instances_active';
  IF v IS NULL THEN
    RAISE EXCEPTION 'PI-033 postcondition: uq_execution_instances_active is missing — active uniqueness is unenforced';
  END IF;
  IF v NOT LIKE '%UNIQUE%'
  OR v NOT LIKE '%organization_id, campaign_id, workflow_id, subject_kind, subject_id%'
  OR v NOT LIKE '%created%' OR v NOT LIKE '%queued%'
  OR v NOT LIKE '%active%'  OR v NOT LIKE '%paused%' THEN
    RAISE EXCEPTION 'PI-033 postcondition: the active-uniqueness index is not the agreed partial unique index — it is %', v;
  END IF;
  -- And it must NOT constrain terminal instances, or re-entry is impossible.
  IF v LIKE '%completed%' OR v LIKE '%cancelled%' OR v LIKE '%failed%' THEN
    RAISE EXCEPTION 'PI-033 postcondition: the active-uniqueness predicate includes a terminal state — re-entry would be impossible';
  END IF;

  -- There must be NO unconditional unique key over the identity, which would
  -- collapse history.
  IF EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.execution_instances'::regclass
       AND i.indisunique AND i.indpred IS NULL
       AND (SELECT count(*) FROM unnest(i.indkey)) > 1
  ) THEN
    RAISE EXCEPTION 'PI-033 postcondition: an unconditional composite unique key exists — historical instances would be collapsed';
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.execution_instances'::regclass AND contype = 'f';
  -- 4 before 20261231000000; exactly 5 after it, the fifth being its target FK
  -- (so a re-run after that migration still holds).
  IF n <> 4 AND NOT (n = 5 AND EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.execution_instances'::regclass
          AND conname = 'execution_instances_target_tenant_fk')) THEN
    RAISE EXCEPTION 'PI-033 postcondition: % foreign keys, expected 4 (the target FK lands with the campaign-targets migration)', n;
  END IF;

  -- Only the tenant cascades in; every historical reference is protected.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.execution_instances'::regclass AND contype = 'f'
     AND confdeltype = 'c';
  IF n <> 1 THEN
    RAISE EXCEPTION 'PI-033 postcondition: % cascading foreign keys, expected exactly 1 (the tenant)', n;
  END IF;
  -- And none may SET NULL, which would silently destroy attribution.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_instances'::regclass AND contype = 'f'
       AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'PI-033 postcondition: a reference uses SET NULL — historical attribution could vanish silently';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.execution_instances'::regclass
       AND tgname = 'trg_execution_instances_guard' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'PI-033 postcondition: the identity guard is missing';
  END IF;
  -- The guard must NOT be unconditional, or lifecycle could never move.
  SELECT pg_get_functiondef(oid) INTO v FROM pg_proc
   WHERE proname = 'execution_instances_guard';
  IF v NOT LIKE '%lifecycle_state%' THEN
    RAISE EXCEPTION 'PI-033 postcondition: the guard does not reason about lifecycle_state — an unconditional guard would freeze the run';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_execution_instance') THEN
    RAISE EXCEPTION 'PI-033 postcondition: create_execution_instance is missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.execution_instances'::regclass) THEN
    RAISE EXCEPTION 'PI-033 postcondition: RLS is not enabled';
  END IF;

  -- ── THE NEIGHBOURS 033 MAY NOT TOUCH ──
  SELECT indexdef INTO v FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_workflow_versions_one_published';
  IF v IS NULL OR v NOT LIKE '%status = ''published''%' THEN
    RAISE EXCEPTION 'PI-033 postcondition: 032''s one-published invariant changed — 033 must not touch it';
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO v
    FROM pg_index i
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indexrelid = 'public.outreach_tasks_identity_unique'::regclass;
  IF v IS DISTINCT FROM 'company_id,lead_id,plan_task_id' THEN
    RAISE EXCEPTION 'PI-033 postcondition: the outreach task identity changed to % — 033 must not touch it', v;
  END IF;
END
$$;
