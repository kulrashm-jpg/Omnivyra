-- PI-CAMPAIGN-IDENTITY-014 — the canonical Prospect Campaign.
--
-- WHAT THIS ADDS
--   One table, `prospect_campaigns`, and nothing else.
--
-- ─── WHY A NEW ENTITY AND NOT AN EXISTING ONE ─────────────────────────────
-- PI-CAMPAIGN-CONTEXT-013 established both candidates are something else:
--
--   `campaigns`      — the CONTENT/social campaign. Its columns say so:
--                      virality_playbook_id, weekly_themes, source_blog_type,
--                      thread_id, duration_weeks, scheduler_lock_id. 27 live
--                      rows in production. Untouched here; no column is added
--                      to it, and no foreign key bridges the two.
--   `gtm_campaigns`  — a GTM STRATEGY artifact whose own service states it
--                      "RECOMMENDS and SIMULATES only. It sends nothing". It
--                      carries ONE nullable `audience_id` with no foreign key
--                      and no tenant-safe key, and its `company_id` is `text`.
--                      It targets through `audience_memberships.entity_id`,
--                      the source-scoped legacy identity that 010 replaced.
--                      Untouched here, and not converted.
--
-- Reusing either would have meant inheriting a legacy identity model or
-- conflating content/strategy with prospect execution. So: a new entity.
--
-- ─── NO `offering_id`, AND THAT IS A DECISION, NOT AN OMISSION ─────────────
-- §2 asked whether the campaign itself carries commercial context. Nothing in
-- the repository requires it:
--   • No campaign-like entity models an Offering. `gtm_campaigns` has
--     `objective` (free text) and `audience_id`; `campaigns` has none.
--   • 010A ruled Offering is commercial CONTEXT, not a prospect qualification
--     dimension, and put it on the LIST — where a composite foreign key already
--     forces it to target that list's ICP (`prospect_lists_offering_targets_icp_fk`).
--   • 013 established a campaign may span SEVERAL lists, whose Offerings can
--     differ. A campaign-level Offering would then either contradict the list's
--     or duplicate it, and nothing could say which one governed a contact.
--   • The Offering stays derivable where it is already true: the future
--     campaign target carries `list_id`, and list → Offering is DB-enforced.
-- Adding it later is additive. Adding it now would assert a commercial
-- semantics no product requirement has defined. OMITTED.
--
-- ─── NO `list_id` AND NO `icp_id`, FOR THE SAME REASON ────────────────────
-- A campaign is not known to have exactly one list (013) and the platform
-- deliberately supports one prospect across MANY ICPs (006's fan-out). Putting
-- either column here would collapse that at the schema level. The future
-- `campaign_targets` owns those relationships.
--
-- ─── STATUS: THE SMALLEST VOCABULARY, AND WHY THESE THREE ─────────────────
--   draft     — DEFAULT. Created, defined, targeting nobody.
--   active    — the definition is settled. It does NOT mean anything executes.
--   archived  — retired. There is no DELETE, matching `prospect_lists`.
--
-- `draft`/`active`/`archived` are words this repository already uses:
-- `gtm_campaigns` CHECKs draft|active|paused|completed|archived, and every PI
-- table uses active|archived with archival in place of deletion. `paused` and
-- `completed` are deliberately NOT included: both describe an execution
-- lifecycle, and no execution exists to define them. Widening this CHECK later
-- is additive; shipping those two now would assert a state machine nobody has
-- designed.
--
-- INERTNESS IS STRUCTURAL, NOT A STATUS CONVENTION. A campaign row cannot
-- cause outreach because there is no target table, no task writer reachable
-- from here, and no column referencing a list, a prospect, a person or a task.
-- `active` is therefore safe: it asserts nothing about execution.
--
-- ─── BUILT FOR THE TARGET THAT COMES NEXT ─────────────────────────────────
-- `uq_prospect_campaigns_id_org` publishes `(id, organization_id)` so a future
-- `campaign_targets` can carry the PI composite tenant-safe foreign key
--   FOREIGN KEY (campaign_id, organization_id)
--     REFERENCES public.prospect_campaigns (id, organization_id)
-- making a cross-tenant target unrepresentable rather than check-guarded. That
-- index is the whole reason this workstream exists separately.
--
-- ─── DEPENDS ON `companies` ALONE ─────────────────────────────────────────
-- §19: this migration assumes NO prior PI migration. It references only
-- `public.companies (id)`, so it replays independently of 20261101–20261105 and
-- in any order relative to them. Omitting `offering_id` is what makes that true.
--
-- NOT TOUCHED: campaigns, gtm_campaigns, audiences, audience_memberships,
-- prospect_lists, prospect_list_memberships, prospect_icps,
-- prospect_icp_qualifications, prospect_score_evaluations, offerings,
-- canonical_leads, unified_persons, outreach_tasks, outreach_outcomes and every
-- other table. No column is added, dropped, renamed or retyped anywhere else.

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION
      'PI-CAMPAIGN-IDENTITY-014: public.companies is absent — the tenant root must exist first';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.prospect_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,

  name             text NOT NULL,
  description      text,
  status           text NOT NULL DEFAULT 'draft',

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_campaigns_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT prospect_campaigns_status_valid
    CHECK (status IN ('draft', 'active', 'archived')),

  CONSTRAINT prospect_campaigns_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE
);

-- The companion key a future `campaign_targets` references. Not optional: it is
-- what lets the next workstream be tenant-safe by construction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_campaigns_id_org
  ON public.prospect_campaigns (id, organization_id);

-- "This tenant's campaigns", the only read the API performs.
CREATE INDEX IF NOT EXISTS idx_prospect_campaigns_org_status
  ON public.prospect_campaigns (organization_id, status);

-- ── Guard ───────────────────────────────────────────────────────────────────
-- Re-pointing a campaign's tenant would rewrite what every future target and
-- every eventual outcome attributed to it means. `name`, `description` and
-- `status` stay mutable: those are edits.
CREATE OR REPLACE FUNCTION public.prospect_campaigns_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'prospect_campaigns.organization_id is immutable (campaign %)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_prospect_campaigns_guard ON public.prospect_campaigns;
CREATE TRIGGER trg_prospect_campaigns_guard
  BEFORE UPDATE ON public.prospect_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.prospect_campaigns_guard();

-- ── TENANT ISOLATION ────────────────────────────────────────────────────────
-- Service-role only, matching every PI table since
-- 20261026000000_close_anon_rls_exposure.
ALTER TABLE public.prospect_campaigns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'prospect_campaigns'
      AND policyname = 'prospect_campaigns_service_role'
  ) THEN
    CREATE POLICY prospect_campaigns_service_role ON public.prospect_campaigns
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

COMMENT ON TABLE public.prospect_campaigns IS
  'PI-CAMPAIGN-IDENTITY-014. The canonical tenant-owned Prospect Campaign: an '
  'execution INITIATIVE identity and nothing more. It names no list, ICP, '
  'Offering, prospect, person or task, so it cannot cause outreach. Distinct '
  'from `campaigns` (content/social) and `gtm_campaigns` (strategy/simulation); '
  'neither is referenced. Publishes (id, organization_id) for the composite '
  'tenant-safe foreign key a future campaign_targets will carry.';

COMMENT ON COLUMN public.prospect_campaigns.status IS
  'draft (default) | active | archived. `active` means the definition is '
  'settled, NOT that anything executes — inertness is structural, not a status '
  'convention. `paused`/`completed` are deliberately absent until an execution '
  'lifecycle defines them.';

-- Postcondition. A migration that claims a contract should verify it.
DO $$
DECLARE v text;
BEGIN
  IF to_regclass('public.prospect_campaigns') IS NULL THEN
    RAISE EXCEPTION 'PI-CAMPAIGN-IDENTITY-014 postcondition: the table was not created';
  END IF;

  -- Exactly the agreed column set: no list, ICP, Offering, prospect or task leaked in.
  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'prospect_campaigns';
  -- A re-run after 20261231000000 sees exactly its four targeting columns too —
  -- and only when that migration's own constraint proves it ran.
  IF v IS DISTINCT FROM 'created_at,description,id,name,organization_id,status,updated_at'
     AND NOT (v = 'created_at,description,icp_id,icp_version,id,min_icp_score,name,organization_id,status,targeting_mode,updated_at'
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_campaigns_targeting_mode_valid')) THEN
    RAISE EXCEPTION 'PI-CAMPAIGN-IDENTITY-014 postcondition: unexpected column set %', v;
  END IF;

  -- The companion key the next workstream depends on.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.prospect_campaigns'::regclass
       AND i.indisunique
       AND i.indexrelid = 'public.uq_prospect_campaigns_id_org'::regclass
  ) THEN
    RAISE EXCEPTION 'PI-CAMPAIGN-IDENTITY-014 postcondition: (id, organization_id) is not unique';
  END IF;

  -- One foreign key, to the tenant root, and no other.
  SELECT string_agg(conname, ',' ORDER BY conname) INTO v
    FROM pg_constraint
   WHERE conrelid = 'public.prospect_campaigns'::regclass AND contype = 'f';
  -- (20261231000000 adds the tenant-bound ICP-version reference of an ICP campaign.)
  IF v IS DISTINCT FROM 'prospect_campaigns_organization_id_fkey'
     AND v IS DISTINCT FROM 'prospect_campaigns_icp_version_tenant_fk,prospect_campaigns_organization_id_fkey' THEN
    RAISE EXCEPTION
      'PI-CAMPAIGN-IDENTITY-014 postcondition: foreign keys are % — the campaign must reference the tenant and nothing else', v;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.prospect_campaigns'::regclass) THEN
    RAISE EXCEPTION 'PI-CAMPAIGN-IDENTITY-014 postcondition: RLS is not enabled';
  END IF;

  -- Nothing may reference the content or strategy campaign tables.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.prospect_campaigns'::regclass
       AND contype = 'f'
       AND confrelid IN (
         COALESCE(to_regclass('public.campaigns'), 0::oid),
         COALESCE(to_regclass('public.gtm_campaigns'), 0::oid),
         COALESCE(to_regclass('public.audiences'), 0::oid))
  ) THEN
    RAISE EXCEPTION
      'PI-CAMPAIGN-IDENTITY-014 postcondition: a bridge to the content/strategy/legacy campaign model was created';
  END IF;
END
$$;
