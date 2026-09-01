-- A3 / Contract 12 — the canonical PERSON ANCHOR for lead outreach.
--
-- WHAT THIS ESTABLISHES
--   outreach_tasks.person_id uuid NULL
--     FOREIGN KEY (person_id, company_id)
--     REFERENCES unified_persons (id, company_id)
--     MATCH SIMPLE ON DELETE SET NULL (person_id)
--
-- and, because that composite key cannot exist while the tenant column is
-- `text`, an IN-PLACE `text -> uuid` retype of `company_id` across the WHOLE
-- nine-table outreach family.
--
-- ─── WHY AN ANCHOR AT ALL ──────────────────────────────────────────────────
-- WS-3 materialises an `OutreachTask` carrying a `lead_id`. Canonical contact
-- governance (LI-3B, `contact_governance_records`) is anchored to
-- `unified_persons.id`. LI-3D bridged the two AT RUNTIME by reading
-- `leads.unified_person_id` on every evaluation, which works but is not a
-- durable fact: nothing on the task records WHICH person was governed, the
-- resolution is repeated on every gate evaluation, and a lead later re-pointed
-- at a different person silently changes the meaning of an audit record written
-- months earlier. Contract 12 makes the anchor a stored, tenant-safe column so
-- that "who did we decide we were allowed to contact" is answerable from the
-- row itself.
--
-- ─── WHY IN-PLACE, NOT A SHADOW COLUMN ─────────────────────────────────────
-- The shadow-column dance (add uuid column, backfill, dual-write, swap, drop)
-- exists to avoid a long exclusive lock and an unrecoverable rewrite on a large
-- populated table. Verified read-only against production on 2026-09-01, every
-- one of the nine outreach tables holds ZERO rows. A rewrite of zero rows is
-- instantaneous, no orphan can exist, and `uuid -> text` is lossless in the
-- other direction because PostgreSQL renders a uuid in exactly the canonical
-- 8-4-4-4-12 form the text column already had to hold. The shadow ceremony
-- would therefore buy nothing and would leave a half-migrated schema behind for
-- a wave. This mirrors the decision W2 made for `lead_intelligence`
-- (20260921000000) for the same reasons.
--
-- The migration is nevertheless written to be CORRECT AGAINST A POPULATED
-- TABLE: emptiness is an argument about cost, never a licence to skip guards.
-- Every retype is preceded by a syntactic UUID check and an orphan check, the
-- anchor by a cross-tenant check, and a single bad row aborts the whole
-- migration rather than coercing or discarding anything.
--
-- ─── WHY THE WHOLE FAMILY, NOT JUST outreach_tasks ─────────────────────────
-- All nine tables (`outreach_tasks`, `outreach_approvals`, `outreach_attempts`,
-- `outreach_delivery_evidence`, `outreach_outcomes`, `outreach_decisions`,
-- `outreach_governance_config`, `outreach_internal_work_items`,
-- `outreach_suppressions`) carry the same `company_id` and are joined on it in
-- every read this runtime performs. Retyping one and leaving eight would make
-- `outreach_tasks.company_id = outreach_attempts.company_id` a cross-type
-- comparison and would leave the family permanently inconsistent for no
-- benefit — the other eight cost the same zero-row rewrite.
--
-- ─── WHY lead_id IS DELIBERATELY *NOT* RETYPED ─────────────────────────────
-- `outreach_tasks.lead_id` and `outreach_internal_work_items.lead_id` stay
-- `text`. This is a judgement, and here is the evidence behind it:
--
--   1. The identifier that flows into this runtime is NOT proven to be
--      `leads.id`. It arrives through
--      `leadOutreachActivation.materializeOutreachForLead`, whose upstream
--      canonical surface is `lead_intelligence_profiles.lead_id` — still `text`
--      today. W2 retyped `company_id` on that very table and pointedly did NOT
--      retype `lead_id`, because it had production evidence for the tenant
--      column and none for the lead column. Nothing has changed that.
--   2. Retyping here would make outreach's identity anchor STRICTER than the
--      intelligence surface that feeds it: a lead id that legitimately
--      materialises an intelligence profile today would fail materialisation
--      tomorrow with 22P02. That is a live regression traded for cosmetic
--      consistency.
--   3. Contract 12 needs `company_id` as uuid and nothing else. A foreign key
--      to `leads` is explicitly not required by the contract, and adding one on
--      an unproven correspondence would encode a semantic claim the schema does
--      not make — precisely what W2's header warns against.
--
--   Consequence, recorded rather than hidden: `leads` stays reachable only by
--   runtime resolution, and lead-identity reconciliation across
--   `lead_intelligence_profiles.lead_id`, `outreach_tasks.lead_id` and
--   `outreach_internal_work_items.lead_id` is owed to a later wave that can
--   prove the correspondence from data.
--
-- ─── WHY ON DELETE SET NULL (person_id), NOT CASCADE AND NOT RESTRICT ──────
--   CASCADE  would delete the outreach task — and its audit children — when a
--            person row is removed. An outreach record exists to prove who
--            authorised contacting someone; destroying it because the person
--            was later merged or erased destroys exactly the evidence the table
--            is for. The cascade would also be UNACHIEVABLE: the children carry
--            `ON DELETE RESTRICT` plus append-only triggers that correctly
--            refuse the delete, so the declared action would fail at runtime
--            rather than do what it claims.
--   RESTRICT would make a person — and therefore, through
--            `unified_persons.company_id`'s CASCADE from `companies`, an entire
--            TENANT — undeletable once any outreach history exists. A tenant
--            that cannot be deleted is an erasure problem, not a safety feature.
--   SET NULL is therefore the only correct action: the audit row survives with
--            its tenant, lead, plan task and decision history intact, and merely
--            stops naming a person that no longer exists.
--
-- The bare `ON DELETE SET NULL` form nulls EVERY column of the referencing key,
-- which here would wipe `company_id` — a NOT NULL column, so the delete would
-- fail outright, and would silently strip the tenant if it did not. PostgreSQL
-- 15 added the column-list form and production is 17.6, so this nulls the
-- person leg ONLY. Same construction W5 used across eleven spine edges
-- (20260924000000).
--
-- MATCH SIMPLE (the default, stated explicitly by the contract) means the
-- constraint is not enforced when `person_id` is NULL. An unanchored task stays
-- legal exactly as it is today — this migration adds a capability, it does not
-- make anchoring mandatory.
--
-- ─── WHY NO FOREIGN KEY FROM company_id TO companies ───────────────────────
-- Tempting, and wrong here. Every tenant foreign key in this platform uses
-- `ON DELETE CASCADE`; a cascade onto this family would attempt a DELETE on
-- rows protected by `ws3_reject_mutation`, which refuses it. Deleting a tenant
-- would then become impossible — the identical trap the WS-3 base migration
-- documented when it chose RESTRICT over CASCADE for the task->children edges.
-- RESTRICT would be equally bad, for the same erasure reason as above. So the
-- tenant column becomes a real `uuid` (which is what Contract 12 needs and what
-- makes the composite key expressible) without acquiring a referential action
-- this family cannot survive. Application-layer tenant scoping via
-- `ownedDbTable` remains the primary control, unchanged.
--
-- ─── CONTRACT 13 SURFACE: RECORDING THE DEGRADATION ────────────────────────
-- `outreach_decisions` gains three descriptive columns so a governance decision
-- taken WITHOUT a person anchor is visibly identifiable instead of silently
-- indistinguishable from one taken with it. No referential action is attached
-- to `outreach_decisions.person_id` — see section 4 for why an append-only
-- table must not carry one.
--
-- ─── WHAT THIS MIGRATION DOES NOT DO ───────────────────────────────────────
-- It drops no table. `suppression_entries` and `outreach_suppressions` both
-- survive: retiring them requires a proven-zero-consumer sweep that is out of
-- this wave's scope. It does not touch `consent_records` — an OAuth/platform
-- capability ledger, a different domain entirely. It writes no row, backfills
-- nothing, and contacts nobody.
--
-- Rollback: supabase/migrations/rollbacks/a3_outreach_person_anchor_rollback.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight. FAIL CLOSED — refuse to convert anything not provably safe.
--    A3 hardens; it never repairs, coerces or discards data.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_tbl    text;
  v_type   text;
  v_bad    bigint;
  v_orphan bigint;
  v_report text := '';
  UUID_RE  constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  -- The key the composite foreign key must reference. Without it the whole
  -- contract is unexpressible, so this is checked before anything is altered.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'unified_persons'
       AND indexname = 'uq_unified_persons_id_company'
  ) THEN
    RAISE EXCEPTION 'a3_preflight: uq_unified_persons_id_company is missing; the composite '
                    'person foreign key cannot reference (id, company_id).'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The referenced tenant leg must be uuid, or the retyped referencing leg
  -- would not be type-compatible with it.
  SELECT format_type(atttypid, atttypmod) INTO v_type
    FROM pg_attribute
   WHERE attrelid = 'public.unified_persons'::regclass AND attname = 'company_id';
  IF v_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'a3_preflight: unified_persons.company_id is %, expected uuid.',
      coalesce(v_type, 'absent') USING ERRCODE = 'restrict_violation';
  END IF;

  -- Every tenant value in the family must already be a canonical UUID
  -- rendering. One malformed value stops the migration; it is never coerced.
  FOREACH v_tbl IN ARRAY ARRAY[
    'outreach_tasks', 'outreach_approvals', 'outreach_attempts',
    'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions',
    'outreach_governance_config', 'outreach_internal_work_items',
    'outreach_suppressions'
  ] LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'a3_preflight: table public.% is absent; the outreach family is incomplete.',
        v_tbl USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT format_type(atttypid, atttypmod) INTO v_type
      FROM pg_attribute
     WHERE attrelid = ('public.' || v_tbl)::regclass AND attname = 'company_id';

    IF v_type = 'uuid' THEN
      CONTINUE;                              -- already converted by a prior run
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id !~ %L', v_tbl, UUID_RE)
      INTO v_bad;
    IF v_bad > 0 THEN
      v_report := v_report || format('%s: %s non-UUID tenant value(s); ', v_tbl, v_bad);
      CONTINUE;
    END IF;

    -- A value that parses but names no tenant is a data-integrity problem in
    -- its own right. No foreign key is added here, so nothing else would ever
    -- surface it — which is precisely why it is surfaced now.
    EXECUTE format(
      'SELECT count(*) FROM public.%I s
        WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.company_id::uuid)',
      v_tbl) INTO v_orphan;
    IF v_orphan > 0 THEN
      v_report := v_report || format('%s: %s tenant value(s) naming no company; ', v_tbl, v_orphan);
    END IF;
  END LOOP;

  IF v_report <> '' THEN
    RAISE EXCEPTION 'a3_preflight: the outreach family holds tenant values that cannot be '
                    'converted safely -> %. Reconcile the data first; A3 must not coerce or '
                    'discard rows.', v_report
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Remove the text-shaped tenant CHECK constraints.
--
--    `CHECK (length(btrim(company_id)) > 0)` is a *text* predicate. PostgreSQL
--    re-derives check constraints when a column's type changes, and
--    `btrim(uuid)` does not exist — the retype in section 2 would abort with
--    42883 if these were left in place. They are not re-created afterwards
--    because a `uuid NOT NULL` column cannot hold a blank: the constraint's
--    entire purpose is subsumed by the type. The rollback restores them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.outreach_tasks
  DROP CONSTRAINT IF EXISTS outreach_tasks_company_not_blank;
ALTER TABLE public.outreach_governance_config
  DROP CONSTRAINT IF EXISTS outreach_governance_config_company_not_blank;
ALTER TABLE public.outreach_internal_work_items
  DROP CONSTRAINT IF EXISTS outreach_internal_work_items_company_not_blank;

-- `outreach_tasks_lead_not_blank` is deliberately LEFT IN PLACE: `lead_id`
-- stays `text`, so the predicate stays valid and stays useful.

-- ---------------------------------------------------------------------------
-- 2. Retype company_id text -> uuid across the family.
--
--    Indexes and unique constraints over the column — including
--    `outreach_tasks_identity_unique (company_id, lead_id, plan_task_id)`,
--    WS-3's idempotency anchor — are rebuilt automatically by the type change.
--    None is dropped or re-created by hand, so none can be lost; section 6
--    asserts that the identity anchor is still there.
--
--    `outreach_governance_config.company_id` is that table's PRIMARY KEY; its
--    backing index is rebuilt the same way.
--
--    Idempotent: a column already `uuid` is skipped.
-- ---------------------------------------------------------------------------
DO $retype$
DECLARE
  v_tbl  text;
  v_type text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'outreach_tasks', 'outreach_approvals', 'outreach_attempts',
    'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions',
    'outreach_governance_config', 'outreach_internal_work_items',
    'outreach_suppressions'
  ] LOOP
    SELECT format_type(atttypid, atttypmod) INTO v_type
      FROM pg_attribute
     WHERE attrelid = ('public.' || v_tbl)::regclass AND attname = 'company_id';

    IF v_type = 'uuid' THEN
      RAISE NOTICE 'a3: %.company_id is already uuid, skipping', v_tbl;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN company_id TYPE uuid USING company_id::uuid',
      v_tbl);
    RAISE NOTICE 'a3: %.company_id retyped text -> uuid', v_tbl;
  END LOOP;
END
$retype$;

-- ---------------------------------------------------------------------------
-- 3. CONTRACT 12 — the anchor itself.
-- ---------------------------------------------------------------------------
ALTER TABLE public.outreach_tasks ADD COLUMN IF NOT EXISTS person_id uuid;

COMMENT ON COLUMN public.outreach_tasks.person_id IS
  'Canonical unified_persons.id this task contacts, when known. NULL is legal and means the '
  'task is not anchored — governance then degrades to target-only matching and records that '
  'degradation on the decision. Tenant-safe via outreach_tasks_person_tenant_fk; nulled, '
  'never cascaded, when the person is deleted.';

-- The composite tenant-safe foreign key. Guarded rather than `IF NOT EXISTS`
-- (which ADD CONSTRAINT does not support) — the house style of 20260923000000
-- and 20261004000000.
DO $anchor_fk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'outreach_tasks'
       AND con.conname = 'outreach_tasks_person_tenant_fk'
  ) THEN
    RAISE NOTICE 'a3: outreach_tasks_person_tenant_fk already present, skipping';
    RETURN;
  END IF;

  -- Guard against a populated table that already holds a cross-tenant anchor:
  -- the constraint would reject it anyway, but naming it here reports the real
  -- integrity problem instead of a bare 23503.
  IF EXISTS (
    SELECT 1 FROM public.outreach_tasks t
      JOIN public.unified_persons p ON p.id = t.person_id
     WHERE t.person_id IS NOT NULL AND p.company_id IS DISTINCT FROM t.company_id
  ) THEN
    RAISE EXCEPTION 'a3: outreach_tasks already anchors task(s) to a person in a DIFFERENT '
                    'tenant. This is a data-integrity blocker; do not reassign silently.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  ALTER TABLE public.outreach_tasks
    ADD CONSTRAINT outreach_tasks_person_tenant_fk
    FOREIGN KEY (person_id, company_id)
    REFERENCES public.unified_persons (id, company_id)
    MATCH SIMPLE
    ON DELETE SET NULL (person_id);

  RAISE NOTICE 'a3: outreach_tasks_person_tenant_fk created';
END
$anchor_fk$;

COMMENT ON CONSTRAINT outreach_tasks_person_tenant_fk ON public.outreach_tasks IS
  'Contract 12. A task may only anchor to a person in its OWN tenant. ON DELETE SET NULL '
  '(person_id) keeps the audit row and its tenant intact when the person is deleted: CASCADE '
  'would destroy the record of who authorised contact (and is unachievable through the '
  'append-only children), RESTRICT would make a tenant with outreach history undeletable. '
  'MATCH SIMPLE keeps an unanchored task legal.';

-- Supports the referential-integrity scan performed by ON DELETE SET NULL, and
-- the "everything we are about to send this person" read. Partial: an
-- unanchored task is the common case and does not belong in this index.
CREATE INDEX IF NOT EXISTS idx_outreach_tasks_company_person
  ON public.outreach_tasks (company_id, person_id)
  WHERE person_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. CONTRACT 13 — make the identity degradation visible on the decision log.
--
--    Governance may proceed without a person anchor; it then matches on the
--    target alone, which is strictly weaker (a person-anchored do-not-contact
--    record cannot match). That is a legitimate degradation, but until now it
--    was SILENT: an allowed decision taken with full identity and one taken
--    with none were indistinguishable in the log. These three columns make the
--    difference a recorded fact.
--
--    `identity_anchor` is a closed vocabulary mirroring Contract 13's
--    resolution order exactly:
--      explicit — the caller supplied a canonical person id
--      task     — read from outreach_tasks.person_id (the Contract 12 anchor)
--      lead     — resolved through leads.unified_person_id
--      none     — no anchor could be established; target-only matching
--    NULL means the decision predates this migration and says nothing about
--    which anchor was used — deliberately not defaulted to a value that would
--    make an old row look like it carried information it never had.
--
--    NO FOREIGN KEY is attached to `outreach_decisions.person_id`, and that is
--    not an oversight. `outreach_decisions` carries `ws3_reject_mutation` on
--    BEFORE UPDATE OR DELETE. A referential action fires row triggers, so an
--    `ON DELETE SET NULL` would raise `restrict_violation` and make the person
--    row undeletable, and `ON DELETE CASCADE` would be refused for the same
--    reason. Beyond the mechanics the semantics agree: a decision record must
--    keep naming the person it was about even after that person is erased from
--    the spine — that is what makes it an audit record.
-- ---------------------------------------------------------------------------
ALTER TABLE public.outreach_decisions ADD COLUMN IF NOT EXISTS person_id uuid;
ALTER TABLE public.outreach_decisions ADD COLUMN IF NOT EXISTS identity_anchor text;
ALTER TABLE public.outreach_decisions ADD COLUMN IF NOT EXISTS identity_degraded boolean;

DO $decision_cols$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'outreach_decisions'
       AND con.conname = 'outreach_decisions_identity_anchor_valid'
  ) THEN
    ALTER TABLE public.outreach_decisions
      ADD CONSTRAINT outreach_decisions_identity_anchor_valid
      CHECK (identity_anchor IS NULL OR identity_anchor IN ('explicit', 'task', 'lead', 'none'));
  END IF;

  -- The two facts must agree: 'none' is exactly the degraded case, and every
  -- resolved anchor is exactly the non-degraded case. Without this the writer
  -- could drift and the log would answer the question inconsistently.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'outreach_decisions'
       AND con.conname = 'outreach_decisions_identity_coherent'
  ) THEN
    ALTER TABLE public.outreach_decisions
      ADD CONSTRAINT outreach_decisions_identity_coherent
      CHECK (
        identity_anchor IS NULL
        OR identity_degraded IS NULL
        OR (identity_degraded = (identity_anchor = 'none'))
      );
  END IF;
END
$decision_cols$;

COMMENT ON COLUMN public.outreach_decisions.identity_degraded IS
  'Contract 13. TRUE when this decision was taken with NO canonical person anchor and '
  'therefore matched on the target alone — strictly weaker, because a person-anchored '
  'governance record cannot match. NULL on decisions written before A3.';

-- ---------------------------------------------------------------------------
-- 5. Governance convergence advisory.
--
--    `contact_governance_records` is canonical. `suppression_entries` is to be
--    retired outright; `outreach_suppressions` is merge-then-retire. All three
--    hold zero rows in production, so THIS WAVE HAS NO DATA TO MERGE and the
--    convergence is performed in the service layer instead. Neither legacy
--    table is dropped here: retirement needs a proven-zero-consumer sweep that
--    is out of scope.
--
--    A WARNING (never an exception) is raised if a legacy table turns out to
--    hold rows, so that an operator applying this against an environment the
--    audit did not cover learns a data merge is owed. Failing would be wrong:
--    this migration converts none of that data, and blocking the anchor on it
--    would help nobody.
-- ---------------------------------------------------------------------------
DO $convergence$
DECLARE
  v_legacy bigint := 0;
  v_ws3    bigint := 0;
BEGIN
  IF to_regclass('public.suppression_entries') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.suppression_entries' INTO v_legacy;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.outreach_suppressions' INTO v_ws3;

  IF v_legacy > 0 OR v_ws3 > 0 THEN
    RAISE WARNING 'a3_convergence: legacy suppression rows exist (suppression_entries=%, '
                  'outreach_suppressions=%). A3 migrates CONSUMERS only; these rows still '
                  'need a deliberate merge into contact_governance_records before either '
                  'table can be retired.', v_legacy, v_ws3;
  END IF;
END
$convergence$;

-- ---------------------------------------------------------------------------
-- 6. Postconditions. Any failure rolls the whole migration back.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_tbl     text;
  v_type    text;
  v_n       int;
  v_deltype "char";
  v_setcols int2[];
  v_person  int2;
BEGIN
  -- 6a. Every tenant column in the family is uuid.
  FOREACH v_tbl IN ARRAY ARRAY[
    'outreach_tasks', 'outreach_approvals', 'outreach_attempts',
    'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions',
    'outreach_governance_config', 'outreach_internal_work_items',
    'outreach_suppressions'
  ] LOOP
    SELECT format_type(atttypid, atttypmod) INTO v_type
      FROM pg_attribute
     WHERE attrelid = ('public.' || v_tbl)::regclass AND attname = 'company_id';
    IF v_type IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION 'a3 postcondition: %.company_id is %, expected uuid',
        v_tbl, coalesce(v_type, 'absent');
    END IF;
  END LOOP;

  -- 6b. The anchor column exists and is uuid.
  SELECT format_type(atttypid, atttypmod) INTO v_type
    FROM pg_attribute
   WHERE attrelid = 'public.outreach_tasks'::regclass AND attname = 'person_id';
  IF v_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'a3 postcondition: outreach_tasks.person_id is %, expected uuid',
      coalesce(v_type, 'absent');
  END IF;

  -- 6c. The composite foreign key exists, spans two columns, targets
  --     unified_persons, and nulls ONLY the person leg on delete.
  SELECT con.confdeltype, con.confdelsetcols, array_length(con.conkey, 1)
    INTO v_deltype, v_setcols, v_n
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
    JOIN pg_class t ON t.oid = con.confrelid
   WHERE con.contype = 'f' AND s.relname = 'outreach_tasks'
     AND t.relname = 'unified_persons'
     AND con.conname = 'outreach_tasks_person_tenant_fk';

  IF v_n IS NULL THEN
    RAISE EXCEPTION 'a3 postcondition: outreach_tasks_person_tenant_fk is missing';
  END IF;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'a3 postcondition: outreach_tasks_person_tenant_fk spans % column(s), expected 2',
      v_n;
  END IF;
  IF v_deltype <> 'n' THEN
    RAISE EXCEPTION 'a3 postcondition: outreach_tasks_person_tenant_fk delete action is %, '
                    'expected SET NULL', v_deltype;
  END IF;

  SELECT attnum INTO v_person FROM pg_attribute
   WHERE attrelid = 'public.outreach_tasks'::regclass AND attname = 'person_id';
  IF v_setcols IS DISTINCT FROM ARRAY[v_person]::int2[] THEN
    RAISE EXCEPTION 'a3 postcondition: SET NULL column list is %, expected exactly {person_id}. '
                    'A bare SET NULL would strip the tenant off a surviving audit row.', v_setcols;
  END IF;

  -- 6d. WS-3's idempotency anchor survived the retype.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
     WHERE c.relname = 'outreach_tasks' AND con.conname = 'outreach_tasks_identity_unique'
       AND con.contype = 'u' AND array_length(con.conkey, 1) = 3
  ) THEN
    RAISE EXCEPTION 'a3 postcondition: outreach_tasks_identity_unique (company_id, lead_id, '
                    'plan_task_id) did not survive; WS-3 idempotency is broken';
  END IF;

  -- 6e. The append-only guards are all still attached. A retype does not touch
  --     triggers, but this family's whole value rests on them, so it is
  --     asserted rather than assumed: 7 x ws3_reject_mutation +
  --     ws3_suppression_guard + the task provenance guard.
  SELECT count(*)::int INTO v_n
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_proc p ON p.oid = tg.tgfoid
   WHERE NOT tg.tgisinternal
     AND c.relname LIKE 'outreach\_%'
     AND p.proname IN ('ws3_reject_mutation', 'ws3_suppression_guard', 'ws3_protect_task_provenance');
  IF v_n < 7 THEN
    RAISE EXCEPTION 'a3 postcondition: only % append-only/provenance trigger(s) on the outreach '
                    'family, expected at least 7', v_n;
  END IF;

  RAISE NOTICE 'a3: person anchor established; % outreach guard trigger(s) verified intact.', v_n;
END
$verify$;

COMMIT;
