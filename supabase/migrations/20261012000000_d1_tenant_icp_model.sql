-- D1 — the tenant-owned, versioned, ratifiable Ideal Customer Profile.
--
-- WHY. The platform scores leads against an "ICP" today and has no ICP. What
-- exists is:
--
--   * `company_profiles.ideal_customer_profile` — free text, on a table whose
--     tenant column is `company_id text` with NO foreign key. Prose cannot be
--     evaluated, cannot be versioned, and cannot be ratified. It is a note.
--   * three boolean flags (`industryMatch` / `sizeMatch` / `geoMatch`) read by
--     `leadUnderstanding/engines/personaIcp.ts` — which have NO PRODUCER. No
--     code in the repository sets them, so the `icp` score dimension has never
--     carried a value derived from anything a tenant actually stated.
--
-- So the honest description of the current state is: the ICP dimension is
-- structurally present and semantically empty. This migration creates the ONE
-- object that can fill it.
--
-- ─── CONTRACT 14: ONE ICP ─────────────────────────────────────────────────
-- There is ONE ICP object per tenant key, and it is versioned. There is no
-- "account ICP" table and no "person ICP" table. Account fit and person fit are
-- EVALUATORS over the same ratified version — they read different attributes of
-- the same document. Splitting them into two stored profiles is how a platform
-- ends up with two definitions of a good customer that silently disagree, and
-- no way to tell which one produced a score.
--
-- ─── CONTRACT 15: TENANCY AND VERSIONING ──────────────────────────────────
-- `organization_id` is `uuid NOT NULL` with a REAL foreign key to
-- `companies(id) ON DELETE CASCADE`. This is stated explicitly because the
-- nearest existing neighbour, `company_profiles`, does the opposite:
-- `company_id text NOT NULL` with no foreign key at all, 31 rows of it. That
-- shape cannot be joined safely, cannot cascade, and cannot stop a typo from
-- creating a tenant that does not exist. It is not copied here.
--
-- Identity is `(organization_id, icp_id, version)`. Each table also carries a
-- companion `UNIQUE (id, organization_id)` so a FUTURE table can reference an
-- ICP or a version through a TENANT-SAFE COMPOSITE foreign key — the W2/W4/W5
-- pattern. Without that companion index, a later reference can only point at
-- `id`, and a row in tenant B can name tenant A's ICP with nothing in the
-- database to stop it.
--
-- Exactly ONE version per `(organization_id, icp_id)` may be ratified at a
-- time, enforced by a PARTIAL unique index (`WHERE status = 'ratified'`).
--
--   ! A PARTIAL UNIQUE INDEX CANNOT BE INFERRED BY `ON CONFLICT`. PostgREST
--     answers `42P10` — the error this repository has hit three times (W0.1,
--     W0.2, W3). Persistence against these tables MUST insert and catch
--     `23505`. `backend/services/prospectIcp/persistence.ts` does exactly that
--     and says so.
--
-- There is deliberately NO effective-period concept in v1. `effective_from` /
-- `effective_until` on an ICP would mean a score's meaning depends on the clock
-- as well as on the version, and every downstream explanation would have to
-- reconstruct which profile was in force at evaluation time. v1 says: the
-- ratified version is the one in force, and history is the superseded chain.
--
-- ─── CONTRACT 16: RATIFICATION ────────────────────────────────────────────
-- AI proposes; a capability-gated, membership-verified HUMAN ratifies; the
-- ratified version becomes an immutable input. The database enforces the parts
-- it can:
--
--   * `ratified_by uuid` is REQUIRED whenever the status is `ratified` — a
--     model has no user id, so a model cannot satisfy this column.
--   * `trg_prospect_icp_versions_immutable` (BEFORE UPDATE) refuses ANY change
--     to a ratified row except the single transition to `superseded`, and
--     refuses every change to a superseded row. A ratified version is therefore
--     an append-only fact: a change produces a NEW version.
--   * a `draft` or `proposed` row may never carry a ratifier, so a proposal
--     cannot be dressed up as a ratification by writing one column.
--
-- The proposal itself is stored in the shape the repository already uses for
-- "AI suggested it, a human accepted or edited it" — `UserGuidedStrategicField`
-- from `backend/services/companyProfile/types.ts`
-- (`ai_value` / `approved_value` / `edited_value` / `status`). A second
-- proposal-state model would be a second thing to keep correct.
--
-- ─── CONTRACT 17: THE VOCABULARY RULE ─────────────────────────────────────
-- `criteria` is jsonb rather than a criteria TABLE with typed columns, and that
-- is a deliberate limitation, not laziness. Typed columns would require this
-- migration to choose a vocabulary for `industry`, `revenue_band`,
-- `funding_stage` and `region` — and P2A explicitly assigned those vocabularies
-- to the first real enrichment provider, which has not been chosen. Inventing
-- them here would freeze a guess into the schema.
--
-- The vocabularies that DO exist are enforced where they are already enforced:
-- `SENIORITY_VALUES` and `EMPLOYEE_BANDS` by the CHECK constraints on
-- `unified_persons` and `prospect_accounts`, and `country_code` by
-- `normalizeCountryCode`. `backend/services/prospectIcp/criteria.ts` refuses a
-- criterion that names a value outside them, and refuses anything but an
-- exact-match or numeric-range predicate on the fields that have no vocabulary.
-- The jsonb column is shape-checked here; the meaning is checked there.
--
-- ─── CONTRACT 18: ABSTAIN, NEVER DEFAULT ──────────────────────────────────
-- Both tables ship EMPTY, and that is a supported operating state, not a gap to
-- be filled with a seed row. A tenant with no ratified ICP produces NO score
-- contribution — not 0, not 0.5. `combineDimension` in
-- `intelligence/canonical/scoring.ts` already treats a contribution as usable
-- only when `value !== null` AND `evidence.length > 0`, and reports
-- `abstained: true` when none are usable. Emitting nothing is therefore the
-- correct way to say "we do not know", and it is what the evaluator does.
--
-- ─── RLS IS NOT THE TENANT BOUNDARY HERE ──────────────────────────────────
-- RLS is enabled with a service-role policy, matching `identity_claims`,
-- `prospect_accounts`, `source_records` and `contact_governance_records`. The
-- runtime uses the SERVICE-ROLE client, so RLS is bypassed by design and the
-- policy exists for parity. The real guarantees are (a) the application guards
-- — `enforceCompanyAccess` then `requireCapability` — and (b) the composite
-- tenant-safe foreign keys below.
--
-- ─── WHAT THIS IS NOT ─────────────────────────────────────────────────────
-- No producer, no AI proposer, no scoring wiring. `personaIcp.ts` and
-- `SCORE_DIMENSIONS` are UNTOUCHED — wiring the evaluator into lead scoring is
-- a later phase with a different owner. `company_profiles` is untouched. No row
-- is written by this migration.
--
-- Rollback: supabase/migrations/rollbacks/d1_tenant_icp_model_rollback.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. Fail CLOSED if the tenant spine is absent or is not the uuid-keyed
-- table these foreign keys assume.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_type TEXT;
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'D1 preflight: public.companies is missing — there is no tenant to own an ICP';
  END IF;

  SELECT format_type(atttypid, atttypmod) INTO v_type
    FROM pg_attribute
   WHERE attrelid = 'public.companies'::regclass
     AND attname = 'id' AND attnum > 0 AND NOT attisdropped;

  IF v_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'D1 preflight: companies.id is %, expected uuid — the tenant FK would be unsound', coalesce(v_type, '<absent>');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid') THEN
    RAISE EXCEPTION 'D1 preflight: gen_random_uuid() is unavailable — pgcrypto is not installed';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- prospect_icps — the ICP OBJECT. One row per tenant-scoped ICP key.
--
-- This table holds IDENTITY only: which ICP, belonging to whom, called what.
-- It holds no criteria, because criteria change and identity must not. Every
-- statement of what a good customer looks like lives in a VERSION.
--
-- `icp_key` is a tenant-chosen stable slug. It is unique per tenant, never
-- globally: two tenants may both call their primary profile 'default', and
-- neither can see the other's.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_icps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TENANT. uuid + REAL foreign key. Deliberately NOT the `company_id text`
  -- shape `company_profiles` uses.
  organization_id  uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- Stable per-tenant handle. Lower-case slug so a caller cannot create
  -- 'Default' and 'default' as two profiles that read as one.
  icp_key          text NOT NULL,

  -- Human label. Presentation only; nothing keys off it.
  name             text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_icps_key_slug
    CHECK (icp_key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$' AND length(icp_key) <= 64),

  CONSTRAINT prospect_icps_name_not_blank
    CHECK (name IS NULL OR length(btrim(name)) > 0)
);

-- One ICP per key PER TENANT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_icps_org_key
  ON public.prospect_icps (organization_id, icp_key);

-- Companion composite. Its ONLY purpose is to be the target of a future
-- tenant-safe FK `(icp_id, organization_id)`. `id` is already unique; this
-- index adds the pair so a referencing row must agree about the tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_icps_id_org
  ON public.prospect_icps (id, organization_id);

-- ---------------------------------------------------------------------------
-- prospect_icp_versions — the versioned, ratifiable statement itself.
--
-- Lifecycle, and the only transitions the trigger below permits:
--
--     draft  ->  proposed  ->  ratified  ->  superseded
--       |            |
--       +------------+---->  (freely editable while unratified)
--
-- A `draft` is NOT an input to scoring, and neither is a `proposed` version.
-- Only `ratified` is. That is the whole point of contract 16: an AI's opinion
-- becomes a platform fact only when a person with the capability says so.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_icp_versions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id        uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  icp_id                 uuid NOT NULL,

  -- Monotonic per (organization_id, icp_id). Assigned by the writer, never
  -- reused: a superseded version keeps its number forever so an explanation
  -- recorded months ago still resolves.
  version                integer NOT NULL,

  status                 text NOT NULL DEFAULT 'draft',

  -- The criteria array. Shape-checked here, MEANING-checked in
  -- backend/services/prospectIcp/criteria.ts, which is the only place that
  -- knows the closed vocabularies. See contract 17 above for why this is not a
  -- typed table.
  criteria               jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- The proposal state, in the repository's EXISTING `UserGuidedStrategicField`
  -- shape (ai_value / approved_value / edited_value / status / guidance /
  -- updated_at). Reused rather than reinvented.
  proposal               jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Which model produced the proposal, when one did. Free text and provider-
  -- neutral, like `source_records.provider`. NEVER a ratifier.
  proposed_by_model      text,

  -- Ratification. A model has no user id, so `ratified_by` is the column a
  -- model cannot fill.
  ratified_at            timestamptz,
  ratified_by            uuid,

  superseded_at          timestamptz,
  superseded_by_version  integer,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_icp_versions_version_positive
    CHECK (version >= 1),

  CONSTRAINT prospect_icp_versions_status_valid
    CHECK (status IN ('draft', 'proposed', 'ratified', 'superseded')),

  CONSTRAINT prospect_icp_versions_criteria_is_array
    CHECK (jsonb_typeof(criteria) = 'array'),

  CONSTRAINT prospect_icp_versions_proposal_is_object
    CHECK (jsonb_typeof(proposal) = 'object'),

  -- A ratified or superseded version WAS ratified, and by a person. An
  -- unratified one was not, and may not pretend otherwise by carrying a
  -- ratifier: that is precisely the forgery contract 16 forbids.
  CONSTRAINT prospect_icp_versions_ratification_coherent
    CHECK (
      (status IN ('ratified', 'superseded') AND ratified_at IS NOT NULL AND ratified_by IS NOT NULL)
      OR
      (status IN ('draft', 'proposed') AND ratified_at IS NULL AND ratified_by IS NULL)
    ),

  -- Supersession is recorded only on a superseded row, and always with a
  -- timestamp — an unexplained supersession is an unusable audit record.
  CONSTRAINT prospect_icp_versions_supersession_coherent
    CHECK (
      (status = 'superseded' AND superseded_at IS NOT NULL)
      OR
      (status <> 'superseded' AND superseded_at IS NULL AND superseded_by_version IS NULL)
    ),

  -- A version cannot be superseded by itself, nor by an earlier one.
  CONSTRAINT prospect_icp_versions_supersession_forward
    CHECK (superseded_by_version IS NULL OR superseded_by_version > version),

  CONSTRAINT prospect_icp_versions_model_not_blank
    CHECK (proposed_by_model IS NULL OR length(btrim(proposed_by_model)) > 0)
);

-- Identity, per contract 15.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_icp_versions_identity
  ON public.prospect_icp_versions (organization_id, icp_id, version);

-- Companion composite, for a future tenant-safe reference to a specific
-- version (an explanation that cites the ICP version it used, for example).
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_icp_versions_id_org
  ON public.prospect_icp_versions (id, organization_id);

-- ! THE ONE-ACTIVE-VERSION RULE. PARTIAL, therefore NOT inferable by
-- `ON CONFLICT` (`42P10`). Writers insert and catch `23505`.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_icp_versions_one_ratified
  ON public.prospect_icp_versions (organization_id, icp_id)
  WHERE status = 'ratified';

-- The read the evaluator performs on every evaluation: "the ratified version
-- for this tenant's ICP".
CREATE INDEX IF NOT EXISTS idx_prospect_icp_versions_ratified
  ON public.prospect_icp_versions (organization_id, icp_id, version DESC)
  WHERE status = 'ratified';

-- The read the console performs: the version history of one ICP.
CREATE INDEX IF NOT EXISTS idx_prospect_icp_versions_history
  ON public.prospect_icp_versions (organization_id, icp_id, version DESC);

-- Tenant-safe composite FK to the ICP object, following W5. `(icp_id,
-- organization_id)` rather than `icp_id` alone means a version in tenant B
-- physically CANNOT name tenant A's ICP: the pair does not exist in the
-- referenced index, so the insert raises `23503`.
DO $fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_icp_versions_icp_tenant_fk') THEN
    ALTER TABLE public.prospect_icp_versions
      ADD CONSTRAINT prospect_icp_versions_icp_tenant_fk
      FOREIGN KEY (icp_id, organization_id)
      REFERENCES public.prospect_icps (id, organization_id) ON DELETE CASCADE;
  END IF;
END
$fks$;

-- ---------------------------------------------------------------------------
-- Immutability of a ratified version — contract 16, enforced by the database.
--
-- An application-only guarantee would be worth exactly as much as the next
-- person's memory of it. This trigger makes "a ratified ICP is an immutable
-- input" a property of the data, so an AI path, a console bug or a stray
-- backfill script cannot quietly rewrite the profile a score was computed
-- against.
--
-- Permitted: ratified -> superseded, changing ONLY status, superseded_at,
-- superseded_by_version and updated_at. Everything else on a ratified row, and
-- everything at all on a superseded row, is refused with `23514` so a caller
-- sees a check violation rather than a silent no-op.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospect_icp_versions_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $guard$
BEGIN
  -- The tenant of ANY row is immutable. Moving a row between tenants is not an
  -- edit, it is a leak.
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'prospect_icp_versions: organization_id is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'prospect_icp_versions: version % of icp % is superseded and immutable', OLD.version, OLD.icp_id
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'ratified' THEN
    IF NEW.status <> 'superseded' THEN
      RAISE EXCEPTION 'prospect_icp_versions: a ratified version may only transition to superseded (got %) — change it by ratifying a NEW version', NEW.status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.icp_id            IS DISTINCT FROM OLD.icp_id
    OR NEW.version           IS DISTINCT FROM OLD.version
    OR NEW.criteria          IS DISTINCT FROM OLD.criteria
    OR NEW.proposal          IS DISTINCT FROM OLD.proposal
    OR NEW.proposed_by_model IS DISTINCT FROM OLD.proposed_by_model
    OR NEW.ratified_at       IS DISTINCT FROM OLD.ratified_at
    OR NEW.ratified_by       IS DISTINCT FROM OLD.ratified_by
    OR NEW.created_at        IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'prospect_icp_versions: the content of a ratified version is immutable — supersede it and ratify a new version'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$guard$;

DROP TRIGGER IF EXISTS trg_prospect_icp_versions_immutable ON public.prospect_icp_versions;
CREATE TRIGGER trg_prospect_icp_versions_immutable
  BEFORE UPDATE ON public.prospect_icp_versions
  FOR EACH ROW EXECUTE FUNCTION public.prospect_icp_versions_guard_immutable();

-- ---------------------------------------------------------------------------
-- RLS. Parity with the rest of the prospect spine. NOT the tenant boundary —
-- the runtime is service-role, so this policy is always satisfied. The boundary
-- is `enforceCompanyAccess` + `requireCapability` in the route, and the
-- composite foreign keys above.
-- ---------------------------------------------------------------------------
ALTER TABLE public.prospect_icps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_icp_versions ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'prospect_icps' AND policyname = 'prospect_icps_service_role') THEN
    CREATE POLICY prospect_icps_service_role ON public.prospect_icps
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'prospect_icp_versions' AND policyname = 'prospect_icp_versions_service_role') THEN
    CREATE POLICY prospect_icp_versions_service_role ON public.prospect_icp_versions
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- Postconditions. Every property the contracts depend on is asserted here, so a
-- partial application fails the migration rather than shipping a table that
-- merely looks right.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_tenant_type TEXT;
  v_org_fk      INT;
  v_composite   INT;
  v_partial     TEXT;
  v_trigger     INT;
  v_rls         INT;
  v_checks      INT;
BEGIN
  IF to_regclass('public.prospect_icps') IS NULL
     OR to_regclass('public.prospect_icp_versions') IS NULL THEN
    RAISE EXCEPTION 'D1 postcondition: one or both tables are missing';
  END IF;

  -- Contract 15: uuid tenant with a real FK, on BOTH tables.
  FOR v_tenant_type IN
    SELECT format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute a
     WHERE a.attrelid IN ('public.prospect_icps'::regclass, 'public.prospect_icp_versions'::regclass)
       AND a.attname = 'organization_id' AND NOT a.attisdropped
  LOOP
    IF v_tenant_type IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION 'D1 postcondition: organization_id is %, expected uuid', v_tenant_type;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_org_fk
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
    JOIN pg_class t ON t.oid = con.confrelid
   WHERE con.contype = 'f'
     AND s.relname IN ('prospect_icps', 'prospect_icp_versions')
     AND t.relname = 'companies'
     AND array_length(con.conkey, 1) = 1;
  IF v_org_fk <> 2 THEN
    RAISE EXCEPTION 'D1 postcondition: expected 2 tenant FKs to companies, found %', v_org_fk;
  END IF;

  -- Contract 15: the tenant-safe composite reference exists.
  SELECT count(*) INTO v_composite
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype = 'f'
     AND s.relname = 'prospect_icp_versions'
     AND array_length(con.conkey, 1) = 2;
  IF v_composite <> 1 THEN
    RAISE EXCEPTION 'D1 postcondition: expected 1 composite tenant-safe FK, found %', v_composite;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_prospect_icps_id_org')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_prospect_icp_versions_id_org') THEN
    RAISE EXCEPTION 'D1 postcondition: a companion (id, organization_id) index is missing — future references cannot be tenant-safe';
  END IF;

  -- Contract 15: the one-active-version rule is a PARTIAL unique index. If it
  -- ever became total, `ON CONFLICT` would start working and the 42P10 lesson
  -- would be silently unlearned; if it lost UNIQUE, two ratified versions could
  -- coexist. Both are asserted.
  SELECT indexdef INTO v_partial
    FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_prospect_icp_versions_one_ratified';
  IF v_partial IS NULL THEN
    RAISE EXCEPTION 'D1 postcondition: the one-ratified-version index is missing';
  END IF;
  IF v_partial NOT LIKE '%UNIQUE%' OR v_partial NOT LIKE '%WHERE%' THEN
    RAISE EXCEPTION 'D1 postcondition: the one-ratified-version index must be UNIQUE and PARTIAL, got %', v_partial;
  END IF;

  -- Contract 16: immutability is enforced by the database, not by convention.
  SELECT count(*) INTO v_trigger
    FROM pg_trigger
   WHERE tgrelid = 'public.prospect_icp_versions'::regclass
     AND tgname = 'trg_prospect_icp_versions_immutable'
     AND NOT tgisinternal;
  IF v_trigger <> 1 THEN
    RAISE EXCEPTION 'D1 postcondition: the ratified-immutability trigger is missing';
  END IF;

  SELECT count(*) INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('prospect_icps', 'prospect_icp_versions')
     AND c.relrowsecurity;
  IF v_rls <> 2 THEN
    RAISE EXCEPTION 'D1 postcondition: RLS is not enabled on both tables (found %)', v_rls;
  END IF;

  SELECT count(*) INTO v_checks
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype = 'c' AND s.relname = 'prospect_icp_versions';
  IF v_checks < 7 THEN
    RAISE EXCEPTION 'D1 postcondition: expected at least 7 CHECK constraints on prospect_icp_versions, found %', v_checks;
  END IF;

  -- Contract 18: no seed row. An empty ICP surface means downstream abstains,
  -- which is the correct answer until a tenant states something.
  IF (SELECT count(*) FROM public.prospect_icps) <> 0
     OR (SELECT count(*) FROM public.prospect_icp_versions) <> 0 THEN
    RAISE EXCEPTION 'D1 postcondition: the ICP tables must be empty on arrival';
  END IF;

  RAISE NOTICE 'D1: prospect_icps + prospect_icp_versions created; 2 tenant FKs, 1 composite FK, partial one-ratified index, immutability trigger, RLS on both, % CHECKs, 0 rows.', v_checks;
END
$verify$;

COMMIT;
