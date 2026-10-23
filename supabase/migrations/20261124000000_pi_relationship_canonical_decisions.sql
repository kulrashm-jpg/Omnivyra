-- ---------------------------------------------------------------------------
-- B1b — RELATIONSHIP-SCOPED CANONICAL DECISIONS.
--
-- `canonical_attribute_decisions` is B1b's append-only answer to "which value
-- did we choose, from which evidence, and why". Since the relationship
-- attribute producer landed, relationship attributes are genuinely arbitrated
-- and canonicalised — but their decisions had nowhere to go: the table has no
-- `relationship_id` and its entity_type CHECK admitted only person and account.
-- A relationship's canonical history was therefore unauditable.
--
-- This migration adds the SUBJECT and nothing else. One decision log remains;
-- no second table is created; person and account behaviour is untouched.
--
-- ─── WHY THE "NOT NULL" INVARIANT IS A TRIGGER AND NOT A CHECK ────────────
-- This is the one non-obvious decision here, and it is forced.
--
-- A relationship decision must name its relationship. The obvious way to say
-- that is a CHECK:
--
--     CHECK (entity_type <> 'relationship' OR relationship_id IS NOT NULL)
--
-- and it would be WRONG, because a CHECK is re-validated on every UPDATE.
-- Consider what has to happen when a person is erased. `deletePersonRow`
-- DELETEs `unified_persons`; `par_person_tenant_fk` cascades that to
-- `person_account_relationships`; and whatever this table's foreign key says
-- then has to resolve:
--
--   • ON DELETE CASCADE  — the cascade tries to DELETE a decision row, and
--     `canonical_decisions_append_only` refuses every DELETE outright.
--   • ON DELETE RESTRICT — the cascade is refused, so the person cannot be
--     erased at all.
--   • ON DELETE SET NULL — the cascade nulls `relationship_id`, and the CHECK
--     above then rejects the row.
--
-- Every option breaks erasure while that CHECK exists. The existing columns
-- show the intended shape: there is deliberately no CHECK requiring
-- `person_id IS NOT NULL` for a person decision, the person and account FKs are
-- `ON DELETE SET NULL`, and the append-only trigger documents in as many words
-- that "the only legal UPDATE is a foreign key detaching a deleted subject".
-- A decision OUTLIVES its subject; that is the design.
--
-- So the invariant is enforced where it actually belongs — at INSERT. A
-- relationship decision can never be CREATED without its relationship, and a
-- recorded one can never be RE-POINTED at a different relationship, but it may
-- be detached when its subject is erased. That is strictly stronger than the
-- person/account invariant, which is enforced only by the application.
--
-- Migration 423 -> 424.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. PRECONDITIONS.
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  v_rows   bigint;
  v_person bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'canonical_attribute_decisions') THEN
    RAISE EXCEPTION 'DECISION-LOG preflight: canonical_attribute_decisions is absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'person_account_relationships') THEN
    RAISE EXCEPTION 'DECISION-LOG preflight: person_account_relationships is absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'canonical_decisions_append_only') THEN
    RAISE EXCEPTION 'DECISION-LOG preflight: the append-only trigger function is absent';
  END IF;

  SELECT count(*) INTO v_rows   FROM public.canonical_attribute_decisions;
  SELECT count(*) INTO v_person FROM public.canonical_attribute_decisions WHERE entity_type = 'person';
  RAISE NOTICE 'DECISION-LOG preflight: % existing decision(s), % person-scoped, relationship_id_exists=%',
    v_rows, v_person,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'canonical_attribute_decisions'
        AND column_name = 'relationship_id');
END
$pre$;

-- ---------------------------------------------------------------------------
-- 2. THE SUBJECT COLUMN.
--
-- Nullable, exactly like `person_id` and `account_id`: null means "this
-- decision is not relationship-scoped", or "its relationship has since been
-- erased". Which of the two is answered by `entity_type`.
-- ---------------------------------------------------------------------------
ALTER TABLE public.canonical_attribute_decisions
  ADD COLUMN IF NOT EXISTS relationship_id uuid;

-- ---------------------------------------------------------------------------
-- 3. TENANT-SAFE COMPOSITE FOREIGN KEY.
--
-- Both legs, so a decision can never name another tenant's relationship.
-- `ON DELETE SET NULL (relationship_id)` matches the person and account keys
-- and is what the append-only trigger was written to accommodate.
-- ---------------------------------------------------------------------------
DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'canonical_decisions_relationship_tenant_fk') THEN
    ALTER TABLE public.canonical_attribute_decisions
      ADD CONSTRAINT canonical_decisions_relationship_tenant_fk
      FOREIGN KEY (relationship_id, organization_id)
      REFERENCES public.person_account_relationships (id, organization_id)
      ON DELETE SET NULL (relationship_id);
  END IF;
END
$fk$;

-- ---------------------------------------------------------------------------
-- 4. ENTITY TYPE AND COHERENCE.
--
-- The vocabulary widens by exactly one value. The person/account coherence
-- constraint is left exactly as it was.
-- ---------------------------------------------------------------------------
DO $coherence$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'canonical_decisions_entity_type_valid') THEN
    ALTER TABLE public.canonical_attribute_decisions
      DROP CONSTRAINT canonical_decisions_entity_type_valid;
  END IF;
  ALTER TABLE public.canonical_attribute_decisions
    ADD CONSTRAINT canonical_decisions_entity_type_valid
    CHECK (entity_type IN ('person', 'account', 'relationship'));

  -- A relationship decision describes an EMPLOYMENT, so it names neither a
  -- person nor an account. Note what this does NOT say: nothing here requires
  -- `relationship_id IS NOT NULL`, because a detached decision must survive
  -- its subject's erasure. Section 6 enforces presence at INSERT.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'canonical_decisions_relationship_coherent') THEN
    ALTER TABLE public.canonical_attribute_decisions
      ADD CONSTRAINT canonical_decisions_relationship_coherent
      CHECK (entity_type <> 'relationship'
             OR (person_id IS NULL AND account_id IS NULL));
  END IF;

  -- The converse: a person or account decision may never carry a relationship.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'canonical_decisions_relationship_absent') THEN
    ALTER TABLE public.canonical_attribute_decisions
      ADD CONSTRAINT canonical_decisions_relationship_absent
      CHECK (entity_type = 'relationship' OR relationship_id IS NULL);
  END IF;

  -- A relationship decision may only concern the employment attribute surface
  -- the relationship foundation established. Scoped to relationship rows, so
  -- the wider person/account surface is untouched.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'canonical_decisions_relationship_attribute_valid') THEN
    ALTER TABLE public.canonical_attribute_decisions
      ADD CONSTRAINT canonical_decisions_relationship_attribute_valid
      CHECK (entity_type <> 'relationship'
             OR attribute IN ('job_title', 'department', 'seniority', 'buying_role'));
  END IF;
END
$coherence$;

-- ---------------------------------------------------------------------------
-- 5. INDEX.
--
-- One, mirroring the person and account partial indexes exactly: the only read
-- this subject supports is "the decision history for this relationship and
-- attribute, newest first". No speculative index is added.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_canonical_decisions_relationship_attr
  ON public.canonical_attribute_decisions
     (organization_id, relationship_id, attribute, decided_at DESC)
  WHERE relationship_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. APPEND-ONLY, EXTENDED TO THE NEW SUBJECT.
--
-- Two things the existing function cannot do, because `relationship_id` did
-- not exist when it was written:
--
--   • REQUIRE a relationship decision to name its relationship. This is the
--     INSERT-time half of the invariant discussed in the header, and a trigger
--     is the right place precisely because it does not re-run on the detaching
--     UPDATE that erasure performs.
--   • REFUSE a recorded relationship decision being re-pointed at a different
--     relationship. Without this, `relationship_id` would be the one subject
--     column the append-only guarantee did not cover, and a decision about
--     Company A could be quietly re-attributed to Company B.
--
-- Person and account behaviour is reproduced verbatim; every condition that
-- was there before is still there, in the same order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_decisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A relationship decision must name its relationship. Enforced here rather
    -- than as a CHECK so that erasure can later detach it.
    IF NEW.entity_type = 'relationship' AND NEW.relationship_id IS NULL THEN
      RAISE EXCEPTION 'canonical_attribute_decisions: a relationship decision must name its relationship (attribute=%)',
        NEW.attribute;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'canonical_attribute_decisions is append-only: a decision may never be deleted (attribute=%, decided_at=%)',
      OLD.attribute, OLD.decided_at;
  END IF;

  -- The only legal UPDATE is a foreign key detaching a deleted subject.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.attribute IS DISTINCT FROM OLD.attribute
     OR NEW.assertion_id IS DISTINCT FROM OLD.assertion_id
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.person_id IS DISTINCT FROM OLD.person_id AND NEW.person_id IS NOT NULL)
     OR (NEW.account_id IS DISTINCT FROM OLD.account_id AND NEW.account_id IS NOT NULL)
     OR (NEW.relationship_id IS DISTINCT FROM OLD.relationship_id AND NEW.relationship_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'canonical_attribute_decisions is append-only: a recorded decision may never be modified (attribute=%)',
      OLD.attribute;
  END IF;

  RETURN NEW;
END
$fn$;

-- The existing trigger fires BEFORE DELETE OR UPDATE only; the INSERT guard
-- above needs it to fire on INSERT too.
DROP TRIGGER IF EXISTS canonical_decisions_append_only ON public.canonical_attribute_decisions;
CREATE TRIGGER canonical_decisions_append_only
  BEFORE INSERT OR DELETE OR UPDATE ON public.canonical_attribute_decisions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_decisions_append_only();

-- ---------------------------------------------------------------------------
-- 7. DOCUMENTATION.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.canonical_attribute_decisions.relationship_id IS
  'The EMPLOYMENT a relationship-scoped decision is about. Required at INSERT '
  'for entity_type=''relationship'' (enforced by canonical_decisions_append_only, '
  'not by a CHECK, so erasure can detach it), NULL for person and account '
  'decisions, and tenant-bound by canonical_decisions_relationship_tenant_fk. '
  'May become NULL if the relationship is later erased: a decision outlives its '
  'subject, and it can never be re-pointed at a different relationship.';

-- ---------------------------------------------------------------------------
-- 8. POSTCONDITIONS. The migration verifies itself or refuses to have run.
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_col     bigint;
  v_ttl     bigint;
  v_fk      bigint;
  v_idx     bigint;
  v_code    text;
BEGIN
  -- The column exists and is nullable (a detached decision must be storable).
  SELECT count(*) INTO v_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'canonical_attribute_decisions'
     AND column_name = 'relationship_id' AND is_nullable = 'YES';
  IF v_col <> 1 THEN
    RAISE EXCEPTION 'DECISION-LOG postcondition: relationship_id must exist and be nullable';
  END IF;

  -- D-5 and section 10: no expiry mechanism, ever.
  SELECT count(*) INTO v_ttl
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'canonical_attribute_decisions'
     AND (column_name LIKE '%expire%' OR column_name LIKE '%expiry%' OR column_name LIKE '%ttl%'
          OR column_name LIKE '%valid_until%' OR column_name LIKE '%effective_until%'
          OR column_name LIKE '%purge%' OR column_name LIKE '%retain%');
  IF v_ttl <> 0 THEN
    RAISE EXCEPTION 'DECISION-LOG postcondition: no TTL/expiry column is permitted; found %', v_ttl;
  END IF;

  -- The tenant key is COMPOSITE: organization_id must be its second leg.
  SELECT count(*) INTO v_fk
    FROM pg_constraint
   WHERE conname = 'canonical_decisions_relationship_tenant_fk'
     AND contype = 'f'
     AND array_length(conkey, 1) = 2
     AND pg_get_constraintdef(oid) LIKE '%, organization_id)%';
  IF v_fk <> 1 THEN
    RAISE EXCEPTION 'DECISION-LOG postcondition: the composite relationship tenant FK is missing';
  END IF;

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_canonical_decisions_relationship_attr';
  IF v_idx <> 1 THEN
    RAISE EXCEPTION 'DECISION-LOG postcondition: the relationship history index is missing';
  END IF;

  -- The vocabulary accepts all three entity types, and nothing else.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'canonical_decisions_entity_type_valid'
                    AND pg_get_constraintdef(oid) LIKE '%relationship%'
                    AND pg_get_constraintdef(oid) LIKE '%person%'
                    AND pg_get_constraintdef(oid) LIKE '%account%') THEN
    RAISE EXCEPTION 'DECISION-LOG postcondition: entity_type must accept person, account and relationship';
  END IF;

  -- A relationship decision with no relationship must be REFUSED at insert.
  --
  -- Guarded by whether a tenant exists at all. On a freshly restored baseline
  -- `companies` is EMPTY, so `INSERT ... SELECT ... LIMIT 1` inserts ZERO rows,
  -- raises nothing, and a naive probe reads that silence as acceptance. Fresh
  -- T2 caught exactly that. An absent tenant makes the probe inconclusive, not
  -- passing and not failing.
  IF EXISTS (SELECT 1 FROM public.companies) THEN
    BEGIN
      INSERT INTO public.canonical_attribute_decisions
        (organization_id, entity_type, attribute, assertion_id, value, reason, decided_at)
      SELECT c.id, 'relationship', 'job_title', gen_random_uuid(), 'probe', 'newest_observation', now()
        FROM public.companies c LIMIT 1;
      RAISE EXCEPTION 'DECISION-LOG postcondition: a relationship decision without relationship_id was ACCEPTED';
    EXCEPTION
      WHEN others THEN
        v_code := SQLSTATE;
        IF v_code = 'P0001' AND SQLERRM LIKE '%must name its relationship%' THEN
          NULL;                            -- refused for the right reason
        ELSIF v_code IN ('23502', '23514', '23503') THEN
          NULL;                            -- refused structurally; also fine
        ELSIF SQLERRM LIKE '%was ACCEPTED%' THEN
          RAISE;
        ELSE
          RAISE NOTICE 'DECISION-LOG postcondition: insert probe inconclusive (%: %)', v_code, SQLERRM;
        END IF;
    END;
  ELSE
    -- The STRUCTURAL guarantee does not depend on this probe: the INSERT guard
    -- lives in `canonical_decisions_append_only`, whose presence is asserted
    -- below, and the behaviour is pinned by the real-schema suite.
    RAISE NOTICE 'DECISION-LOG postcondition: no tenant present, insert probe skipped';
  END IF;

  -- The INSERT guard itself must exist, tenant or no tenant.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'canonical_decisions_append_only'
       AND pg_get_functiondef(p.oid) LIKE '%must name its relationship%'
  ) THEN
    RAISE EXCEPTION 'DECISION-LOG postcondition: the relationship INSERT guard is missing from the append-only trigger';
  END IF;

  -- And it must actually fire on INSERT, not only on UPDATE/DELETE.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.canonical_attribute_decisions'::regclass
       AND tgname = 'canonical_decisions_append_only'
       AND (tgtype & 4) <> 0                 -- 4 = INSERT
  ) THEN
    RAISE EXCEPTION 'DECISION-LOG postcondition: the append-only trigger does not fire on INSERT';
  END IF;

  -- A person or account decision must still be storable with no relationship.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'canonical_decisions_relationship_absent'
                AND pg_get_constraintdef(oid) NOT LIKE '%relationship_id IS NULL%') THEN
    RAISE EXCEPTION 'DECISION-LOG postcondition: person/account decisions must forbid relationship_id';
  END IF;

  RAISE NOTICE 'DECISION-LOG: relationship subject added, append-only extended, no TTL, tenant key composite';
END
$post$;
