-- Orchestration — campaign targeting on the CANONICAL lists model.
--
-- WHAT THIS ADDS (additive; NOT applied anywhere yet)
--   1. prospect_lists.icp_id           — optional. NULL = a manual/intake list;
--                                        set = an ICP list the evaluator maintains.
--   2. prospect_campaigns targeting    — `manual` or `icp`; an ICP campaign is
--                                        pinned to ONE RATIFIED ICP version.
--   3. prospect_campaign_lists         — campaign × list attachment (detach = delete).
--   4. prospect_campaign_targets       — immutable selection facts: "campaign C
--                                        selected prospect P from list L in
--                                        occurrence K".
--   5. execution_instances_target_tenant_fk — the foreign key deferred by
--                                        20261228000000 until this table existed.
--
-- ─── CANONICAL, NOT COMPETING ─────────────────────────────────────────────
-- Lists are LISTS-001 (20261127000000: prospect_lists / prospect_list_members,
-- removal history kept as rows). Targets reference canonical_leads, ICPs are
-- prospect_icps / prospect_icp_versions (D1), score evidence is
-- prospect_score_evaluations (PI). No second list, campaign, contact, ICP,
-- qualification or outcome store is created. The parked pi-consol lists
-- migrations (20261104/20261105) are NOT ported; their evaluator and selection
-- semantics are reimplemented on these tables.
--
-- ─── FOREIGN-KEY SEMANTICS (mirroring the ratified parked design) ─────────
--   target → prospect          ON DELETE CASCADE  (erasure flows through)
--   target → campaign / list   NO ACTION          (a selection fact is history)
--   target → ICP version       NO ACTION
--   target → score evaluation  NO ACTION          (provenance is never nulled)
--   campaign_list → campaign / list  CASCADE      (an attachment is not history)
--   execution instance → target      NO ACTION
--
-- ROLLBACK: supabase/migrations/rollbacks/orchestration_campaign_targeting_rollback.sql

DO $$
BEGIN
  IF to_regclass('public.prospect_lists') IS NULL OR to_regclass('public.prospect_list_members') IS NULL THEN
    RAISE EXCEPTION 'orchestration targeting: the canonical lists (20261127000000) are absent';
  END IF;
  IF to_regclass('public.prospect_campaigns') IS NULL THEN
    RAISE EXCEPTION 'orchestration targeting: prospect_campaigns (20261226000000) is absent';
  END IF;
  IF to_regclass('public.execution_instances') IS NULL THEN
    RAISE EXCEPTION 'orchestration targeting: execution_instances (20261228000000) is absent';
  END IF;
  IF to_regclass('public.prospect_icp_versions') IS NULL OR to_regclass('public.prospect_score_evaluations') IS NULL THEN
    RAISE EXCEPTION 'orchestration targeting: the ICP model (20261012) or score evaluations (20261031) are absent';
  END IF;
  IF to_regclass('public.uq_prospect_lists_id_org') IS NULL
  OR to_regclass('public.uq_prospect_campaigns_id_org') IS NULL
  OR to_regclass('public.uq_prospect_icps_id_org') IS NULL
  OR to_regclass('public.uq_prospect_icp_versions_identity') IS NULL
  OR to_regclass('public.uq_prospect_score_evaluations_id_org') IS NULL
  OR to_regclass('public.idx_canonical_leads_id_company') IS NULL THEN
    RAISE EXCEPTION 'orchestration targeting: a companion tenant key is missing — tenant-safe foreign keys cannot be created';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. An OPTIONAL ICP on a list.
-- ---------------------------------------------------------------------------
ALTER TABLE public.prospect_lists ADD COLUMN IF NOT EXISTS icp_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_lists_icp_tenant_fk') THEN
    ALTER TABLE public.prospect_lists
      ADD CONSTRAINT prospect_lists_icp_tenant_fk
      FOREIGN KEY (icp_id, organization_id)
      REFERENCES public.prospect_icps (id, organization_id) ON DELETE NO ACTION;
  END IF;
END
$$;

COMMENT ON COLUMN public.prospect_lists.icp_id IS
  'NULL: a manual or intake list (members are added and removed by people or intake). Set: an ICP list whose membership the evaluator maintains from PI score evaluations under that ICP.';

-- ---------------------------------------------------------------------------
-- 2. Campaign targeting: manual, or pinned to one RATIFIED ICP version.
-- ---------------------------------------------------------------------------
ALTER TABLE public.prospect_campaigns
  ADD COLUMN IF NOT EXISTS targeting_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS icp_id         uuid,
  ADD COLUMN IF NOT EXISTS icp_version    integer,
  ADD COLUMN IF NOT EXISTS min_icp_score  double precision;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_campaigns_targeting_mode_valid') THEN
    ALTER TABLE public.prospect_campaigns
      ADD CONSTRAINT prospect_campaigns_targeting_mode_valid CHECK (targeting_mode IN ('manual', 'icp'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_campaigns_targeting_coherent') THEN
    -- A manual campaign names no ICP; an ICP campaign names exactly one version.
    ALTER TABLE public.prospect_campaigns
      ADD CONSTRAINT prospect_campaigns_targeting_coherent CHECK (
        (targeting_mode = 'manual' AND icp_id IS NULL AND icp_version IS NULL AND min_icp_score IS NULL)
        OR (targeting_mode = 'icp' AND icp_id IS NOT NULL AND icp_version IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_campaigns_min_icp_score_range') THEN
    ALTER TABLE public.prospect_campaigns
      ADD CONSTRAINT prospect_campaigns_min_icp_score_range
      CHECK (min_icp_score IS NULL OR (min_icp_score >= 0 AND min_icp_score <= 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_campaigns_icp_version_tenant_fk') THEN
    -- Tenant-safe: the tenant travels INTO the key, so a campaign can never cite
    -- another tenant's ICP version even if the ids were guessed.
    ALTER TABLE public.prospect_campaigns
      ADD CONSTRAINT prospect_campaigns_icp_version_tenant_fk
      FOREIGN KEY (organization_id, icp_id, icp_version)
      REFERENCES public.prospect_icp_versions (organization_id, icp_id, version) ON DELETE NO ACTION;
  END IF;
END
$$;

-- An ICP campaign may only be pinned to a RATIFIED version (a draft or proposed
-- ICP is not an authority), and its targeting is frozen once it has selected
-- anyone: the targets already recorded were chosen under that targeting.
CREATE OR REPLACE FUNCTION public.prospect_campaigns_targeting_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.targeting_mode IS DISTINCT FROM OLD.targeting_mode
          OR NEW.icp_id IS DISTINCT FROM OLD.icp_id
          OR NEW.icp_version IS DISTINCT FROM OLD.icp_version
          OR NEW.min_icp_score IS DISTINCT FROM OLD.min_icp_score)
     AND to_regclass('public.prospect_campaign_targets') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.prospect_campaign_targets t
                  WHERE t.organization_id = OLD.organization_id AND t.campaign_id = OLD.id) THEN
    RAISE EXCEPTION 'campaign_targeting_locked: this campaign has selected targets under its current targeting'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.targeting_mode = 'icp'
     AND (TG_OP = 'INSERT' OR NEW.icp_id IS DISTINCT FROM OLD.icp_id OR NEW.icp_version IS DISTINCT FROM OLD.icp_version) THEN
    SELECT v.status INTO v_status FROM public.prospect_icp_versions v
     WHERE v.organization_id = NEW.organization_id AND v.icp_id = NEW.icp_id AND v.version = NEW.icp_version;
    -- This trigger runs BEFORE the foreign key is checked: a version that does not
    -- exist in THIS tenant (missing, or another tenant's) is a missing reference,
    -- not an unratified one. Same SQLSTATE as the FK, so callers see one answer.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'campaign_icp_version_not_found: no such ICP version in this tenant'
        USING ERRCODE = '23503';
    END IF;
    IF v_status IS DISTINCT FROM 'ratified' THEN
      RAISE EXCEPTION 'campaign_icp_not_ratified: an ICP campaign must be pinned to a ratified ICP version'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_prospect_campaigns_targeting_guard ON public.prospect_campaigns;
CREATE TRIGGER trg_prospect_campaigns_targeting_guard
  BEFORE INSERT OR UPDATE ON public.prospect_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.prospect_campaigns_targeting_guard();

-- ---------------------------------------------------------------------------
-- 3. Campaign × list attachment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_campaign_lists (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  campaign_id      uuid        NOT NULL,
  list_id          uuid        NOT NULL,
  attached_by      uuid,
  attached_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_campaign_lists_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT prospect_campaign_lists_campaign_tenant_fk
    FOREIGN KEY (campaign_id, organization_id)
    REFERENCES public.prospect_campaigns (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT prospect_campaign_lists_list_tenant_fk
    FOREIGN KEY (list_id, organization_id)
    REFERENCES public.prospect_lists (id, organization_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_campaign_lists_identity
  ON public.prospect_campaign_lists (organization_id, campaign_id, list_id);

ALTER TABLE public.prospect_campaign_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospect_campaign_lists_service_role ON public.prospect_campaign_lists;
CREATE POLICY prospect_campaign_lists_service_role ON public.prospect_campaign_lists
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.prospect_campaign_lists FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Campaign targets — immutable selection facts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_campaign_targets (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL,
  campaign_id          uuid        NOT NULL,
  list_id              uuid        NOT NULL,
  prospect_id          uuid        NOT NULL,

  -- The selection OCCURRENCE, supplied by the caller: a retry of the same
  -- occurrence collides (idempotent); a deliberate re-selection uses a new key.
  selection_event_key  text        NOT NULL,
  selected_at          timestamptz NOT NULL DEFAULT now(),
  origin               text        NOT NULL,
  actor_user_id        uuid,

  -- The ICP authority the prospect was selected under (ICP campaigns only),
  -- and the PI score evaluation that qualified them. NULL for manual campaigns.
  icp_id               uuid,
  icp_version          integer,
  score_evaluation_id  uuid,

  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_campaign_targets_origin_valid
    CHECK (origin IN ('human', 'derived')),
  CONSTRAINT prospect_campaign_targets_origin_actor
    CHECK ((origin = 'human' AND actor_user_id IS NOT NULL)
        OR (origin = 'derived' AND actor_user_id IS NULL)),
  CONSTRAINT prospect_campaign_targets_event_key_shape
    CHECK (selection_event_key ~ '^(human|derived):[A-Za-z0-9._-]{1,200}$'),
  CONSTRAINT prospect_campaign_targets_event_key_origin
    CHECK (left(selection_event_key, length(origin) + 1) = origin || ':'),
  CONSTRAINT prospect_campaign_targets_icp_coherent
    CHECK ((icp_id IS NULL) = (icp_version IS NULL)
       AND (score_evaluation_id IS NULL OR icp_id IS NOT NULL)),

  CONSTRAINT prospect_campaign_targets_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT prospect_campaign_targets_campaign_tenant_fk
    FOREIGN KEY (campaign_id, organization_id)
    REFERENCES public.prospect_campaigns (id, organization_id) ON DELETE NO ACTION,
  CONSTRAINT prospect_campaign_targets_list_tenant_fk
    FOREIGN KEY (list_id, organization_id)
    REFERENCES public.prospect_lists (id, organization_id) ON DELETE NO ACTION,
  CONSTRAINT prospect_campaign_targets_prospect_tenant_fk
    FOREIGN KEY (prospect_id, organization_id)
    REFERENCES public.canonical_leads (id, company_id) ON DELETE CASCADE,
  CONSTRAINT prospect_campaign_targets_icp_version_tenant_fk
    FOREIGN KEY (organization_id, icp_id, icp_version)
    REFERENCES public.prospect_icp_versions (organization_id, icp_id, version) ON DELETE NO ACTION,
  CONSTRAINT prospect_campaign_targets_score_evaluation_tenant_fk
    FOREIGN KEY (score_evaluation_id, organization_id)
    REFERENCES public.prospect_score_evaluations (id, organization_id) ON DELETE NO ACTION
);

-- The idempotency guarantee: one Target per (campaign, list, prospect, occurrence).
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_campaign_targets_selection
  ON public.prospect_campaign_targets (organization_id, campaign_id, list_id, prospect_id, selection_event_key);

-- Companion key for the execution-instance reference below.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_campaign_targets_id_org
  ON public.prospect_campaign_targets (id, organization_id);

CREATE INDEX IF NOT EXISTS ix_prospect_campaign_targets_campaign
  ON public.prospect_campaign_targets (organization_id, campaign_id, selected_at);

-- A selection fact is history: UPDATE is refused outright. DELETE is NOT blocked
-- here, deliberately: a prospect's erasure must remove it through the CASCADE.
-- No application code deletes a target (the target store has no delete), and
-- anon/authenticated hold no privilege at all; service_role bypasses RLS, so the
-- policies below document intent rather than enforce it against that role.
CREATE OR REPLACE FUNCTION public.prospect_campaign_targets_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prospect_campaign_targets: a selection fact is immutable' USING ERRCODE = '23514';
END
$$;

DROP TRIGGER IF EXISTS trg_prospect_campaign_targets_guard ON public.prospect_campaign_targets;
CREATE TRIGGER trg_prospect_campaign_targets_guard
  BEFORE UPDATE ON public.prospect_campaign_targets
  FOR EACH ROW EXECUTE FUNCTION public.prospect_campaign_targets_guard();

ALTER TABLE public.prospect_campaign_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospect_campaign_targets_service_role ON public.prospect_campaign_targets;
CREATE POLICY prospect_campaign_targets_service_role ON public.prospect_campaign_targets
  FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS prospect_campaign_targets_service_role_insert ON public.prospect_campaign_targets;
CREATE POLICY prospect_campaign_targets_service_role_insert ON public.prospect_campaign_targets
  FOR INSERT TO service_role WITH CHECK (true);
REVOKE ALL ON public.prospect_campaign_targets FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The deferred foreign key from 20261228000000, now that targets exist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'execution_instances_target_tenant_fk') THEN
    ALTER TABLE public.execution_instances
      ADD CONSTRAINT execution_instances_target_tenant_fk
      FOREIGN KEY (target_id, organization_id)
      REFERENCES public.prospect_campaign_targets (id, organization_id) ON DELETE NO ACTION;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.execution_instances'::regclass AND contype = 'f';
  IF n <> 5 THEN
    RAISE EXCEPTION 'orchestration targeting postcondition: execution_instances has % foreign keys, expected 5', n;
  END IF;
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.prospect_campaign_targets'::regclass AND contype = 'f';
  IF n <> 6 THEN
    RAISE EXCEPTION 'orchestration targeting postcondition: prospect_campaign_targets has % foreign keys, expected 6', n;
  END IF;
  IF to_regclass('public.uq_prospect_campaign_targets_selection') IS NULL THEN
    RAISE EXCEPTION 'orchestration targeting postcondition: the selection uniqueness is missing — selection would not be idempotent';
  END IF;
  -- No list-membership table other than the canonical one may exist.
  IF to_regclass('public.prospect_list_memberships') IS NOT NULL THEN
    RAISE EXCEPTION 'orchestration targeting postcondition: a competing prospect_list_memberships table exists';
  END IF;
END
$$;
