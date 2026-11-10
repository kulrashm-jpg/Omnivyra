-- PI-WORKFLOW-DEFINITION-032 — the Workflow and its immutable published Versions.
--
-- WHAT THIS ADDS
--   TWO tables and ONE function, and nothing else:
--     workflows                       stable reusable identity
--     workflow_versions               immutable published process definition
--     publish_workflow_version(...)   the atomic publication transition
--
--   NOT created: workflow_steps, execution_instances, plans, tasks, messages,
--   message_versions. Steps are EMBEDDED in the Version's immutable content,
--   because a published Version can never change — which makes an embedded step
--   key durable without a table to hold it.
--
-- ─── THE RATIFIED CONTRACT (032-DECISION) ─────────────────────────────────
--   Workflow lifecycle       active | archived
--   Version lifecycle        draft -> published -> superseded | archived
--   Multiplicity             at most ONE published Version per workflow
--   Selection               resolved once at Execution Instance creation, pinned
--   Timing                  delay_after_previous_hours per step. Nothing else.
--
-- ─── BOTTLENECK 1: "CURRENT" IS A STATUS, NEVER A NUMBER ──────────────────
-- `uq_workflow_versions_one_published` is the whole invariant: a PARTIAL unique
-- index on (organization_id, workflow_id) WHERE status = 'published'. One
-- published Version per workflow, enforced by the database rather than by a
-- writer remembering to check.
--
-- The current Version is therefore the row WHERE status = 'published' — never
-- `MAX(version)`, never the newest `created_at`, never the last row inserted.
-- Those happen to agree in the simplest case and DISAGREE the moment a draft
-- exists above the published row, or the published row is archived with no
-- replacement. `version` is a human-facing ordinal and is NOT the source of
-- truth; `uq_workflow_versions_identity` exists to keep it unique per workflow,
-- not to make it authoritative.
--
-- ─── BOTTLENECK 2: CONTENT FREEZES, STATUS DOES NOT ───────────────────────
-- An unconditional `BEFORE UPDATE -> RAISE` — the shape 029 used for the
-- Campaign Target and the shape `prospect_score_evaluations` uses — would be
-- WRONG here, because a published Version must still be able to become
-- superseded or archived. So this follows `prospect_icp_versions_guard_immutable`
-- instead: content and identity freeze at publication, and exactly one class of
-- transition survives.
--
-- Permitted:   draft -> draft (editing)    draft -> published
--              published -> superseded     published -> archived
-- Refused:     published -> draft          superseded -> anything
--              archived -> anything        any content edit at or after publication
--              any content edit in the SAME statement as a status transition
--
-- ─── BOTTLENECK 3: DELETE IS THE FOREIGN KEY'S JOB, NOT THE TRIGGER'S ─────
-- The guard above is `BEFORE UPDATE` only, so it cannot stop a DELETE — exactly
-- the gap 029 found in `prospect_score_evaluations_immutable` and
-- `prospect_icp_versions_guard_immutable`, both of which are `tgtype = 19`.
-- Protection for a referenced Version must therefore come from the referrer's
-- foreign key, and when the future Execution Instance adds that key it must use
-- `ON DELETE NO ACTION` and not `RESTRICT`:
--
--   NO ACTION is checked at the END of the statement, by which time a cascaded
--             referrer is already gone. It still refuses a DIRECT delete.
--   RESTRICT  is checked IMMEDIATELY. Whether that breaks a cascade from
--             `companies` depends on the ORDER in which PostgreSQL processes the
--             referencing tables, because the referrer is itself being cascaded
--             away.
--
-- A NOTE ON WHAT IS AND IS NOT PROVEN. 029's report, and an earlier draft of this
-- comment, claimed RESTRICT would break tenant offboarding outright. T2 tested
-- exactly that and it did NOT reproduce: the RESTRICT cascade also succeeded,
-- because of the ordering above. So the differential is not claimed. NO ACTION is
-- used because it is the ratified semantic and the WEAKER constraint — immediate
-- checking buys nothing here and can only add order sensitivity — not because
-- RESTRICT was shown to fail.
--
-- `uq_workflow_versions_id_org` is published here so that future key can be
-- composite and therefore tenant-safe. 032 creates no referrer, and the T2 suite
-- proves the semantic with a throwaway referencing table inside a rolled-back
-- transaction rather than by asserting it.
--
-- ─── NOT TOUCHED ──────────────────────────────────────────────────────────
-- Every PI table (prospect_*, canonical_*, unified_persons, offerings,
-- lead_intelligence_profiles), the whole execution layer (outreach_tasks and its
-- (company_id, lead_id, plan_task_id) identity, attempts, approvals, decisions,
-- suppressions, contact_governance_records), the legacy gtm_* tables, and every
-- migration 006 through 20261109. No existing column, constraint, index, trigger,
-- policy or function is altered. `PERSONA_PLAYBOOKS`, `automationPlanning`,
-- `buildOutreachPlan`, `taskGenerator`, `WAIT_TASK_THRESHOLD_HOURS` and
-- `MAX_TASKS` are untouched: the planner migration is deferred.

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032: companies is absent';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The stable Workflow identity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,

  name             text NOT NULL,
  description      text,

  -- The ratified lifecycle. `active` may author and invoke; `archived` is
  -- historical and queryable but may not be used for new authoring or new
  -- execution. There is deliberately NO draft state: draft content belongs to an
  -- unpublished Version, so a draft flag here would have no draft to describe.
  status           text NOT NULL DEFAULT 'active',

  -- A BARE uuid with no foreign key, as 012's `curated_by` and 016's
  -- `created_by`: attribution must survive the user record.
  created_by       uuid,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workflows_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT workflows_status_valid CHECK (status IN ('active', 'archived')),
  CONSTRAINT workflows_description_length
    CHECK (description IS NULL OR length(description) <= 2000),

  CONSTRAINT workflows_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE
);

-- The companion key a Version's tenant-safe foreign key resolves against. A plain
-- `REFERENCES workflows(id)` would let one tenant's Version attach to another
-- tenant's Workflow, and no application check can make that unrepresentable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_id_org
  ON public.workflows (id, organization_id);

CREATE INDEX IF NOT EXISTS idx_workflows_org_status
  ON public.workflows (organization_id, status);

-- ---------------------------------------------------------------------------
-- 2. The immutable Workflow Version.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  workflow_id      uuid NOT NULL,

  -- HUMAN-FACING ORDINAL ONLY. Unique per workflow so "v3" means one thing, but
  -- never the source of truth for which Version is current — see BOTTLENECK 1.
  version          integer NOT NULL,

  status           text NOT NULL DEFAULT 'draft',

  -- THE AUTHORED PROCESS. `{"steps": [...]}`, where each step carries a durable
  -- within-version `key`, a `channel` INTENT, and `delay_after_previous_hours`.
  -- Step keys are scoped to the Version: v1 and v2 may both contain `intro` and
  -- they are different immutable definitions, so the key is deliberately NOT
  -- globally unique. The Version is the immutable container.
  --
  -- It may carry personalization INSTRUCTIONS. It may never carry a resolved
  -- prospect value — no name, company, email, score, ICP fit, intent, person id,
  -- prospect id or lead id — and no runtime state: no run counts, no last-used
  -- timestamp, no performance data. A Version is reusable or it is a hidden PI
  -- store, and it cannot be both.
  definition       jsonb NOT NULL DEFAULT '{"steps": []}'::jsonb,

  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  published_at     timestamptz,
  published_by     uuid,

  CONSTRAINT workflow_versions_version_positive CHECK (version > 0),
  CONSTRAINT workflow_versions_status_valid
    CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  CONSTRAINT workflow_versions_definition_is_object
    CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT workflow_versions_steps_is_array
    CHECK (jsonb_typeof(definition -> 'steps') = 'array'),

  -- A draft has never been published; anything else has. The publication actor
  -- and time are therefore present exactly when they are meaningful, which is
  -- 008's `override_coherent` rule applied to publication.
  CONSTRAINT workflow_versions_publication_coherent CHECK (
    (status = 'draft'  AND published_at IS NULL     AND published_by IS NULL)
    OR (status <> 'draft' AND published_at IS NOT NULL AND published_by IS NOT NULL)),

  CONSTRAINT workflow_versions_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,

  -- TENANT-SAFE AND COMPOSITE. A Version cannot attach to another tenant's
  -- Workflow. CASCADE because a Workflow is never deleted through the API
  -- (archival preserves the record) and the only real deletion path is tenant
  -- offboarding, which must stay possible.
  CONSTRAINT workflow_versions_workflow_tenant_fk
    FOREIGN KEY (workflow_id, organization_id)
    REFERENCES public.workflows (id, organization_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 3. Identity and THE INVARIANT.
-- ---------------------------------------------------------------------------

-- The human-facing ordinal is unique per workflow.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_versions_identity
  ON public.workflow_versions (organization_id, workflow_id, version);

-- Published so the FUTURE Execution Instance can reference a Version through a
-- tenant-safe composite key without this table being redesigned. 032 creates no
-- referrer; this index asserts nothing about one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_versions_id_org
  ON public.workflow_versions (id, organization_id);

-- ── BOTTLENECK 1, ENFORCED ──────────────────────────────────────────────────
-- AT MOST ONE PUBLISHED VERSION PER WORKFLOW. Partial, so it constrains only the
-- published row and leaves any number of drafts, superseded and archived rows
-- alongside it. This is the same shape as `uq_prospect_icp_versions_one_ratified`.
--
-- It is also what makes concurrent publication safe: two publications racing for
-- the same workflow cannot both win, because the second insertion into this index
-- conflicts. A transient state with TWO current Versions is therefore not merely
-- avoided by convention — it is unrepresentable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_versions_one_published
  ON public.workflow_versions (organization_id, workflow_id)
  WHERE status = 'published';

-- "Which versions does this workflow have, newest ordinal first" — the author's
-- read. Deliberately NOT a current-version lookup.
CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow
  ON public.workflow_versions (organization_id, workflow_id, version DESC);

-- ---------------------------------------------------------------------------
-- 4. Guards.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workflows_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'workflows.organization_id is immutable (workflow %)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'workflows.created_at is immutable (workflow %)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_workflows_guard ON public.workflows;
CREATE TRIGGER trg_workflows_guard
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.workflows_guard();

-- ── BOTTLENECK 2, ENFORCED ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.workflow_versions_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The tenant of ANY row is immutable. Moving a row between tenants is not an
  -- edit, it is a leak.
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'workflow_versions: organization_id is immutable'
      USING ERRCODE = '23514';
  END IF;

  -- A terminal Version is wholly immutable, status included. There is no route
  -- back to published: republishing means publishing a NEW version.
  IF OLD.status IN ('superseded', 'archived') THEN
    RAISE EXCEPTION
      'workflow_versions: version % of workflow % is % and wholly immutable',
      OLD.version, OLD.workflow_id, OLD.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'published' THEN
    -- The ONLY transitions a published Version may make.
    IF NEW.status NOT IN ('superseded', 'archived') THEN
      RAISE EXCEPTION
        'workflow_versions: a published version may only become superseded or archived (got %) — edit by publishing a NEW version',
        NEW.status
        USING ERRCODE = '23514';
    END IF;
    -- And it may change NOTHING else while doing so.
    IF NEW.workflow_id  IS DISTINCT FROM OLD.workflow_id
    OR NEW.version      IS DISTINCT FROM OLD.version
    OR NEW.definition   IS DISTINCT FROM OLD.definition
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.published_by IS DISTINCT FROM OLD.published_by
    OR NEW.created_by   IS DISTINCT FROM OLD.created_by
    OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION
        'workflow_versions: the content of a published version is immutable — a status transition may not alter it'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'published') THEN
      RAISE EXCEPTION
        'workflow_versions: a draft may only stay draft or become published (got %)', NEW.status
        USING ERRCODE = '23514';
    END IF;
    -- Identity is fixed from creation, draft or not.
    IF NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
    OR NEW.version     IS DISTINCT FROM OLD.version
    OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'workflow_versions: version identity is immutable'
        USING ERRCODE = '23514';
    END IF;
    -- Publication is a TRANSITION, not an edit. Content must already be what is
    -- being published, so a reviewer of the draft reviewed what shipped.
    IF NEW.status = 'published' AND NEW.definition IS DISTINCT FROM OLD.definition THEN
      RAISE EXCEPTION
        'workflow_versions: publication may not alter the definition — edit the draft, then publish it'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_workflow_versions_guard ON public.workflow_versions;
CREATE TRIGGER trg_workflow_versions_guard
  BEFORE UPDATE ON public.workflow_versions
  FOR EACH ROW EXECUTE FUNCTION public.workflow_versions_guard_immutable();

-- ---------------------------------------------------------------------------
-- 5. Publication — one atomic transition.
-- ---------------------------------------------------------------------------
-- WHY THIS IS A FUNCTION AND NOT TWO STORE CALLS.
--
-- Publishing must supersede the outgoing current Version and publish the incoming
-- one. The order is forced: the partial unique index forbids two published rows,
-- so the outgoing one must be superseded FIRST. But a superseded Version is
-- wholly immutable, so if the second statement then failed there would be no way
-- back — the workflow would be left with no current Version and the previous one
-- unrecoverable.
--
-- Two store calls cannot fix that, because this runtime owns no transaction
-- helper. A function body is a single transaction, so either both statements land
-- or neither does. That is the whole reason this exists.
--
-- Concurrency: the workflow row is locked FOR UPDATE, so two publications for one
-- workflow serialise. The loser finds the version it meant to supersede already
-- superseded, or collides on the partial unique index, and raises. Exactly one
-- current Version survives either way.
--
-- SECURITY INVOKER, not DEFINER: the caller is service_role, which already has
-- the privileges, and a DEFINER function would add a surface to audit for no gain.
--
-- RE-RUN SAFETY (2026-10-28, migration re-run safety). Later migrations REPLACE
-- this function with a WIDER channel vocabulary (20261231000004 adds
-- `social_post`). Re-running this file after them must never silently narrow the
-- vocabulary. So the installed definition is captured first; after the CREATE
-- below, if the captured vocabulary is a STRICT SUPERSET of this file's, the
-- captured definition is re-installed verbatim (it is the later, wider one). If
-- it is neither a subset nor a superset the migration refuses. The postcondition
-- then requires the installed vocabulary to contain both this file's and the
-- captured one. The scratch state lives in a session-local temporary table.
CREATE TEMP TABLE IF NOT EXISTS wf032_publish_prior (
  prior_def      text,
  prior_channels text[],
  file_channels  text[]
);
TRUNCATE pg_temp.wf032_publish_prior;

DO $$
DECLARE
  v_def text;
  v_ch  text[];
BEGIN
  IF to_regprocedure('public.publish_workflow_version(uuid, uuid, uuid)') IS NULL THEN
    INSERT INTO pg_temp.wf032_publish_prior (prior_def, prior_channels) VALUES (NULL, NULL);
    RETURN;
  END IF;
  v_def := pg_get_functiondef('public.publish_workflow_version(uuid, uuid, uuid)'::regprocedure);
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_ch
    FROM regexp_matches(
           substring(v_def FROM $re$\(s\.value ->> 'channel'\) NOT IN \(([^)]*)\)$re$),
           $re$'([a-z_]+)'$re$, 'g') AS m;
  IF v_ch IS NULL THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032: the installed publish_workflow_version has no readable channel vocabulary; refusing to replace it blindly';
  END IF;
  INSERT INTO pg_temp.wf032_publish_prior (prior_def, prior_channels) VALUES (v_def, v_ch);
END
$$;

CREATE OR REPLACE FUNCTION public.publish_workflow_version(
  p_organization_id uuid,
  p_version_id      uuid,
  p_published_by    uuid
)
-- EVERY OUTPUT NAME IS PREFIXED. A RETURNS TABLE column is an ordinary plpgsql
-- variable inside the body, so naming one `workflow_id` or `version` makes every
-- unqualified reference to the real column ambiguous (42702) — which is exactly
-- what the first T2 run caught.
RETURNS TABLE (
  out_version_id    uuid,
  out_workflow_id   uuid,
  out_version       integer,
  out_superseded_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workflow_id     uuid;
  v_workflow_status text;
  v_status          text;
  v_version         integer;
  v_definition      jsonb;
  v_step_count      integer;
  v_key_count       integer;
  v_superseded      uuid;
BEGIN
  IF p_published_by IS NULL THEN
    RAISE EXCEPTION 'wf_publish:actor_required' USING ERRCODE = '23514';
  END IF;

  -- Lock the WORKFLOW, so publications for one workflow serialise, and read the
  -- version in the same breath so neither can be another tenant's.
  SELECT w.id, w.status, v.status, v.version, v.definition
    INTO v_workflow_id, v_workflow_status, v_status, v_version, v_definition
    FROM public.workflow_versions v
    JOIN public.workflows w
      ON w.id = v.workflow_id AND w.organization_id = v.organization_id
   WHERE v.id = p_version_id
     AND v.organization_id = p_organization_id
     FOR UPDATE OF w;

  IF v_workflow_id IS NULL THEN
    RAISE EXCEPTION 'wf_publish:version_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_workflow_status <> 'active' THEN
    RAISE EXCEPTION 'wf_publish:workflow_not_active' USING ERRCODE = '23514';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'wf_publish:not_draft' USING ERRCODE = '23514';
  END IF;

  -- ── Definition validation. The gate is HERE and not only in the store,
  -- because the store is not the only thing that could ever call this.
  SELECT count(*) INTO v_step_count
    FROM jsonb_array_elements(v_definition -> 'steps');
  IF v_step_count = 0 THEN
    RAISE EXCEPTION 'wf_publish:no_steps' USING ERRCODE = '23514';
  END IF;

  -- Every step needs a non-blank key, a channel from the closed vocabulary and a
  -- non-negative relative delay. `delay_after_previous_hours` is the WHOLE timing
  -- vocabulary of a Version. The vocabulary is WORKFLOW_STEP_CHANNELS in
  -- workflowStore.ts, `internal` included (2026-10-28: without it a validated
  -- internal step could never be published).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_definition -> 'steps') AS s
     WHERE jsonb_typeof(s.value) <> 'object'
        OR jsonb_typeof(s.value -> 'key') <> 'string'
        OR length(btrim(s.value ->> 'key')) = 0
        OR jsonb_typeof(s.value -> 'channel') <> 'string'
        OR (s.value ->> 'channel') NOT IN (
             'email', 'linkedin', 'phone', 'whatsapp', 'sms',
             'github', 'discord', 'slack', 'community', 'content', 'internal')
        OR jsonb_typeof(s.value -> 'delay_after_previous_hours') <> 'number'
        OR (s.value ->> 'delay_after_previous_hours')::numeric < 0
  ) THEN
    RAISE EXCEPTION 'wf_publish:invalid_step' USING ERRCODE = '23514';
  END IF;

  -- Step keys are unique WITHIN the version. Across versions they may repeat:
  -- v1's `intro` and v2's `intro` are different immutable definitions.
  SELECT count(DISTINCT s.value ->> 'key') INTO v_key_count
    FROM jsonb_array_elements(v_definition -> 'steps') AS s;
  IF v_key_count <> v_step_count THEN
    RAISE EXCEPTION 'wf_publish:duplicate_step_key' USING ERRCODE = '23514';
  END IF;

  -- ── Supersede the outgoing current Version FIRST. The partial unique index
  -- leaves no other order available.
  UPDATE public.workflow_versions AS wv
     SET status = 'superseded'
   WHERE wv.organization_id = p_organization_id
     AND wv.workflow_id = v_workflow_id
     AND wv.status = 'published'
  RETURNING wv.id INTO v_superseded;

  -- ── Then publish. If THIS fails the whole function rolls back, which is why
  -- the supersession above is safe despite being irreversible on its own.
  UPDATE public.workflow_versions AS wv
     SET status = 'published',
         published_at = now(),
         published_by = p_published_by
   WHERE wv.id = p_version_id
     AND wv.organization_id = p_organization_id;

  RETURN QUERY SELECT p_version_id, v_workflow_id, v_version, v_superseded;
END
$$;

-- RE-RUN SAFETY: never narrow a wider vocabulary a later migration installed.
DO $$
DECLARE
  v_file  text[];
  v_prior text[];
  v_def   text;
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_file
    FROM regexp_matches(
           substring(pg_get_functiondef('public.publish_workflow_version(uuid, uuid, uuid)'::regprocedure)
                     FROM $re$\(s\.value ->> 'channel'\) NOT IN \(([^)]*)\)$re$),
           $re$'([a-z_]+)'$re$, 'g') AS m;
  IF v_file IS NULL THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032: could not read this file''s channel vocabulary back';
  END IF;
  UPDATE pg_temp.wf032_publish_prior SET file_channels = v_file;
  SELECT prior_def, prior_channels INTO v_def, v_prior FROM pg_temp.wf032_publish_prior;

  IF v_prior IS NULL OR v_prior = v_file THEN
    RETURN;                                  -- first install, or the same vocabulary
  END IF;
  IF v_prior @> v_file THEN
    -- A later migration installed a wider vocabulary: put it back verbatim.
    EXECUTE v_def;
    RAISE NOTICE 'PI-WORKFLOW-DEFINITION-032: kept the installed wider publish_workflow_version vocabulary %', v_prior;
    RETURN;
  END IF;
  IF NOT (v_file @> v_prior) THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032: the installed publish_workflow_version vocabulary % and this file''s % are incomparable; refusing to replace it', v_prior, v_file;
  END IF;
  -- v_file is a strict superset: this file widens an older install. Keep it.
END
$$;

-- The privilege convention 20261026000000 established for every public function.
REVOKE EXECUTE ON FUNCTION public.publish_workflow_version(uuid, uuid, uuid)
  FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.publish_workflow_version(uuid, uuid, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.publish_workflow_version(uuid, uuid, uuid) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.publish_workflow_version(uuid, uuid, uuid) TO service_role';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Tenant isolation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.workflows          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_versions  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'workflows'
       AND policyname = 'workflows_service_role'
  ) THEN
    CREATE POLICY workflows_service_role ON public.workflows
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'workflow_versions'
       AND policyname = 'workflow_versions_service_role'
  ) THEN
    CREATE POLICY workflow_versions_service_role ON public.workflow_versions
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Documentation of the contract.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.workflows IS
  'PI-WORKFLOW-DEFINITION-032. Engine 2''s stable reusable process identity, '
  'tenant-owned. Lifecycle active|archived; archived is historical and queryable '
  'but not usable for new authoring or execution. Carries NO authoring content: '
  'no steps, no timing, no channels, no prospect data, no runtime state. Campaign '
  'and Workflow are orthogonal -- a Workflow belongs to no campaign.';

COMMENT ON TABLE public.workflow_versions IS
  'PI-WORKFLOW-DEFINITION-032. The immutable published process. draft is '
  'editable; publication FREEZES content and is the exact point immutability '
  'begins; superseded and archived are wholly immutable. At most ONE published '
  'version per workflow, enforced by uq_workflow_versions_one_published. THE '
  'CURRENT VERSION IS THE ROW WHERE status = ''published'' -- never MAX(version), '
  'which is a human-facing ordinal only.';

COMMENT ON COLUMN public.workflow_versions.version IS
  'PI-WORKFLOW-DEFINITION-032. A HUMAN-FACING ORDINAL, unique per workflow. NOT '
  'the source of truth for which version is current: a draft may carry a higher '
  'ordinal than the published row, and an archived row may be the highest of all. '
  'Resolve current by the status predicate.';

COMMENT ON COLUMN public.workflow_versions.definition IS
  'PI-WORKFLOW-DEFINITION-032. The authored process: {"steps":[{key, channel, '
  'delay_after_previous_hours, ...}]}. Step keys are durable WITHIN the version '
  '(the version is the immutable container) and deliberately not globally unique. '
  'delay_after_previous_hours is the WHOLE timing vocabulary -- the version states '
  'intent ("wait 48h") and the runtime resolves the timestamp. May carry '
  'personalization INSTRUCTIONS; may never carry a resolved prospect value or any '
  'runtime state.';

COMMENT ON FUNCTION public.publish_workflow_version(uuid, uuid, uuid) IS
  'PI-WORKFLOW-DEFINITION-032. The ATOMIC publication transition: validates, '
  'supersedes the outgoing current version, publishes the incoming one. A function '
  'because the order is forced by the partial unique index and supersession is '
  'irreversible, so the two statements must share a transaction. Locks the '
  'workflow row FOR UPDATE so concurrent publications serialise.';

-- ---------------------------------------------------------------------------
-- 8. Postcondition. A migration that claims a contract should verify it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v text;
        n integer;
        a text[];
        fc text[];
        pc text[];
BEGIN
  -- Column sets, exactly.
  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'workflows';
  IF v IS DISTINCT FROM
     'created_at,created_by,description,id,name,organization_id,status,updated_at' THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032 postcondition: workflows columns are %', v;
  END IF;

  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'workflow_versions';
  IF v IS DISTINCT FROM
     'created_at,created_by,definition,id,organization_id,published_at,'
     'published_by,status,updated_at,version,workflow_id' THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032 postcondition: workflow_versions columns are %', v;
  END IF;

  -- Workflow carries NO authoring content. Named explicitly so a future ALTER
  -- cannot quietly move steps or timing onto the stable identity.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'workflows'
       AND column_name IN ('definition', 'steps', 'timing', 'channel',
                           'delay_after_previous_hours', 'version')
  ) THEN
    RAISE EXCEPTION
      'PI-WORKFLOW-DEFINITION-032 postcondition: authoring content appeared on workflows';
  END IF;

  -- BOTTLENECK 1: the partial unique index, and its predicate.
  SELECT indexdef INTO v FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_workflow_versions_one_published';
  IF v IS NULL THEN
    RAISE EXCEPTION
      'PI-WORKFLOW-DEFINITION-032 postcondition: uq_workflow_versions_one_published is missing — one-published-version is unenforced';
  END IF;
  IF v NOT LIKE '%UNIQUE%' OR v NOT LIKE '%organization_id, workflow_id%'
     OR v NOT LIKE '%status = ''published''%' THEN
    RAISE EXCEPTION
      'PI-WORKFLOW-DEFINITION-032 postcondition: the one-published index is not a partial unique index on (organization_id, workflow_id) WHERE status = published — it is %', v;
  END IF;

  -- There must be NO stored current-version flag: one truth, derived from status.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'workflow_versions'
       AND column_name IN ('is_current', 'current', 'is_published', 'is_latest')
  ) THEN
    RAISE EXCEPTION
      'PI-WORKFLOW-DEFINITION-032 postcondition: a redundant current-version flag appeared';
  END IF;

  -- The companion key the FUTURE Execution Instance will reference.
  IF to_regclass('public.uq_workflow_versions_id_org') IS NULL
  OR to_regclass('public.uq_workflows_id_org') IS NULL THEN
    RAISE EXCEPTION
      'PI-WORKFLOW-DEFINITION-032 postcondition: a companion (id, organization_id) key is missing';
  END IF;

  -- Tenant-safe foreign keys: 1 on workflows, 2 on versions, the workflow one composite.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.workflows'::regclass AND contype = 'f';
  IF n <> 1 THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032 postcondition: workflows has % foreign keys, expected 1', n;
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.workflow_versions'::regclass AND contype = 'f';
  IF n <> 2 THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032 postcondition: workflow_versions has % foreign keys, expected 2', n;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conname = 'workflow_versions_workflow_tenant_fk';
  IF v IS NULL OR v NOT LIKE '%(workflow_id, organization_id)%' THEN
    RAISE EXCEPTION
      'PI-WORKFLOW-DEFINITION-032 postcondition: the Version -> Workflow key is not composite — a cross-tenant version would be representable';
  END IF;

  -- BOTTLENECK 2: the guard exists, and it is NOT an unconditional refusal.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.workflow_versions'::regclass
       AND tgname = 'trg_workflow_versions_guard' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032 postcondition: the version guard is missing';
  END IF;
  SELECT pg_get_functiondef(oid) INTO v FROM pg_proc
   WHERE proname = 'workflow_versions_guard_immutable';
  IF v NOT LIKE '%superseded%' OR v NOT LIKE '%archived%' THEN
    RAISE EXCEPTION
      'PI-WORKFLOW-DEFINITION-032 postcondition: the guard does not permit the published -> superseded/archived transition — an unconditional guard would break publication';
  END IF;

  -- The publication function and its privileges.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'publish_workflow_version') THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032 postcondition: publish_workflow_version is missing';
  END IF;

  -- Re-run safety: the INSTALLED vocabulary contains this file's AND whatever
  -- was installed before this run (a re-run never narrows a later migration).
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO a
    FROM regexp_matches(
           substring(pg_get_functiondef('public.publish_workflow_version(uuid, uuid, uuid)'::regprocedure)
                     FROM $re$\(s\.value ->> 'channel'\) NOT IN \(([^)]*)\)$re$),
           $re$'([a-z_]+)'$re$, 'g') AS m;
  SELECT file_channels, prior_channels INTO fc, pc FROM pg_temp.wf032_publish_prior;
  IF a IS NULL OR fc IS NULL OR NOT (a @> fc) THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032 postcondition: publish_workflow_version accepts % — this file''s vocabulary % is not all accepted', a, fc;
  END IF;
  IF pc IS NOT NULL AND NOT (a @> pc) THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032 postcondition: re-running narrowed publish_workflow_version from % to %', pc, a;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.workflows'::regclass)
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.workflow_versions'::regclass) THEN
    RAISE EXCEPTION 'PI-WORKFLOW-DEFINITION-032 postcondition: RLS is not enabled';
  END IF;

  -- ── THE NEIGHBOURS 032 MAY NOT TOUCH ──
  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO v
    FROM pg_index i
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indexrelid = 'public.outreach_tasks_identity_unique'::regclass;
  IF v IS DISTINCT FROM 'company_id,lead_id,plan_task_id' THEN
    RAISE EXCEPTION
      'PI-WORKFLOW-DEFINITION-032 postcondition: the outreach task identity changed to % — 032 must not touch it', v;
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO v
    FROM pg_index i
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indexrelid = 'public.uq_prospect_icp_versions_one_ratified'::regclass;
  IF v IS DISTINCT FROM 'organization_id,icp_id' THEN
    RAISE EXCEPTION
      'PI-WORKFLOW-DEFINITION-032 postcondition: the ICP one-ratified invariant changed to % — 032 must not touch it', v;
  END IF;
END
$$;

-- Session-local scratch state of the re-run guard above.
DROP TABLE IF EXISTS pg_temp.wf032_publish_prior;
