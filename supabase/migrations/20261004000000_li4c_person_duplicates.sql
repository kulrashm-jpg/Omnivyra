-- LI-4C — canonical person lifecycle and duplicate parking.
--
-- WHY. The LI-4A audit found that a duplicate prospect silently disappears.
-- `unified_persons` deduplicates by two tenant-scoped unique indexes (email and
-- phone), so a second CRM row for a known address resolves onto the existing
-- person and nothing is surfaced. Worse, a person created from Apollo's
-- email-only and another from LinkedIn's phone-only can never be unified: no
-- identifier matches, and there is no merge.
--
-- `prospect_accounts` already solved exactly this for companies — `status`,
-- `merged_into_id`, a merge-coherence CHECK and a no-self-merge CHECK. This
-- migration gives persons the SAME shape rather than inventing a second one,
-- and adds the review queue the ADR specifies.
--
-- Implements OMNIVYRA_LI4_PERSON_DUPLICATE_ADR.md. It decides nothing.
--
-- ─── D-1: TENANT-SCOPED IDENTITY, ENFORCED BY THE DATABASE ────────────────
-- The merge pointer is a COMPOSITE self-reference:
--   (merged_into_id, company_id) -> unified_persons (id, company_id)
-- A simple FK on merged_into_id alone would permit merging a person into
-- another tenant's person — the one thing D-1 forbids — and application code is
-- not where that guarantee belongs.
--
-- ─── WHY `ON DELETE NO ACTION` (ADR §15, amendment LI-4C.1) ───────────────
-- The first draft used `ON DELETE SET NULL (merged_into_id)`. That is
-- IMPOSSIBLE alongside `unified_persons_merge_coherent`: a referential action
-- nulls the pointer but CANNOT also change `status`, so the row fails the CHECK
-- and the delete aborts with 23514. The invariant is kept; the action changes.
--
-- NO ACTION rather than RESTRICT is load-bearing. `unified_persons.company_id`
-- is ON DELETE CASCADE from `companies`, so deleting a tenant removes all of its
-- people in one operation. RESTRICT is checked IMMEDIATELY and would abort that
-- cascade the moment it removed a survivor another person pointed at — a tenant
-- with any merged person could never be deleted. NO ACTION is checked at END OF
-- STATEMENT, by which time the referencing row is gone too, so the cascade
-- succeeds. Both give the identical guarantee against a dangling pointer.
--
-- Consequence, and it is the intended one: a survivor cannot be deleted
-- directly while anything is merged into it (23503). Orphaned merged rows are
-- therefore UNREACHABLE — every `merged` person always has a live survivor, so
-- the merge chain D-4 depends on is always complete.
--
-- ─── D-3: MERGE IS A LINK, NOT A DELETION ─────────────────────────────────
-- A merged person keeps its row, its identity, its provenance and its
-- governance. Nothing is moved: in particular `primary_email` / `primary_phone`
-- stay put, because vacating them would free the unique index and let a third
-- person claim the address.
--
-- ─── WHAT THIS IS NOT ─────────────────────────────────────────────────────
-- No merge executor. No backfill. No fuzzy matching. No UI. No change to
-- `resolveUnifiedPerson`, `mayContact()`, Path A or Path B. Every existing row
-- becomes `status='active'` by DEFAULT, which is the entire migration of data.
--
-- Rollback: supabase/migrations/rollbacks/li4c_person_duplicates_rollback.sql
--   LOSSLESS ONLY BEFORE THE FIRST MERGE — see the rollback file.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. Fail closed if the spine is missing or not tenant-safe.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.unified_persons') IS NULL
     OR to_regclass('public.source_records') IS NULL THEN
    RAISE EXCEPTION 'LI-4C preflight: companies, unified_persons or source_records is missing';
  END IF;

  -- The composite self-FK below cannot exist without this.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_unified_persons_id_company') THEN
    RAISE EXCEPTION 'LI-4C preflight: uq_unified_persons_id_company missing — no tenant-safe person reference';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_source_records_id_org') THEN
    RAISE EXCEPTION 'LI-4C preflight: uq_source_records_id_org missing — LI-2 evidence layer absent';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Person lifecycle. Additive; every existing row is 'active' by DEFAULT,
--    so there is no backfill and no existing identity is touched.
-- ---------------------------------------------------------------------------
ALTER TABLE public.unified_persons
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.unified_persons
  ADD COLUMN IF NOT EXISTS merged_into_id uuid;

DO $lifecycle$
BEGIN
  -- ADR §2 vocabulary, mirroring prospect_accounts exactly.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_status_valid') THEN
    ALTER TABLE public.unified_persons
      ADD CONSTRAINT unified_persons_status_valid
      CHECK (status IN ('active', 'merged', 'suppressed', 'archived'));
  END IF;

  -- A merged person names its survivor, and only a merged person may.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_merge_coherent') THEN
    ALTER TABLE public.unified_persons
      ADD CONSTRAINT unified_persons_merge_coherent
      CHECK ((status = 'merged') = (merged_into_id IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_no_self_merge') THEN
    ALTER TABLE public.unified_persons
      ADD CONSTRAINT unified_persons_no_self_merge
      CHECK (merged_into_id IS NULL OR merged_into_id <> id);
  END IF;

  -- D-1 ENFORCED HERE. Composite, so the survivor must be in the SAME tenant.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_merge_tenant_fk') THEN
    ALTER TABLE public.unified_persons
      ADD CONSTRAINT unified_persons_merge_tenant_fk
      FOREIGN KEY (merged_into_id, company_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE NO ACTION;
  END IF;
END
$lifecycle$;

-- Resolution follows the pointer, so it needs an index; only merged rows have one.
CREATE INDEX IF NOT EXISTS idx_unified_persons_merged_into
  ON public.unified_persons (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- Readiness and outreach read only live people.
CREATE INDEX IF NOT EXISTS idx_unified_persons_company_status
  ON public.unified_persons (company_id, status);

-- ---------------------------------------------------------------------------
-- 2. person_duplicate_candidates — the review queue.
--
-- Holds the DECISION TO BE MADE. The evidence itself stays in source_records:
-- this table references it and never copies a payload, so there is exactly one
-- provenance store (ADR §5).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.person_duplicate_candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TENANT. uuid + real FK, the same posture as every LI table.
  organization_id     uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- The person under review.
  person_id           uuid NOT NULL,
  -- The other person, when one exists. NULL when the candidate came from
  -- arriving evidence that has no counterpart person yet — the parked state
  -- LI-2 already supports.
  candidate_person_id uuid,

  -- The evidence that raised this, when it came from ingestion.
  source_record_id    uuid,

  -- ADR §3. Deterministic classes only; there is no score column, deliberately.
  classification      text NOT NULL,
  -- Which deterministic signal fired.
  matched_on          text NOT NULL,

  status              text NOT NULL DEFAULT 'open',

  -- The mandatory audit trail (ADR §6). A resolution without a reason is an
  -- unusable audit record — the LI-3 revocation precedent.
  resolved_by         uuid,
  resolved_at         timestamptz,
  resolution_reason   text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT person_dup_classification_valid
    CHECK (classification IN ('definite', 'probable', 'possible')),

  CONSTRAINT person_dup_matched_on_valid
    CHECK (matched_on IN ('email', 'phone', 'external_key', 'name_account', 'title_account')),

  CONSTRAINT person_dup_status_valid
    CHECK (status IN ('open', 'merged', 'retained', 'dismissed', 'deleted')),

  -- A candidate can never be a person against itself.
  CONSTRAINT person_dup_no_self_pair
    CHECK (candidate_person_id IS NULL OR candidate_person_id <> person_id),

  -- Resolution is all-or-nothing, and never without a reason.
  CONSTRAINT person_dup_resolution_coherent
    CHECK (
      (status = 'open' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL)
      OR
      (status <> 'open' AND resolved_at IS NOT NULL
       AND resolution_reason IS NOT NULL AND length(btrim(resolution_reason)) > 0)
    )
);

-- IDEMPOTENCY (ADR §5). One OPEN review per unordered pair: (A,B) and (B,A) are
-- the same review, so the key is ordered by least/greatest.
--
-- The index is PARTIAL, so ON CONFLICT CANNOT INFER IT — the 42P10 trap this
-- programme hit in W0.1, W0.2 and W3. Persistence must INSERT and catch 23505.
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_duplicate_open_pair
  ON public.person_duplicate_candidates (
    organization_id,
    least(person_id, candidate_person_id),
    greatest(person_id, candidate_person_id))
  WHERE status = 'open' AND candidate_person_id IS NOT NULL;

-- The queue read: this tenant's open candidates.
CREATE INDEX IF NOT EXISTS idx_person_duplicate_org_status
  ON public.person_duplicate_candidates (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_person_duplicate_person
  ON public.person_duplicate_candidates (organization_id, person_id)
  WHERE status = 'open';

-- Tenant-safe references, following the W5 composite pattern. A candidate
-- spanning two tenants is refused by the database, not by application code.
DO $fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_dup_person_tenant_fk') THEN
    ALTER TABLE public.person_duplicate_candidates
      ADD CONSTRAINT person_dup_person_tenant_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_dup_candidate_tenant_fk') THEN
    ALTER TABLE public.person_duplicate_candidates
      ADD CONSTRAINT person_dup_candidate_tenant_fk
      FOREIGN KEY (candidate_person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL (candidate_person_id);
  END IF;

  -- Provenance link. The evidence outlives nothing: if the source record goes,
  -- the candidate survives with its classification intact.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_dup_source_tenant_fk') THEN
    ALTER TABLE public.person_duplicate_candidates
      ADD CONSTRAINT person_dup_source_tenant_fk
      FOREIGN KEY (source_record_id, organization_id)
      REFERENCES public.source_records (id, organization_id) ON DELETE SET NULL (source_record_id);
  END IF;
END
$fks$;

ALTER TABLE public.person_duplicate_candidates ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='person_duplicate_candidates'
                  AND policyname='person_duplicate_candidates_service_role') THEN
    CREATE POLICY person_duplicate_candidates_service_role ON public.person_duplicate_candidates
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_fk      INT;
  v_chk     INT;
  v_merged  INT;
  v_nonactive INT;
  v_def     TEXT;
BEGIN
  IF to_regclass('public.person_duplicate_candidates') IS NULL THEN
    RAISE EXCEPTION 'LI-4C postcondition: person_duplicate_candidates missing';
  END IF;

  -- The composite self-FK is the whole of D-1. Verify it references the
  -- tenant-safe pair, not just the id.
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname='unified_persons_merge_tenant_fk';
  IF v_def IS NULL OR v_def !~ 'FOREIGN KEY \(merged_into_id, company_id\)' THEN
    RAISE EXCEPTION 'LI-4C postcondition: merge FK is not tenant-safe: %', coalesce(v_def, 'missing');
  END IF;
  IF v_def !~ 'REFERENCES unified_persons\(id, company_id\)' THEN
    RAISE EXCEPTION 'LI-4C postcondition: merge FK does not reference the tenant-safe pair: %', v_def;
  END IF;

  -- ADR §15: the action MUST be NO ACTION. Postgres prints no ON DELETE clause
  -- for NO ACTION, so the check is that no other action is present — asserting
  -- the absence of SET NULL alone would pass for CASCADE, which would silently
  -- delete merged people when a survivor is removed.
  IF v_def ~ 'ON DELETE' THEN
    RAISE EXCEPTION 'LI-4C postcondition: merge FK must be ON DELETE NO ACTION, found: %', v_def;
  END IF;
  IF v_def ~ 'SET NULL' THEN
    RAISE EXCEPTION 'LI-4C postcondition: merge FK still uses SET NULL, superseded by ADR §15: %', v_def;
  END IF;

  SELECT count(*) INTO v_fk FROM pg_constraint con
   JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype='f' AND s.relname='person_duplicate_candidates'
     AND array_length(con.conkey,1) = 2;
  IF v_fk <> 3 THEN
    RAISE EXCEPTION 'LI-4C postcondition: expected 3 composite tenant FKs, found %', v_fk;
  END IF;

  SELECT count(*) INTO v_chk FROM pg_constraint con
   JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype='c' AND s.relname='person_duplicate_candidates';
  IF v_chk < 5 THEN
    RAISE EXCEPTION 'LI-4C postcondition: expected at least 5 CHECK constraints, found %', v_chk;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_person_duplicate_open_pair') THEN
    RAISE EXCEPTION 'LI-4C postcondition: pair uniqueness index missing';
  END IF;

  IF (SELECT count(*) FROM public.person_duplicate_candidates) <> 0 THEN
    RAISE EXCEPTION 'LI-4C postcondition: candidate table must be empty on arrival';
  END IF;

  -- No person may have been merged or moved off 'active' by this migration.
  SELECT count(*) INTO v_merged FROM public.unified_persons WHERE merged_into_id IS NOT NULL;
  SELECT count(*) INTO v_nonactive FROM public.unified_persons WHERE status <> 'active';
  IF v_merged <> 0 OR v_nonactive <> 0 THEN
    RAISE EXCEPTION 'LI-4C postcondition: migration altered person lifecycle (% merged, % non-active)', v_merged, v_nonactive;
  END IF;

  RAISE NOTICE 'LI-4C: person lifecycle + person_duplicate_candidates in place, 3 composite tenant FKs, % CHECKs, 0 rows, 0 merged.', v_chk;
END
$verify$;

COMMIT;
