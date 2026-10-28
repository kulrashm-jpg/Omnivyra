-- ===========================================================================
-- Orchestration — the community journey link.
--
-- WHAT THIS ADDS
--   ONE identity-only table, `community_action_journey_links`: which EXISTING
--   `community_ai_actions` row one orchestration execution task executes. It is
--   the interface the community adapter's `CommunityActionBinding` reads
--   (backend/services/orchestration/communityEngineAdapter.ts). Nothing else.
--
--   execution_tasks (channel 'community')
--        ↓ 1:1
--   community_action_journey_links      ← this migration
--        ↓ 1:1
--   community_ai_actions (engine-owned, untouched apart from a companion key)
--
-- ─── WHY A LINK TABLE, NOT A COLUMN ON community_ai_actions ───────────────
--   community_ai_actions is the engine's row: its status lifecycle, leases and
--   command chain have many writers (approve/execute routes, scheduler, extension
--   callbacks, reapers) and a concurrent workstream owns its status semantics. A
--   nullable `execution_task_id` there would put orchestration identity on a row
--   those writers update, could not carry a composite tenant FK to the task
--   without the same companion key anyway, and would make "one task per action"
--   a partial unique index on a hot engine table. The precedent is
--   outreach_bridge_handoffs (20261229000000): identity in a separate,
--   immutable mapping keyed by execution_task_id.
--
-- ─── WHAT IT IS NOT ───────────────────────────────────────────────────────
--   Not a second action ledger: NO status, platform, action type, target or text
--   is copied here — the engine's row is the only record of the action. Not an
--   approval path: an action is executed only once a person approved it through
--   the existing approve route (APPROVE_ACTIONS); linking approves nothing. Not a
--   producer: nothing here drafts an action.
--
-- ─── INVARIANTS (database-enforced) ───────────────────────────────────────
--   tenant       composite FKs (task, org) and (action, org); the guard also
--                requires the action's tenant_id = organization_id.
--   uniqueness   one action per task, one task per action.
--   immutability a link is never re-pointed (UPDATE refused).
--   eligibility  at link time: task channel 'community', task 'prepared', run
--                executable, action type one the adapter performs
--                (SUPPORTED_COMMUNITY_ACTIONS keys), action not yet executing or
--                ended (pending | approved).
--
-- Does NOT touch community_ai_actions.status or its CHECK (owned by
-- 20261231000002). Additive only. NOT applied anywhere yet. ROLLBACK:
-- supabase/migrations/rollbacks/community_journey_link_rollback.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preconditions.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.execution_tasks') IS NULL
  OR to_regclass('public.execution_instances') IS NULL THEN
    RAISE EXCEPTION 'community journey link: the execution substrate (20261228*) is missing';
  END IF;
  IF to_regclass('public.uq_execution_tasks_id_org') IS NULL THEN
    RAISE EXCEPTION 'community journey link: uq_execution_tasks_id_org is missing — 20261229000000 must be applied first';
  END IF;
  IF to_regclass('public.community_ai_actions') IS NULL THEN
    RAISE EXCEPTION 'community journey link: community_ai_actions is missing';
  END IF;
  IF to_regclass('public.execution_engine_requests') IS NULL THEN
    RAISE EXCEPTION 'community journey link: execution_engine_requests (20261230000000) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
       AND column_name = 'organization_id' AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'community journey link: community_ai_actions.organization_id is not uuid';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Companion key for a tenant-safe composite reference to an action.
-- ---------------------------------------------------------------------------
-- `id` is already the primary key, so this can never reject an existing row; it
-- only lets (community_action_id, organization_id) be a foreign key. ADDITIVE:
-- no column, constraint or status semantics of the engine's table change.
CREATE UNIQUE INDEX IF NOT EXISTS uq_community_ai_actions_id_org
  ON public.community_ai_actions (id, organization_id);

-- ---------------------------------------------------------------------------
-- 2. The link — identity only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_action_journey_links (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  execution_task_id      uuid        NOT NULL,
  -- The task's run, recorded so a run's links are listable; proven by the guard.
  execution_instance_id  uuid        NOT NULL,
  community_action_id    uuid        NOT NULL,
  -- Who asserted the link (the authenticated principal). Audit only.
  linked_by              text,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT community_action_journey_links_linked_by_length
    CHECK (linked_by IS NULL OR length(linked_by) BETWEEN 1 AND 200),

  -- IDEMPOTENCY / EXCLUSIVITY. The database is the arbiter.
  CONSTRAINT community_action_journey_links_task_unique
    UNIQUE (organization_id, execution_task_id),
  CONSTRAINT community_action_journey_links_action_unique
    UNIQUE (organization_id, community_action_id),

  CONSTRAINT community_action_journey_links_org_fk
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT community_action_journey_links_task_fk
    FOREIGN KEY (execution_task_id, organization_id)
    REFERENCES public.execution_tasks (id, organization_id) ON DELETE NO ACTION,
  CONSTRAINT community_action_journey_links_action_fk
    FOREIGN KEY (community_action_id, organization_id)
    REFERENCES public.community_ai_actions (id, organization_id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS ix_community_action_journey_links_instance
  ON public.community_action_journey_links (organization_id, execution_instance_id);

ALTER TABLE public.community_action_journey_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS community_action_journey_links_service_role ON public.community_action_journey_links;
CREATE POLICY community_action_journey_links_service_role ON public.community_action_journey_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.community_action_journey_links FROM anon, authenticated;

COMMENT ON TABLE public.community_action_journey_links IS
  'Orchestration: which existing community_ai_actions row one execution task executes. Identity only; no status or content.';

-- ---------------------------------------------------------------------------
-- 3. Guard — immutable, and eligible at link time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.community_action_journey_links_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task   record;
  v_action record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'cajl:immutable — link % is never re-pointed', OLD.id USING ERRCODE = '23514';
  END IF;

  SELECT t.execution_instance_id, t.channel, t.state, i.lifecycle_state
    INTO v_task
    FROM public.execution_tasks t
    JOIN public.execution_instances i
      ON i.id = t.execution_instance_id AND i.organization_id = t.organization_id
   WHERE t.id = NEW.execution_task_id AND t.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cajl:task_not_found' USING ERRCODE = '23514';
  END IF;
  IF NEW.execution_instance_id IS DISTINCT FROM v_task.execution_instance_id THEN
    RAISE EXCEPTION 'cajl:instance_mismatch' USING ERRCODE = '23514';
  END IF;
  IF v_task.channel IS DISTINCT FROM 'community' THEN
    RAISE EXCEPTION 'cajl:task_not_community' USING ERRCODE = '23514';
  END IF;
  IF v_task.state IS DISTINCT FROM 'prepared' THEN
    RAISE EXCEPTION 'cajl:task_not_prepared' USING ERRCODE = '23514';
  END IF;
  IF v_task.lifecycle_state NOT IN ('created', 'queued', 'active') THEN
    RAISE EXCEPTION 'cajl:run_not_executable' USING ERRCODE = '23514';
  END IF;

  SELECT a.tenant_id, a.organization_id, a.action_type, a.status
    INTO v_action
    FROM public.community_ai_actions a
   WHERE a.id = NEW.community_action_id AND a.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cajl:action_not_found' USING ERRCODE = '23514';
  END IF;
  IF v_action.tenant_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'cajl:cross_tenant' USING ERRCODE = '23514';
  END IF;
  -- Mirrors Object.keys(SUPPORTED_COMMUNITY_ACTIONS); kept in step by
  -- orchestrationCommunityJourneyLink.test.ts. Platform pairing, DM addressing
  -- and reply text are checked by the adapter's classifier, at link time by the
  -- store and again at execution time.
  IF v_action.action_type IS NULL
     OR v_action.action_type NOT IN ('reply', 'like', 'share', 'follow', 'dm') THEN
    RAISE EXCEPTION 'cajl:unsupported_action_type' USING ERRCODE = '23514';
  END IF;
  IF v_action.status IS NULL OR v_action.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'cajl:action_not_linkable' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_community_action_journey_links_guard ON public.community_action_journey_links;
CREATE TRIGGER trg_community_action_journey_links_guard
  BEFORE INSERT OR UPDATE ON public.community_action_journey_links
  FOR EACH ROW EXECUTE FUNCTION public.community_action_journey_links_guard();

-- ---------------------------------------------------------------------------
-- 4. Postconditions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.community_action_journey_links'::regclass
       AND conname = 'community_action_journey_links_task_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'community journey link postcondition: one action per task is unenforced';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.community_action_journey_links'::regclass
       AND conname = 'community_action_journey_links_action_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'community journey link postcondition: one task per action is unenforced';
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.community_action_journey_links'::regclass AND contype = 'f';
  IF n <> 3 THEN
    RAISE EXCEPTION 'community journey link postcondition: % foreign keys, expected 3', n;
  END IF;

  -- No second ledger: no lifecycle or content column leaked in.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'community_action_journey_links'
     AND column_name IN ('status', 'state', 'platform', 'action_type', 'target_id',
                         'suggested_text', 'final_text', 'approved_at', 'executed_at',
                         'execution_result');
  IF n > 0 THEN
    RAISE EXCEPTION 'community journey link postcondition: % lifecycle/content column(s) leaked into the link', n;
  END IF;

  SELECT count(*) INTO n FROM pg_class
   WHERE oid = 'public.community_action_journey_links'::regclass AND relrowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'community journey link postcondition: RLS is not enabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE NOT tgisinternal AND tgname = 'trg_community_action_journey_links_guard'
       AND tgrelid = 'public.community_action_journey_links'::regclass
  ) THEN
    RAISE EXCEPTION 'community journey link postcondition: the guard is missing';
  END IF;

  -- The engine request ledger is untouched: one request per task still holds.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_engine_requests'::regclass
       AND conname = 'execution_engine_requests_task_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'community journey link postcondition: the engine request ledger lost its per-task uniqueness';
  END IF;
END $$;
