-- ===========================================================================
-- PI FOUNDATION — the person↔company RELATIONSHIP, as a first-class row.
--
-- WHY THIS EXISTS, AND WHY NOW.
--
-- Until this migration the employer edge was one scalar: `unified_persons.
-- account_id`, written once by `attachPersonToAccount` and never changed. That
-- was a documented decision, and W1 said so in the column comment: "One primary
-- account by design; a future membership table can add many-to-many additively
-- without altering this column." This is that table.
--
-- What made it urgent is B1b. Under the old li2.1 boundary, two employers each
-- asserting a correct job title DEADLOCKED: the sources disagreed, nothing was
-- written, and the field stayed NULL — visibly unknown. b1b.1 resolves
-- disagreement by recency, so the same evidence now writes the NEWER employer's
-- title as THE PERSON'S title, and re-arbitrates it on every later ingestion.
-- A visibly-unknown NULL became a confidently-wrong single value that flips with
-- whichever employer was observed most recently, and ICP reads it as fact.
--
-- That is not a B1b defect. B1b arbitrates competing claims about one attribute
-- correctly. The defect is the MODEL: `job_title`, `department` and `seniority`
-- are facts about an employment, not about a human. B1b only made the modelling
-- error consequential.
--
-- ─── WHAT THIS MIGRATION DOES NOT DO ──────────────────────────────────────
-- It does not remove the person-level columns. A census of their consumers
-- found live readers in the ICP attribute surface and the prospect API, and
-- migrating those belongs to the ICP gate, not here. The person columns stay,
-- authoritative for nothing new, and the relationship is where future
-- relationship-scoped evidence lands. The transition is documented rather than
-- performed silently.
--
-- It does not touch `canonical_leads` (no `relationship_id`, no account column),
-- prospect identity, scoring, outreach, suppression, CRM, or any provider.
-- It does not change B1b: `ingestionBoundary.ts` and `attributeAuthority.ts` are
-- byte-unchanged. This migration establishes the SUBJECT IDENTITY that a future
-- gate can arbitrate over; it wires no arbitration.
--
-- ─── THE THREE INDEPENDENT CONCEPTS ───────────────────────────────────────
-- Conflating these is the trap this schema is shaped to avoid:
--
--   CURRENT   `ended_at IS NULL`. Derived, never stored. A stored `is_current`
--             would be a second representation of the same fact, free to drift
--             out of agreement with the timestamp — the same class of defect as
--             a stored lifecycle verdict that has gone stale.
--
--   PRIMARY   `is_primary`. The relationship through which this person is
--             currently being PURSUED. Deliberately NOT "most recently
--             observed": observation order is ingestion accident, not product
--             intent, and letting recency pick the targeting employer would turn
--             B1b's recency rule into a targeting trap. Primary is asserted.
--
--   TYPE      `relationship_type`. What the association IS. An advisor and a VP
--             are both real and must not be targeted identically.
--
-- A historical relationship can never be primary — enforced by a CHECK, not by
-- the partial index alone. The index makes at most one primary-and-current row
-- possible; the CHECK makes a primary-and-ended row impossible. Those are
-- different statements and both are needed.
--
-- ─── BACKFILLED TITLES ARE DELIBERATELY UNATTESTED ────────────────────────
-- The backfill copies `job_title`/`department`/`seniority` onto the new primary
-- relationship but leaves `attributes_source`/`attributes_updated_at` NULL. That
-- is not an oversight. No relationship-scoped assertion exists for those values
-- yet, so under B1b's D-4 they are UNATTESTED INCUMBENTS and are protected from
-- being overwritten until real relationship evidence arrives. Copying the
-- person's block-level provenance stamp would have claimed it described these
-- three attributes specifically, which it does not — it is overwritten wholesale
-- on every person-attribute write.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. PRE-FLIGHT. Fail closed on anything the backfill cannot explain.
-- ---------------------------------------------------------------------------
DO $par_preflight$
DECLARE
  v_src     bigint;
  v_dupe    bigint;
  v_orphan  bigint;
  v_existing bigint;
BEGIN
  -- Source population: people carrying an employer pointer today.
  SELECT count(*) INTO v_src
    FROM public.unified_persons WHERE account_id IS NOT NULL;

  -- A person can hold only one scalar, so a duplicate here would mean the
  -- column itself is inconsistent. Checked rather than assumed.
  SELECT count(*) INTO v_dupe FROM (
    SELECT company_id, id FROM public.unified_persons
     WHERE account_id IS NOT NULL
     GROUP BY company_id, id HAVING count(*) > 1
  ) d;
  IF v_dupe <> 0 THEN
    RAISE EXCEPTION 'PAR preflight: % persons report more than one employer pointer', v_dupe;
  END IF;

  -- Tenant integrity: the pointer must already agree with the account's tenant.
  -- `unified_persons_account_tenant_fk` should make this impossible; a non-zero
  -- count means the composite FK is absent or was bypassed.
  SELECT count(*) INTO v_orphan
    FROM public.unified_persons p
    LEFT JOIN public.prospect_accounts a
           ON a.id = p.account_id AND a.organization_id = p.company_id
   WHERE p.account_id IS NOT NULL AND a.id IS NULL;
  IF v_orphan <> 0 THEN
    RAISE EXCEPTION 'PAR preflight: % employer pointers do not resolve within their tenant', v_orphan;
  END IF;

  -- Re-run safety: if current rows already exist, this migration has run.
  SELECT count(*) INTO v_existing FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'person_account_relationships';

  RAISE NOTICE 'PAR preflight: % employer pointers, 0 duplicates, 0 tenant orphans, table_exists=%',
    v_src, v_existing;
END
$par_preflight$;

-- ---------------------------------------------------------------------------
-- 2. THE TABLE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.person_account_relationships (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TENANT. Every key below carries it as its second leg, because the person
  -- and account ids are globally addressable uuids while ownership is not.
  organization_id       uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  person_id             uuid NOT NULL,
  account_id            uuid NOT NULL,

  -- WHAT the association is. Six values, each of which changes either targeting
  -- language or ICP eligibility. Board member, partner, vendor and investor are
  -- real and deliberately absent: none of them changes a decision the system
  -- makes today, and each can be added by relaxing this CHECK.
  relationship_type     text NOT NULL DEFAULT 'employee',

  -- The TARGETING relationship. Asserted, never inferred from recency.
  is_primary            boolean NOT NULL DEFAULT false,

  -- TEMPORAL. Both nullable because most sources state neither. `ended_at IS
  -- NULL` is the single definition of "current"; there is no stored is_current.
  started_at            timestamptz,
  ended_at              timestamptz,

  -- RELATIONSHIP-SCOPED ATTRIBUTES. These are facts about an employment.
  -- Vocabularies are the EXISTING ones from unified_persons, reused verbatim so
  -- there is one vocabulary per attribute in the system, not two.
  job_title             text,
  department            text,
  seniority             text,
  buying_role           text,

  -- B1b provenance block, same shape and same meaning as on the person and
  -- account surfaces. NULL until relationship-scoped arbitration writes here.
  attributes_source     text,
  attributes_updated_at timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT par_relationship_type_valid
    CHECK (relationship_type IN ('employee','advisor','contractor','founder','former_employee','unknown')),

  -- Reused verbatim from unified_persons_seniority_valid.
  CONSTRAINT par_seniority_valid
    CHECK (seniority IS NULL OR seniority IN
      ('intern','entry','senior','manager','head','director','vp','partner','c_suite','founder','owner','other')),

  -- Reused verbatim from unified_persons_buying_role_valid.
  CONSTRAINT par_buying_role_valid
    CHECK (buying_role IS NULL OR buying_role IN
      ('decision_maker','economic_buyer','champion','influencer','evaluator','blocker','unknown')),

  -- A relationship that has ENDED cannot be the one we are pursuing. The
  -- partial primary index cannot express this on its own: it constrains how
  -- many primary-and-current rows may exist, not whether a primary row may be
  -- ended.
  CONSTRAINT par_primary_is_current
    CHECK (NOT (is_primary AND ended_at IS NOT NULL)),

  -- Time may not run backwards. Permissive where evidence is absent.
  CONSTRAINT par_temporal_coherent
    CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at),

  -- The provenance pair is written together or not at all, so clearing one
  -- cannot leave a stamp that describes nothing.
  CONSTRAINT par_attributes_provenance_coherent
    CHECK ((attributes_source IS NULL) = (attributes_updated_at IS NULL)),

  CONSTRAINT par_text_not_blank
    CHECK ((job_title  IS NULL OR length(btrim(job_title))  > 0)
       AND (department IS NULL OR length(btrim(department)) > 0))
);

-- ---------------------------------------------------------------------------
-- 3. TENANT-SAFE COMPOSITE FOREIGN KEYS.
--
-- ON DELETE CASCADE for the person: deleting a person removes their
-- relationships, which is what erasure means. ON DELETE RESTRICT for the
-- account, matching `unified_persons_account_tenant_fk`: an account with people
-- attached must be resolved deliberately, never silently detached.
-- ---------------------------------------------------------------------------
DO $par_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'par_person_tenant_fk') THEN
    ALTER TABLE public.person_account_relationships
      ADD CONSTRAINT par_person_tenant_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'par_account_tenant_fk') THEN
    ALTER TABLE public.person_account_relationships
      ADD CONSTRAINT par_account_tenant_fk
      FOREIGN KEY (account_id, organization_id)
      REFERENCES public.prospect_accounts (id, organization_id) ON DELETE RESTRICT;
  END IF;
END
$par_fks$;

-- ---------------------------------------------------------------------------
-- 4. KEYS.
--
-- Both uniques are PARTIAL, which is deliberate and has a consequence for
-- callers: PostgREST cannot infer a partial index, so `ON CONFLICT` is not
-- available (42P10). The writer must INSERT, catch 23505 and re-resolve — the
-- same discipline WS-1 uses for `canonical_leads`.
-- ---------------------------------------------------------------------------

-- One LIVE relationship per (tenant, person, account). Historical rows are
-- unconstrained, so the same pair may recur across time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_par_live
  ON public.person_account_relationships (organization_id, person_id, account_id)
  WHERE ended_at IS NULL;

-- At most one CURRENT PRIMARY per (tenant, person). This is what keeps every
-- existing scalar consumer correct while multiplicity exists beneath them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_par_one_primary
  ON public.person_account_relationships (organization_id, person_id)
  WHERE is_primary AND ended_at IS NULL;

-- Composite parent key, so a FUTURE `canonical_leads.relationship_id` (or any
-- other referent) can carry the tenant as its second leg without this table
-- being altered. Adding it now is what makes that later change additive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_par_id_org
  ON public.person_account_relationships (id, organization_id);

-- Access patterns: "this person's current relationships" and "this account's
-- current roster".
CREATE INDEX IF NOT EXISTS idx_par_person_current
  ON public.person_account_relationships (organization_id, person_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_par_account_current
  ON public.person_account_relationships (organization_id, account_id)
  WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. updated_at, via the existing repository helper rather than a new one.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_par_updated_at ON public.person_account_relationships;
CREATE TRIGGER trg_par_updated_at
  BEFORE UPDATE ON public.person_account_relationships
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS, matching the convention on source_records / source_assertions /
-- canonical_attribute_decisions: the runtime uses the service-role client and
-- tenant isolation is enforced by the application plus the composite keys. The
-- policy is parity, not the guarantee.
-- ---------------------------------------------------------------------------
ALTER TABLE public.person_account_relationships ENABLE ROW LEVEL SECURITY;

DO $par_rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'person_account_relationships'
                   AND policyname = 'par_service_role') THEN
    CREATE POLICY par_service_role ON public.person_account_relationships
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$par_rls$;

-- ---------------------------------------------------------------------------
-- 7. HUMAN ASSERTION PROVENANCE on source_assertions.
--
-- A human correction that is not an ASSERTION cannot participate in
-- arbitration, and one that is cannot be silently overwritten. So corrections
-- to relationship ATTRIBUTES go here, and B1b decides them by the same rules as
-- any provider claim — with "human wins" expressed as an authority DECLARATION
-- (data), never as a branch in production code.
--
-- `origin` defaults to 'provider' so every existing row remains valid and
-- correctly described. The actor CHECK mirrors
-- `prospect_lifecycle_origin_actor`: a human assertion names its author, and a
-- provider assertion cannot pretend to have one.
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_assertions
  ADD COLUMN IF NOT EXISTS origin              text NOT NULL DEFAULT 'provider',
  ADD COLUMN IF NOT EXISTS asserted_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS relationship_id     uuid;

DO $sa_provenance$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_assertions_origin_valid') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_origin_valid
      CHECK (origin IN ('provider','human'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_assertions_origin_actor') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_origin_actor
      CHECK ((origin = 'human'    AND asserted_by_user_id IS NOT NULL)
          OR (origin = 'provider' AND asserted_by_user_id IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_assertions_actor_fk') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_actor_fk
      FOREIGN KEY (asserted_by_user_id) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;

  -- The relationship SUBJECT. This establishes the identity a future gate needs
  -- for `tenant + relationship + attribute`; nothing writes it yet.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_assertions_relationship_tenant_fk') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_relationship_tenant_fk
      FOREIGN KEY (relationship_id, organization_id)
      REFERENCES public.person_account_relationships (id, organization_id) ON DELETE CASCADE;
  END IF;
END
$sa_provenance$;

-- Widen the subject vocabulary. b1b.1 never writes 'relationship', so this
-- changes no arbitration behaviour; it makes the subject expressible.
DO $sa_entity$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_assertions_entity_type_valid') THEN
    ALTER TABLE public.source_assertions DROP CONSTRAINT source_assertions_entity_type_valid;
  END IF;
  ALTER TABLE public.source_assertions
    ADD CONSTRAINT source_assertions_entity_type_valid
    CHECK (entity_type IN ('person','account','relationship'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_assertions_relationship_coherent') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_relationship_coherent
      CHECK (entity_type <> 'relationship'
             OR (relationship_id IS NOT NULL AND person_id IS NULL AND account_id IS NULL));
  END IF;
END
$sa_entity$;

CREATE INDEX IF NOT EXISTS idx_source_assertions_relationship
  ON public.source_assertions (organization_id, relationship_id, attribute)
  WHERE relationship_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. BACKFILL.
--
-- One primary, current, employee relationship per existing employer pointer.
-- `relationship_type = 'employee'` because that is what `account_id` has always
-- implicitly meant. Dates stay NULL: the database does not know when these
-- employments began, and inventing a date would assert a fact no source stated.
--
-- Guarded by NOT EXISTS rather than ON CONFLICT, because `uq_par_live` is
-- partial and cannot be inferred as a conflict target. That also makes the
-- backfill idempotent.
-- ---------------------------------------------------------------------------
INSERT INTO public.person_account_relationships
  (organization_id, person_id, account_id, relationship_type, is_primary,
   started_at, ended_at, job_title, department, seniority)
SELECT p.company_id, p.id, p.account_id, 'employee', true,
       NULL, NULL, p.job_title, p.department, p.seniority
  FROM public.unified_persons p
 WHERE p.account_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.person_account_relationships r
      WHERE r.organization_id = p.company_id
        AND r.person_id       = p.id
        AND r.account_id      = p.account_id
        AND r.ended_at IS NULL
   );

-- ---------------------------------------------------------------------------
-- 9. POSTCONDITIONS. The migration verifies itself or refuses to have run.
-- ---------------------------------------------------------------------------
DO $par_post$
DECLARE
  v_src     bigint;
  v_rel     bigint;
  v_primary bigint;
  v_mismatch bigint;
  v_fk      bigint;
BEGIN
  SELECT count(*) INTO v_src
    FROM public.unified_persons WHERE account_id IS NOT NULL;
  SELECT count(*) INTO v_rel
    FROM public.person_account_relationships WHERE ended_at IS NULL;
  SELECT count(*) INTO v_primary
    FROM public.person_account_relationships WHERE is_primary AND ended_at IS NULL;

  -- NOTE ON WHAT IS *NOT* ASSERTED HERE, because the first version of this
  -- migration got it wrong and re-application caught it: there is deliberately
  -- no `current relationships = employer pointers` equality. That holds only on
  -- a database that has never used the feature. The moment a person gains a
  -- second relationship — the entire purpose of this table — the counts diverge
  -- legitimately, and a postcondition that fails then would block every later
  -- replay. What IS asserted below is the pointer invariant, which is permanent.

  -- THE COMPATIBILITY INVARIANT, in both directions.
  --
  -- (a) every person carrying a pointer has a current primary relationship to
  --     exactly that account;
  SELECT count(*) INTO v_mismatch
    FROM public.unified_persons p
   WHERE p.account_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.person_account_relationships r
        WHERE r.organization_id = p.company_id
          AND r.person_id       = p.id
          AND r.account_id      = p.account_id
          AND r.is_primary AND r.ended_at IS NULL
     );
  IF v_mismatch <> 0 THEN
    RAISE EXCEPTION 'PAR postcondition: % pointers have no matching current primary relationship', v_mismatch;
  END IF;

  -- (b) and no current primary relationship disagrees with its person's pointer.
  SELECT count(*) INTO v_mismatch
    FROM public.unified_persons p
    JOIN public.person_account_relationships r
      ON r.organization_id = p.company_id AND r.person_id = p.id
     AND r.is_primary AND r.ended_at IS NULL
   WHERE r.account_id IS DISTINCT FROM p.account_id;
  IF v_mismatch <> 0 THEN
    RAISE EXCEPTION 'PAR postcondition: % primary relationships disagree with their pointer', v_mismatch;
  END IF;

  -- Two composite tenant FKs, each carrying organization_id as its second leg.
  SELECT count(*) INTO v_fk FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype = 'f' AND s.relname = 'person_account_relationships'
     AND array_length(con.conkey, 1) = 2;
  IF v_fk <> 2 THEN
    RAISE EXCEPTION 'PAR postcondition: expected 2 composite tenant FKs, found %', v_fk;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_class s ON s.oid = con.conrelid
     WHERE con.contype = 'f' AND s.relname = 'person_account_relationships'
       AND array_length(con.conkey, 1) = 2
       AND pg_get_constraintdef(con.oid) NOT LIKE '%, organization_id)%'
  ) THEN
    RAISE EXCEPTION 'PAR postcondition: a composite FK does not carry organization_id as its second leg';
  END IF;

  -- Both partial uniques must exist; without them multiplicity is unbounded.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_par_live') THEN
    RAISE EXCEPTION 'PAR postcondition: uq_par_live is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_par_one_primary') THEN
    RAISE EXCEPTION 'PAR postcondition: uq_par_one_primary is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'par_primary_is_current') THEN
    RAISE EXCEPTION 'PAR postcondition: par_primary_is_current is missing';
  END IF;

  RAISE NOTICE 'PAR: % relationships backfilled, % primary, pointer invariant holds', v_rel, v_primary;
END
$par_post$;

-- ---------------------------------------------------------------------------
-- 10. THE AUTHORITATIVE WRITER, as SQL functions.
--
-- WHY SQL AND NOT A SERVICE. `unified_persons.account_id` must agree with the
-- primary current relationship at every COMMITTED instant. The runtime reaches
-- the database through PostgREST, which has no multi-statement transaction — two
-- separate calls could commit a promoted relationship and leave the pointer
-- stale, and nothing would notice. An atomic function is the established answer
-- in this repository: `merge_unified_persons` re-points canonical_leads and
-- deletes a person in one call, and the execution-plan and credit-reservation
-- paths do the same. This is that mechanism, not a new one.
--
-- These three are the ONLY sanctioned way to change `is_primary` or the pointer.
-- A caller that sets either directly reintroduces exactly the drift this exists
-- to prevent. Creation is a plain INSERT (is_primary stays false) because it
-- touches one row and needs no atomicity.
--
-- Each function is SECURITY INVOKER and takes the tenant explicitly, so it can
-- neither widen the caller's reach nor be used to touch another tenant: every
-- statement is filtered on organization_id, and the composite FKs make a
-- cross-tenant pairing impossible regardless.
-- ---------------------------------------------------------------------------

-- Promote one relationship to primary, demote the previous one, and move the
-- compatibility pointer — atomically.
CREATE OR REPLACE FUNCTION public.pi_relationship_set_primary(
  p_organization_id uuid,
  p_person_id       uuid,
  p_account_id      uuid
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_person_id IS NULL OR p_account_id IS NULL THEN
    RAISE EXCEPTION 'pi_relationship_set_primary: tenant, person and account are all required';
  END IF;

  -- The target must exist, be CURRENT, and belong to this tenant. A historical
  -- relationship can never be primary, so this refuses rather than reviving it.
  SELECT id INTO v_id
    FROM public.person_account_relationships
   WHERE organization_id = p_organization_id
     AND person_id       = p_person_id
     AND account_id      = p_account_id
     AND ended_at IS NULL
   FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'pi_relationship_set_primary: no current relationship for this tenant/person/account';
  END IF;

  -- Demote FIRST. The partial unique index permits one current primary per
  -- person, so promoting before demoting would collide with itself.
  UPDATE public.person_account_relationships
     SET is_primary = false
   WHERE organization_id = p_organization_id
     AND person_id       = p_person_id
     AND ended_at IS NULL
     AND is_primary
     AND id <> v_id;

  UPDATE public.person_account_relationships
     SET is_primary = true
   WHERE id = v_id;

  -- The pointer, in the same transaction. Tenant-filtered so it can only ever
  -- touch this tenant's person.
  UPDATE public.unified_persons
     SET account_id = p_account_id
   WHERE id = p_person_id AND company_id = p_organization_id;

  RETURN v_id;
END
$$;

-- Remove the targeting relationship entirely: no current primary, pointer NULL.
CREATE OR REPLACE FUNCTION public.pi_relationship_clear_primary(
  p_organization_id uuid,
  p_person_id       uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_person_id IS NULL THEN
    RAISE EXCEPTION 'pi_relationship_clear_primary: tenant and person are required';
  END IF;

  UPDATE public.person_account_relationships
     SET is_primary = false
   WHERE organization_id = p_organization_id
     AND person_id       = p_person_id
     AND ended_at IS NULL
     AND is_primary;

  UPDATE public.unified_persons
     SET account_id = NULL
   WHERE id = p_person_id AND company_id = p_organization_id;
END
$$;

-- End a relationship. If it was the primary one, the pointer goes with it —
-- otherwise `account_id` would keep naming an employment that has finished.
CREATE OR REPLACE FUNCTION public.pi_relationship_end(
  p_organization_id uuid,
  p_person_id       uuid,
  p_account_id      uuid,
  p_ended_at        timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id         uuid;
  v_was_primary boolean;
BEGIN
  IF p_organization_id IS NULL OR p_person_id IS NULL OR p_account_id IS NULL THEN
    RAISE EXCEPTION 'pi_relationship_end: tenant, person and account are all required';
  END IF;

  SELECT id, is_primary INTO v_id, v_was_primary
    FROM public.person_account_relationships
   WHERE organization_id = p_organization_id
     AND person_id       = p_person_id
     AND account_id      = p_account_id
     AND ended_at IS NULL
   FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'pi_relationship_end: no current relationship for this tenant/person/account';
  END IF;

  -- `is_primary` is cleared in the same statement as `ended_at`, because
  -- par_primary_is_current forbids the intermediate state outright.
  UPDATE public.person_account_relationships
     SET ended_at = p_ended_at, is_primary = false
   WHERE id = v_id;

  IF v_was_primary THEN
    UPDATE public.unified_persons
       SET account_id = NULL
     WHERE id = p_person_id AND company_id = p_organization_id;
  END IF;

  RETURN v_id;
END
$$;

COMMENT ON FUNCTION public.pi_relationship_set_primary(uuid, uuid, uuid) IS
  'THE authoritative way to change the targeting relationship. Demotes the previous current primary, promotes the target and moves unified_persons.account_id in one transaction, so the pointer and the primary can never disagree at a committed instant. Refuses a historical relationship.';
COMMENT ON FUNCTION public.pi_relationship_clear_primary(uuid, uuid) IS
  'Drops the targeting relationship: no current primary remains and unified_persons.account_id becomes NULL, atomically.';
COMMENT ON FUNCTION public.pi_relationship_end(uuid, uuid, uuid, timestamptz) IS
  'Ends a current relationship. Clears is_primary in the same statement because par_primary_is_current forbids primary+ended, and NULLs the pointer when the ended relationship was the primary one.';

-- ---------------------------------------------------------------------------
-- 11. DOCUMENTATION.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.person_account_relationships IS
  'PI foundation: the person -> prospect account relationship as a first-class row. A person may hold several simultaneously. `ended_at IS NULL` means current (there is no stored is_current). `is_primary` is the relationship through which the person is being pursued, is asserted rather than inferred from recency, and can never be set on an ended relationship. job_title/department/seniority/buying_role are relationship-scoped because they are facts about an employment; authority and influence stay on the person.';

COMMENT ON COLUMN public.person_account_relationships.is_primary IS
  'The TARGETING relationship. At most one current primary per (tenant, person), enforced by uq_par_one_primary. Never derived from observation recency. unified_persons.account_id is the denormalized pointer to this row''s account and is maintained in the same transaction.';

COMMENT ON COLUMN public.person_account_relationships.ended_at IS
  'NULL means the relationship is current. This is the single representation of currentness; a stored is_current column is deliberately absent so the two can never disagree.';

COMMENT ON COLUMN public.person_account_relationships.attributes_source IS
  'B1b provenance for the relationship-scoped attributes, same shape as on unified_persons. NULL after backfill BY DESIGN: a backfilled title has no relationship-scoped assertion behind it, so D-4 treats it as an unattested incumbent and protects it until real evidence arrives.';

COMMENT ON COLUMN public.source_assertions.origin IS
  'Who asserted this: provider (default, every pre-existing row) or human. A human correction is an assertion so that it participates in B1b arbitration; "human wins" is expressed as an attribute-authority declaration, never as a branch in code.';

COMMENT ON COLUMN public.source_assertions.asserted_by_user_id IS
  'The authenticated author of a human assertion. Required when origin=human and forbidden otherwise, mirroring prospect_lifecycle_origin_actor.';

COMMENT ON COLUMN public.source_assertions.relationship_id IS
  'Subject identity for relationship-scoped arbitration (tenant + relationship + attribute). Established here; nothing writes it yet — b1b.1 never emits entity_type=relationship.';
