-- W2 — canonical intelligence / UUID reconciliation.
--
-- Retypes three legacy `text` identifier columns to `uuid` and gives them real
-- foreign keys, so the intelligence layer participates in the same referential
-- model as the W1 foundation instead of merely resembling it.
--
--   lead_intelligence.company_id           text -> uuid  FK -> companies(id)
--   lead_intelligence.unified_person_id    text -> uuid  composite FK -> unified_persons(id, company_id)
--   lead_intelligence_profiles.company_id  text -> uuid  FK -> companies(id)
--
-- Deletes nothing, deduplicates nothing, merges nothing, rewrites no value.
--
-- ─── WHAT company_id ACTUALLY MEANS (the decision this migration turns on) ──
-- W1 draws a hard line between `companies` (the Omnivyra TENANT) and
-- `prospect_accounts` (the external company being pursued). Retyping
-- `company_id` toward the wrong one would produce semantic corruption that
-- looks like progress, so it was settled from production data, not from the
-- column's name:
--
--   18/18 rows carry a syntactically valid UUID
--   18/18 match a row in `companies`
--    0/18 match a row in `prospect_accounts`
--   1 distinct value across all 18 rows
--
-- `company_id` is the TENANT. It keeps pointing at `companies`. Nothing here
-- reinterprets it as a prospect account.
--
-- ─── WHY IN-PLACE CONVERSION, AND WHY THAT IS NOT THE LAZY CHOICE ──────────
-- A shadow-column migration (add uuid column, backfill, dual-write, swap,
-- retire) exists to solve two problems: a long table rewrite under load, and
-- deploy skew where old code still reads the old column. Neither applies:
--
--   • 18 rows and 0 rows. The rewrite is instantaneous.
--   • NO application change is required. Every caller reaches these columns
--     through PostgREST with JS strings; Postgres coerces a UUID-shaped string
--     literal on the way in, and PostgREST renders `uuid` back as a JSON string
--     on the way out. The TypeScript types are already `string` and stay
--     correct. There is no window in which old code sees the wrong shape.
--
-- So the staged strategy would add a second column, dual-write logic and a
-- retirement migration to buy protection against risks this table does not
-- have, while leaving more moving parts behind. In-place is smaller AND safer
-- here — but only because the rollback objection was disproved:
--
-- ─── ROLLBACK IS LOSSLESS, PROVEN NOT ASSUMED ─────────────────────────────
-- In-place conversion is usually criticised because it destroys the original
-- text. Verified against production before authoring:
--
--   every row satisfies  company_id        = company_id::uuid::text
--   every row satisfies  unified_person_id = unified_person_id::uuid::text
--   0 rows with uppercase, 0 with surrounding whitespace, all length 36
--
-- The stored text is ALREADY the canonical UUID rendering, so `uuid -> text`
-- returns byte-identical values. The rollback is a true inverse, not an
-- approximation.
--
-- ─── TENANT CORRECTNESS IS ENFORCED, NOT ASSERTED ─────────────────────────
-- A plain FK on `unified_person_id` would let intelligence in tenant B point at
-- a person in tenant A — type-correct and semantically wrong, which is the
-- failure this programme exists to prevent. The composite FK
--
--     (unified_person_id, company_id) -> unified_persons (id, company_id)
--
-- makes that combination unrepresentable. This is not a new invention: it is
-- the pattern already used by `canonical_leads (user_id, company_id) ->
-- canonical_users (id, company_id)` (migration 20260409). It requires a UNIQUE
-- (id, company_id) on unified_persons, added below — additive, and the only
-- change this migration makes to the W1 spine.
--
-- MATCH SIMPLE (the default) means the constraint is skipped when
-- `unified_person_id` is NULL, so intelligence that has not yet been linked to
-- a person remains legal. That is intended.
--
-- ─── ON DELETE RESTRICT, DELIBERATELY ─────────────────────────────────────
-- CASCADE would let deleting one person destroy intelligence records — the
-- precise outcome the W2 brief forbids. SET NULL is not expressible on a
-- composite key whose `company_id` leg is NOT NULL. RESTRICT preserves
-- intelligence unconditionally: a person that intelligence still references
-- cannot be deleted out from under it.
--
-- This costs nothing today: no application code path deletes
-- `unified_persons` (verified by repository search). If deletion is introduced
-- later it must decide what happens to the intelligence first — which is the
-- correct order.
--
-- `company_id -> companies(id)` uses CASCADE, matching every other tenant FK in
-- the schema (unified_persons, prospect_accounts, identity_claims): removing a
-- tenant removes that tenant's data.
--
-- ─── SELF-GUARDING ─────────────────────────────────────────────────────────
-- The preflight below re-validates every precondition at APPLY time rather than
-- trusting the audit that preceded it. If a single row drifted in between, the
-- migration aborts with a specific reason and changes nothing — the whole
-- statement is one transaction.
--
-- Idempotent: re-running detects the reconciled state and returns.
--
-- Rollback: supabase/migrations/rollbacks/w2_lead_intelligence_uuid_reconciliation_rollback.sql

-- ── 0. preflight — refuse to convert anything that is not provably safe ────

DO $$
DECLARE
  bad_co_syntax   bigint;
  bad_co_orphan   bigint;
  bad_up_syntax   bigint;
  bad_up_orphan   bigint;
  tenant_mismatch bigint;
  bad_lip_syntax  bigint;
  bad_lip_orphan  bigint;
  already_uuid    boolean;
BEGIN
  SELECT (data_type = 'uuid') INTO already_uuid
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'lead_intelligence' AND column_name = 'company_id';

  IF already_uuid THEN
    RAISE NOTICE 'w2: already reconciled; nothing to do';
    RETURN;
  END IF;

  -- Syntactic validity. A single malformed value must stop the migration, not
  -- be coerced or discarded.
  SELECT count(*) INTO bad_co_syntax FROM public.lead_intelligence
   WHERE company_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  SELECT count(*) INTO bad_up_syntax FROM public.lead_intelligence
   WHERE unified_person_id IS NOT NULL
     AND unified_person_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  SELECT count(*) INTO bad_lip_syntax FROM public.lead_intelligence_profiles
   WHERE company_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  IF bad_co_syntax > 0 OR bad_up_syntax > 0 OR bad_lip_syntax > 0 THEN
    RAISE EXCEPTION 'w2_preflight_failed: non-UUID values present (lead_intelligence.company_id=%, .unified_person_id=%, profiles.company_id=%). Reconcile the data first; W2 must not coerce or discard rows.',
      bad_co_syntax, bad_up_syntax, bad_lip_syntax USING ERRCODE = 'restrict_violation';
  END IF;

  -- Referential validity. A value that parses but points nowhere would fail on
  -- FK creation anyway; failing here names the actual problem.
  SELECT count(*) INTO bad_co_orphan FROM public.lead_intelligence li
   WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = li.company_id::uuid);
  SELECT count(*) INTO bad_up_orphan FROM public.lead_intelligence li
   WHERE li.unified_person_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.unified_persons u WHERE u.id = li.unified_person_id::uuid);
  SELECT count(*) INTO bad_lip_orphan FROM public.lead_intelligence_profiles p
   WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p.company_id::uuid);

  IF bad_co_orphan > 0 OR bad_up_orphan > 0 OR bad_lip_orphan > 0 THEN
    RAISE EXCEPTION 'w2_preflight_failed: orphan references (company=%, person=%, profile company=%). Preserve and investigate; do not delete.',
      bad_co_orphan, bad_up_orphan, bad_lip_orphan USING ERRCODE = 'restrict_violation';
  END IF;

  -- Tenant correctness. The composite FK below would reject these anyway; this
  -- reports them as the integrity problem they are rather than as a constraint
  -- violation.
  SELECT count(*) INTO tenant_mismatch
    FROM public.lead_intelligence li
    JOIN public.unified_persons u ON u.id = li.unified_person_id::uuid
   WHERE li.unified_person_id IS NOT NULL
     AND u.company_id::text <> li.company_id;

  IF tenant_mismatch > 0 THEN
    RAISE EXCEPTION 'w2_preflight_failed: % intelligence row(s) reference a person belonging to a DIFFERENT tenant. This is a data-integrity blocker; do not reassign silently.',
      tenant_mismatch USING ERRCODE = 'restrict_violation';
  END IF;

  -- ── 1. unified_persons: the key the composite FK must target ────────────
  -- Additive. (id) is already unique via the PK; this pairs it with the tenant
  -- so a foreign key can reference the pair.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_unified_persons_id_company
    ON public.unified_persons (id, company_id);

  -- ── 2. lead_intelligence ────────────────────────────────────────────────
  -- Existing indexes on these columns are rebuilt automatically by the type
  -- change; none is dropped or recreated by hand.
  ALTER TABLE public.lead_intelligence
    ALTER COLUMN company_id TYPE uuid USING company_id::uuid,
    ALTER COLUMN unified_person_id TYPE uuid USING unified_person_id::uuid;

  ALTER TABLE public.lead_intelligence
    ADD CONSTRAINT lead_intelligence_company_fk
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

  ALTER TABLE public.lead_intelligence
    ADD CONSTRAINT lead_intelligence_person_tenant_fk
      FOREIGN KEY (unified_person_id, company_id)
      REFERENCES public.unified_persons(id, company_id)
      ON DELETE RESTRICT;

  -- ── 3. lead_intelligence_profiles ───────────────────────────────────────
  ALTER TABLE public.lead_intelligence_profiles
    ALTER COLUMN company_id TYPE uuid USING company_id::uuid;

  ALTER TABLE public.lead_intelligence_profiles
    ADD CONSTRAINT lead_intelligence_profiles_company_fk
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
END $$;

COMMENT ON CONSTRAINT lead_intelligence_person_tenant_fk ON public.lead_intelligence IS
  'Composite tenant-safe FK: intelligence may only reference a person in the SAME tenant. Mirrors canonical_leads -> canonical_users(id, company_id). ON DELETE RESTRICT preserves intelligence — a person that intelligence still references cannot be deleted.';

COMMENT ON COLUMN public.lead_intelligence.company_id IS
  'Omnivyra TENANT (companies.id) — NOT a prospect_accounts.id. Confirmed from production: 18/18 matched companies, 0 matched prospect_accounts.';
