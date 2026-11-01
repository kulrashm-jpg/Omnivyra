-- ===========================================================================
-- PI LISTS-001 — prospect lists and list memberships.
--
-- WS-2 of the PI x Workflow x Outreach programme. The audience-management
-- layer a future Workflow Engine will read from, and nothing more: no workflow
-- definition, no execution state, no scheduling, no dispatch.
--
-- ─── WHY A NEW TABLE AT ALL ────────────────────────────────────────────────
-- The Phase A audit found no list model anywhere: no table in any migration,
-- and zero references to `prospect_lists` / `listMembership` in `backend`,
-- `pages` or `components`. There is nothing to extend, so this is additive.
--
-- It introduces NO second prospect entity. A membership row POINTS AT an
-- existing `canonical_leads` row and owns none of its attributes.
--
-- ─── THE TENANT KEY, AND A REAL NAME MISMATCH ──────────────────────────────
-- `canonical_leads` keys its tenant as `company_id uuid` (migration
-- 20260409_canonical_intelligence_model.sql), while every table the PI
-- programme has added since uses `organization_id`. Both name the same thing —
-- `companies.id`.
--
-- These tables use `organization_id`, matching the PI convention they belong
-- to, and the composite foreign key below spells the mismatch out explicitly
-- rather than hiding it. That is deliberate: a reader of the FK sees both
-- names, and nothing has to remember a silent equivalence.
--
-- ─── TENANT-SAFE FOREIGN KEYS, NOT BARE ONES ───────────────────────────────
-- Every reference carries the tenant as its second leg, so a row can only ever
-- point at a parent IN ITS OWN TENANT. The database refuses a cross-tenant
-- membership before any application check runs.
--
-- `canonical_leads` already publishes the composite target this needs:
--   CREATE UNIQUE INDEX idx_canonical_leads_id_company ON canonical_leads(id, company_id)
-- so no change to that table is required, and none is made.
--
-- ─── DELETION: THREE DIFFERENT QUESTIONS, THREE ANSWERS ────────────────────
--
--   a list is deleted        -> its memberships go with it. CASCADE on the list
--                              leg. A membership has no meaning without its
--                              list.
--
--   a canonical_leads ROW is -> its memberships go with it. CASCADE on the
--   deleted                     prospect leg.
--
--   a member is REMOVED      -> SOFT. `status` becomes 'removed' and
--   from a list by a user       `removed_at` / `removed_by_user_id` /
--                              `removal_reason` are recorded. The row stays, so
--                              "this prospect was in this list and was taken
--                              out on this date" remains answerable.
--
-- ─── WHAT THE CASCADE DOES *NOT* DO: PERSON ERASURE ───────────────────────
-- An earlier revision of this header claimed the prospect-leg cascade was "the
-- ERASURE answer". THAT WAS WRONG, and the correction is recorded here rather
-- than quietly deleted, because the claim is the kind that gets believed.
--
-- The existing erasure path does NOT delete a `canonical_leads` row:
--
--   1. `personErasure.deletePersonRow` deletes from `unified_persons`
--      (backend/services/prospectIdentity/personErasure.ts).
--   2. `canonical_leads.unified_person_id` references the person spine through
--      `canonical_leads_person_tenant_fk`, which is
--      `ON DELETE SET NULL (unified_person_id)`
--      (20260924000000_w5_person_spine_tenant_integrity.sql).
--   3. So the `canonical_leads` row SURVIVES the erasure with a nulled person
--      reference, and nothing in the repository deletes it.
--   4. Therefore THIS CASCADE NEVER FIRES ON PERSON ERASURE, and a membership
--      row outlives the erasure of the person it was about.
--
-- The cascade does fire when a `canonical_leads` row is deleted directly, or
-- when its `companies` row is deleted.
--
-- Whether a surviving membership is acceptable residue is a RETENTION AND
-- ERASURE POLICY DECISION, not a schema detail: after erasure the surviving
-- `canonical_leads` row has already been depersonalised (person reference
-- nulled, contact evidence removed through `identity_claims`' own cascade). The
-- decision is open, and NO erasure cleanup is implemented here. Any such
-- cleanup would belong in the erasure path that already owns the question, not
-- in a second person-leg foreign key from this table — `prospect_list_members`
-- references `canonical_leads`, not the person, and duplicating that identity
-- relationship is how two answers to "who is this" come to disagree.
--
-- THERE IS NO PATH IN THE OTHER DIRECTION. Nothing here can delete a
-- `canonical_leads` row, a `unified_persons` row or any canonical attribute.
-- Removing a list removes memberships; it never touches a prospect.
--
-- ─── WHY THE UNIQUENESS INDEX IS PARTIAL ───────────────────────────────────
-- `uq_prospect_list_members_active` is UNIQUE ... WHERE status = 'active'.
--
-- A TOTAL unique index on (organization_id, list_id, prospect_id) would also
-- prevent duplicates, and it was rejected: re-adding a previously removed
-- prospect would then have to overwrite the removed row, destroying the removal
-- history this table went to the trouble of keeping. The partial index
-- guarantees the thing that actually matters — AT MOST ONE ACTIVE MEMBERSHIP
-- per (tenant, list, prospect) — and lets the superseded 'removed' rows
-- accumulate as the trail.
--
-- The known cost, recorded because the repository has hit it before: a PARTIAL
-- index cannot be named as an `ON CONFLICT` target, so the service reads before
-- it inserts and treats a unique violation as "already a member" rather than an
-- error. The index is what makes that race-safe; the read is only the fast path.
--
-- ─── RLS ───────────────────────────────────────────────────────────────────
-- Matching the convention on `source_records`, `canonical_attribute_decisions`
-- and `attribute_authority_declarations`: the runtime uses the service-role
-- client, tenant isolation is enforced by the application plus the composite
-- keys above, and the policy is parity rather than the guarantee.
--
-- NOT APPLIED. This file is written for review. No database was contacted.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- prospect_lists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_lists (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id  uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  name             text NOT NULL,
  description      text,

  -- Lifecycle. 'archived' is a deactivation, not a delete: an archived list
  -- keeps its memberships and its history, and a future Workflow Engine must
  -- refuse to enrol from it rather than find it missing.
  status           text NOT NULL DEFAULT 'active',

  -- Who created it. SET NULL rather than CASCADE: a list must outlive the
  -- departure of the person who made it.
  created_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_lists_name_not_blank
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT prospect_lists_status_valid
    CHECK (status IN ('active', 'archived'))
);

-- The composite target that lets `prospect_list_members` reference a list
-- tenant-safely. Same pattern as idx_canonical_leads_id_company.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_lists_id_org
  ON public.prospect_lists (id, organization_id);

CREATE INDEX IF NOT EXISTS idx_prospect_lists_org_status_created
  ON public.prospect_lists (organization_id, status, created_at DESC);

COMMENT ON TABLE public.prospect_lists IS
  'PI LISTS-001. Tenant-scoped prospect audience. Owns no prospect attribute; '
  'members reference canonical_leads. Archive is deactivation, never deletion.';

-- ---------------------------------------------------------------------------
-- prospect_list_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_list_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id  uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  list_id          uuid NOT NULL,
  -- The canonical prospect. A REFERENCE ONLY: nothing here writes a canonical
  -- attribute, a source assertion or an identity claim.
  prospect_id      uuid NOT NULL,

  status           text NOT NULL DEFAULT 'active',

  -- PROVENANCE. How the prospect came to be in this list. Free text on purpose,
  -- for the reason LI-2 gives for `source_records.provider`: a new way of
  -- building an audience must never need a migration. The CHECK only refuses
  -- blanks, so the column can never be silently empty.
  added_via        text NOT NULL,
  added_at         timestamptz NOT NULL DEFAULT now(),
  added_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,

  -- Removal is soft, and these three are written together with status.
  removed_at       timestamptz,
  removed_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  removal_reason   text,

  CONSTRAINT prospect_list_members_status_valid
    CHECK (status IN ('active', 'removed')),
  CONSTRAINT prospect_list_members_added_via_not_blank
    CHECK (length(btrim(added_via)) > 0),
  -- REMOVAL COHERENCE, and the asymmetry is deliberate.
  --
  -- An 'active' row carries NO removal data of any kind — not the timestamp,
  -- not the actor, not the reason. An earlier revision constrained only
  -- `removed_at`, which let an active row keep a stray `removed_by_user_id`
  -- from some half-written update and still satisfy the CHECK.
  --
  -- A 'removed' row must carry its TIMESTAMP, and only that:
  --
  --   `removed_by_user_id` is NULLABLE ON PURPOSE. It is
  --   `REFERENCES public.users (id) ON DELETE SET NULL`, so when the person who
  --   performed a removal is later deleted the column becomes NULL — and that
  --   must not retroactively violate this constraint on a row nobody touched.
  --   Requiring it non-null would make deleting a user fail, or silently
  --   corrupt the audit trail it was meant to protect.
  --
  --   `removal_reason` is OPTIONAL, decided rather than left vague: a user
  --   removing someone from a list need not justify it, and requiring a reason
  --   would produce placeholder text that reads like evidence. When one IS
  --   given it is retained verbatim.
  --
  -- Re-adding a prospect after removal inserts a NEW row with every removal
  -- column NULL and `status = 'active'`, which satisfies the first branch; the
  -- prior removed row is untouched. The constraint and the partial unique index
  -- therefore do not conflict.
  CONSTRAINT prospect_list_members_removal_coherent
    CHECK (
      (status = 'active'
         AND removed_at IS NULL
         AND removed_by_user_id IS NULL
         AND removal_reason IS NULL)
      OR
      (status = 'removed' AND removed_at IS NOT NULL)
    ),

  -- Tenant-safe: the list must belong to the same tenant as this row.
  CONSTRAINT prospect_list_members_list_fk
    FOREIGN KEY (list_id, organization_id)
    REFERENCES public.prospect_lists (id, organization_id)
    ON DELETE CASCADE,

  -- Tenant-safe: the prospect must belong to the same tenant as this row.
  -- NOTE the deliberate name asymmetry — `organization_id` here, `company_id`
  -- on canonical_leads. Both are companies.id.
  CONSTRAINT prospect_list_members_prospect_fk
    FOREIGN KEY (prospect_id, organization_id)
    REFERENCES public.canonical_leads (id, company_id)
    ON DELETE CASCADE
);

-- DUPLICATE PREVENTION. At most one ACTIVE membership per (tenant, list,
-- prospect). Partial by design — see the header.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_list_members_active
  ON public.prospect_list_members (organization_id, list_id, prospect_id)
  WHERE status = 'active';

-- "Who is in this list?", paginated stably.
CREATE INDEX IF NOT EXISTS idx_prospect_list_members_list
  ON public.prospect_list_members (organization_id, list_id, status, added_at DESC, id);

-- "Which lists is this prospect in?" — the multi-list question.
CREATE INDEX IF NOT EXISTS idx_prospect_list_members_prospect
  ON public.prospect_list_members (organization_id, prospect_id, status);

COMMENT ON TABLE public.prospect_list_members IS
  'PI LISTS-001. Membership of a canonical prospect in a prospect list. '
  'Removal is soft. Deleting the canonical_leads row CASCADEs, but PERSON '
  'ERASURE does not reach this table — it deletes unified_persons and only '
  'nulls canonical_leads.unified_person_id; erasure cleanup is an open policy '
  'decision and is NOT implemented. Nothing here may write a canonical '
  'attribute. One prospect may belong to many lists.';

-- ---------------------------------------------------------------------------
-- TOUCH TRIGGER. Reuses the existing shared function; no new one. Same
-- statement form as trg_aad_updated_at (migration 20261123000000).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_prospect_lists_updated_at ON public.prospect_lists;
CREATE TRIGGER trg_prospect_lists_updated_at
  BEFORE UPDATE ON public.prospect_lists
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — parity with the PI convention, not the guarantee.
-- ---------------------------------------------------------------------------
ALTER TABLE public.prospect_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_list_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prospect_lists'
      AND policyname = 'prospect_lists_service_role'
  ) THEN
    CREATE POLICY prospect_lists_service_role ON public.prospect_lists
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prospect_list_members'
      AND policyname = 'prospect_list_members_service_role'
  ) THEN
    CREATE POLICY prospect_list_members_service_role ON public.prospect_list_members
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
