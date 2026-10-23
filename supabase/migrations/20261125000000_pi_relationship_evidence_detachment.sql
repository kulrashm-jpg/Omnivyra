-- ---------------------------------------------------------------------------
-- PI — RELATIONSHIP EVIDENCE DETACHMENT ON ERASURE (ratified Option B).
--
-- A person with a recorded relationship canonical decision could not be
-- erased. The chain, reproduced in the characterization gate:
--
--   unified_persons DELETE
--     -> person_account_relationships        CASCADE   (par_person_tenant_fk)
--        -> source_assertions.relationship_id CASCADE  (THIS migration's target)
--           -> canonical_attribute_decisions.assertion_id CASCADE
--              -> canonical_decisions_append_only refuses every DELETE -> P0001
--
-- The decision log was never the defect. Its own relationship edge is already
-- ON DELETE SET NULL and would have survived; the break arrives through
-- `assertion_id`, because the relationship cascade DESTROYS the evidence first.
--
-- Every other edge out of `unified_persons` into the evidence and audit layer
-- is SET NULL — 21 of them — and `personErasure` says so in as many words:
-- decisions and source records "carry their own SET NULL edges and survive by
-- design". Relationship-scoped evidence was the one exception, introduced by
-- the relationship foundation. This migration removes the exception, so the
-- relationship path behaves exactly like the person path.
--
-- ─── WHY THE NOT-NULL INVARIANT MOVES TO A TRIGGER ────────────────────────
-- `source_assertions_relationship_coherent` currently requires
-- `relationship_id IS NOT NULL` for a relationship assertion. A CHECK is
-- re-validated on UPDATE, so it would reject the very SET NULL the cascade now
-- performs. The requirement therefore moves to an INSERT-time guard: a
-- relationship assertion can never be CREATED without its relationship, but it
-- may be DETACHED when the relationship is erased.
--
-- This is not a new pattern. Migration 20261124000000 established exactly it
-- for `canonical_attribute_decisions`, for exactly this reason.
--
-- ─── WHAT THE GUARD ALSO PREVENTS ─────────────────────────────────────────
-- `source_assertions` has no trigger today, so `relationship_id` is currently
-- the one subject column that could be UPDATEd freely. Detachment makes that
-- reachable in a way it was not before: a detached assertion carries evidence
-- about an erased person, and re-attaching it to a live relationship would
-- silently reassign that evidence to someone else. The guard therefore permits
-- exactly one transition — non-null to NULL, which is detachment — and refuses
-- re-attachment and re-pointing.
--
-- ─── WHAT IS DELIBERATELY NOT DONE ────────────────────────────────────────
-- `canonical_decisions_assertion_tenant_fk` stays ON DELETE CASCADE. Once
-- assertions are no longer deleted it never fires, and changing it would alter
-- person/account decision semantics.
--
-- `canonical_decisions_append_only` is not touched, in any respect.
--
-- No tombstone, no redaction, no anonymization, no retention period, no purge.
-- Whether a surviving audit row may retain its `value` is a separate owner
-- decision that applies equally to the person path already live today, and
-- deciding it here would decide it silently.
--
-- Migration 424 -> 425.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. PRECONDITIONS. Assert the state this migration is written against.
-- ---------------------------------------------------------------------------
-- Replay-safe: the migration must apply onto the pre-gate state (CASCADE) AND
-- onto its own result (SET NULL), because the migration harness replays the
-- whole chain and asserts idempotency. So the preflight asserts the state is
-- one of the two RECOGNISED shapes rather than asserting it is the first.
DO $pre$
DECLARE
  v_delete   "char";
  v_coherent text;
  v_trg      int;
BEGIN
  SELECT confdeltype INTO v_delete
    FROM pg_constraint
   WHERE conname = 'source_assertions_relationship_tenant_fk' AND contype = 'f';
  IF v_delete IS NULL THEN
    RAISE EXCEPTION 'DETACH preflight: source_assertions_relationship_tenant_fk is absent';
  END IF;
  IF v_delete NOT IN ('c', 'n') THEN                   -- CASCADE or SET NULL
    RAISE EXCEPTION 'DETACH preflight: unexpected ON DELETE action % on the relationship FK', v_delete;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_coherent
    FROM pg_constraint WHERE conname = 'source_assertions_relationship_coherent';
  IF v_coherent IS NULL THEN
    RAISE EXCEPTION 'DETACH preflight: source_assertions_relationship_coherent is absent';
  END IF;
  IF v_coherent NOT LIKE '%person_id IS NULL%' OR v_coherent NOT LIKE '%account_id IS NULL%' THEN
    RAISE EXCEPTION 'DETACH preflight: relationship coherence is not the shape this migration expects';
  END IF;

  -- The append-only trigger must already be the extended (INSERT-aware) one,
  -- and this migration must not be the thing that changes it.
  SELECT count(*) INTO v_trg
    FROM pg_trigger
   WHERE tgrelid = 'public.canonical_attribute_decisions'::regclass
     AND tgname = 'canonical_decisions_append_only' AND NOT tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'DETACH preflight: the canonical decision append-only trigger is absent';
  END IF;

  RAISE NOTICE 'DETACH preflight: relationship FK ondelete=%, coherence present, append-only present, source_assertions triggers=%',
    CASE v_delete WHEN 'c' THEN 'CASCADE (pre-migration)' ELSE 'SET NULL (already applied)' END,
    (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.source_assertions'::regclass AND NOT tgisinternal);
END
$pre$;

-- ---------------------------------------------------------------------------
-- 2. THE ONE EDGE.
--
-- Composite on both legs, as before, so a tenant boundary is still structural.
-- `SET NULL (relationship_id)` names the column explicitly: a bare SET NULL
-- would try to null `organization_id` too, which is NOT NULL, and the delete
-- would fail. This is the same form `canonical_decisions_relationship_tenant_fk`
-- already uses.
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_assertions
  DROP CONSTRAINT IF EXISTS source_assertions_relationship_tenant_fk;

ALTER TABLE public.source_assertions
  ADD CONSTRAINT source_assertions_relationship_tenant_fk
  FOREIGN KEY (relationship_id, organization_id)
  REFERENCES public.person_account_relationships (id, organization_id)
  ON DELETE SET NULL (relationship_id);

-- ---------------------------------------------------------------------------
-- 3. COHERENCE, MINUS THE PERSISTENT NOT-NULL.
--
-- What is REMOVED: `relationship_id IS NOT NULL`, which now lives in the
-- INSERT guard below.
--
-- What is KEPT, unchanged: a relationship assertion names neither a person nor
-- an account. That matters more after detachment, not less — it is what stops a
-- detached relationship assertion from reading as a person assertion.
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_assertions
  DROP CONSTRAINT IF EXISTS source_assertions_relationship_coherent;

ALTER TABLE public.source_assertions
  ADD CONSTRAINT source_assertions_relationship_coherent
  CHECK (entity_type <> 'relationship'
         OR (person_id IS NULL AND account_id IS NULL));

-- ---------------------------------------------------------------------------
-- 4. THE INSERT-TIME GUARD, AND THE RE-POINTING GUARD.
--
-- Three rules, and only three:
--
--   INSERT  a relationship assertion must name its relationship.
--   UPDATE  non-null -> NULL is ALLOWED. That is detachment, and it is what
--           the foreign key above performs when a relationship is erased.
--   UPDATE  anything else that changes `relationship_id` is REFUSED: NULL ->
--           non-null would re-attach erased evidence to a live relationship,
--           and non-null -> different non-null would reassign it.
--
-- Deliberately silent about every other column. `superseded_at`,
-- `applied_to_canonical_at`, `applied_reason` and the person/account SET NULL
-- edges are all untouched by this guard, which is why liveness reconciliation
-- and canonical stamping keep working unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.source_assertions_relationship_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.entity_type = 'relationship' AND NEW.relationship_id IS NULL THEN
      RAISE EXCEPTION 'source_assertions: a relationship assertion must name its relationship (attribute=%)',
        NEW.attribute;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE.
  IF NEW.relationship_id IS DISTINCT FROM OLD.relationship_id
     AND NEW.relationship_id IS NOT NULL THEN
    RAISE EXCEPTION 'source_assertions: relationship evidence may be detached but never re-pointed (attribute=%)',
      OLD.attribute;
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.source_assertions_relationship_guard() IS
  'Relationship evidence lifecycle: a relationship assertion must name its '
  'relationship at INSERT, may be DETACHED (relationship_id -> NULL) when its '
  'relationship is erased, and may never be re-attached or re-pointed. The '
  'NOT NULL half is here rather than in a CHECK because a CHECK re-validates '
  'on UPDATE and would reject the detaching cascade itself.';

DROP TRIGGER IF EXISTS source_assertions_relationship_guard ON public.source_assertions;
CREATE TRIGGER source_assertions_relationship_guard
  BEFORE INSERT OR UPDATE ON public.source_assertions
  FOR EACH ROW EXECUTE FUNCTION public.source_assertions_relationship_guard();

-- ---------------------------------------------------------------------------
-- 5. DOCUMENTATION.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.source_assertions.relationship_id IS
  'The EMPLOYMENT this assertion is about. Required at INSERT for '
  'entity_type=''relationship'' (enforced by source_assertions_relationship_guard, '
  'not by a CHECK, so the erasure cascade can detach it), NULL for person and '
  'account assertions, and tenant-bound by source_assertions_relationship_tenant_fk. '
  'Becomes NULL when the relationship is erased: the evidence outlives its '
  'subject exactly as person-scoped evidence already does, and can never be '
  're-attached. A NULL relationship_id is unreachable by relationship-scoped '
  'arbitration, which looks it up by equality.';

-- ---------------------------------------------------------------------------
-- 6. POSTCONDITIONS. The migration verifies itself or refuses to have run.
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_n    int;
  v_def  text;
  v_code text;
BEGIN
  -- 6a. The edge is SET NULL, still composite, still tenant-bound.
  SELECT count(*) INTO v_n
    FROM pg_constraint
   WHERE conname = 'source_assertions_relationship_tenant_fk'
     AND contype = 'f'
     AND confdeltype = 'n'                              -- 'n' = SET NULL
     AND array_length(conkey, 1) = 2
     AND pg_get_constraintdef(oid) LIKE '%, organization_id)%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DETACH postcondition: the relationship FK is not a composite ON DELETE SET NULL';
  END IF;

  -- It must null ONLY relationship_id, never the tenant.
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'source_assertions_relationship_tenant_fk';
  IF v_def NOT LIKE '%SET NULL (relationship_id)%' THEN
    RAISE EXCEPTION 'DETACH postcondition: SET NULL must name relationship_id only (got: %)', v_def;
  END IF;

  -- 6b. The CHECK no longer carries the persistent NOT NULL, but still forbids
  --     a relationship assertion naming a person or an account.
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'source_assertions_relationship_coherent';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'DETACH postcondition: source_assertions_relationship_coherent is missing';
  END IF;
  IF v_def LIKE '%relationship_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'DETACH postcondition: the CHECK still carries NOT NULL and would reject detachment';
  END IF;
  IF v_def NOT LIKE '%person_id IS NULL%' OR v_def NOT LIKE '%account_id IS NULL%' THEN
    RAISE EXCEPTION 'DETACH postcondition: relationship coherence lost its person/account exclusion';
  END IF;

  -- 6c. The guard exists and fires on INSERT and on UPDATE.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'source_assertions_relationship_guard'
       AND pg_get_functiondef(p.oid) LIKE '%must name its relationship%'
       AND pg_get_functiondef(p.oid) LIKE '%never re-pointed%'
  ) THEN
    RAISE EXCEPTION 'DETACH postcondition: the relationship guard function is missing or incomplete';
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_trigger
   WHERE tgrelid = 'public.source_assertions'::regclass
     AND tgname = 'source_assertions_relationship_guard'
     AND (tgtype & 4) <> 0                              -- INSERT
     AND (tgtype & 16) <> 0;                            -- UPDATE
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DETACH postcondition: the guard must fire on INSERT and UPDATE';
  END IF;

  -- 6d. The canonical decision log is untouched: still append-only, still
  --     CASCADE on its assertion edge.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.canonical_attribute_decisions'::regclass
       AND tgname = 'canonical_decisions_append_only'
       AND (tgtype & 8) <> 0                            -- DELETE
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'DETACH postcondition: the canonical decision append-only trigger no longer guards DELETE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'canonical_decisions_assertion_tenant_fk' AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'DETACH postcondition: canonical_decisions_assertion_tenant_fk must remain ON DELETE CASCADE';
  END IF;

  -- 6e. NO TTL, retention or redaction column was introduced anywhere in the
  --     evidence or audit tables. This migration decides no retention policy.
  SELECT count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('source_assertions', 'canonical_attribute_decisions')
     AND (column_name LIKE '%expire%' OR column_name LIKE '%expiry%' OR column_name LIKE '%ttl%'
          OR column_name LIKE '%purge%' OR column_name LIKE '%retain%' OR column_name LIKE '%redact%'
          OR column_name LIKE '%anonymi%' OR column_name LIKE '%tombstone%');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'DETACH postcondition: no retention/redaction column may be introduced; found %', v_n;
  END IF;

  -- 6f. Behavioural probe: a relationship assertion with no relationship must
  --     be refused. Guarded on a tenant existing, because on a freshly
  --     restored baseline the tables are empty and an INSERT ... SELECT would
  --     insert zero rows and raise nothing -- which an earlier migration in
  --     this programme mistook for acceptance.
  IF EXISTS (SELECT 1 FROM public.source_records) THEN
    BEGIN
      INSERT INTO public.source_assertions
        (organization_id, source_record_id, entity_type, relationship_id,
         attribute, normalized_value, value_hash, provider, recorded_at)
      SELECT r.organization_id, r.id, 'relationship', NULL,
             'job_title', 'probe', repeat('0', 64), 'probe', now()
        FROM public.source_records r LIMIT 1;
      RAISE EXCEPTION 'DETACH postcondition: a relationship assertion without relationship_id was ACCEPTED';
    EXCEPTION
      WHEN others THEN
        v_code := SQLSTATE;
        IF v_code = 'P0001' AND SQLERRM LIKE '%must name its relationship%' THEN
          NULL;                                         -- refused for the right reason
        ELSIF v_code IN ('23502', '23514', '23503', '23505') THEN
          NULL;                                         -- refused structurally; also fine
        ELSIF SQLERRM LIKE '%was ACCEPTED%' THEN
          RAISE;
        ELSE
          RAISE NOTICE 'DETACH postcondition: insert probe inconclusive (%: %)', v_code, SQLERRM;
        END IF;
    END;
  ELSE
    RAISE NOTICE 'DETACH postcondition: no source record present, insert probe skipped';
  END IF;

  RAISE NOTICE 'DETACH: relationship evidence now detaches on erasure; INSERT and re-point guarded; append-only untouched';
END
$post$;
