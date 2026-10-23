-- G-6 — the enrichment attempt ledger obeys the tenant invariant the rest of the
-- enrichment chain already obeys.
--
-- WHY. D22-B2's G-3 composition closure found `prospect_enrichment_attempts` to be
-- the ONE table in the enrichment chain whose entity foreign keys are
-- single-column, while every table downstream of it is tenant-coupled:
--
--   attempts (before) : FOREIGN KEY (account_id)
--                           REFERENCES prospect_accounts(id)
--   source_records    : FOREIGN KEY (account_id, organization_id)
--                           REFERENCES prospect_accounts(id, organization_id)
--   source_assertions : same shape
--   canonical_attribute_decisions : same shape
--
-- The consequence was observed at runtime, not theorised. Tenant A enriching
-- tenant B's account:
--
--   attempt row INSERTED with organization_id = A and account_id = B's account
--     -> the provider is CONTACTED and tenant A's credential is spent
--       -> the evidence insert is then refused by the composite FK downstream
--         -> canonical data stays correct, and the ledger holds a row attributing
--            a paid call about B's account to A
--
-- So canonical integrity was never at risk; ATTRIBUTION was. The owner decision
-- (D22-B2-G6) is that this is not accepted: the attempt ledger must reject the
-- relationship itself, which moves the refusal to BEFORE any provider transport —
-- the attempt is opened first, so a failure there cannot reach the adapter.
--
-- ─── WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT ──────────────────
-- Exactly two constraints are replaced. Everything else is untouched:
--
--   KEPT: ON DELETE CASCADE on both entity legs. The evidence tables use
--         SET NULL (column_list) because evidence must outlive the entity it
--         describes; an ATTEMPT is a record of work on an entity and has always
--         cascaded with it. Changing that would alter the attempt lifecycle,
--         which this migration is not authorised to do.
--   KEPT: organization_id -> companies(id), and source_record_id -> source_records(id).
--   KEPT: every index, including the live partial unique indexes that arbitrate
--         the lease, the attempt-number uniqueness indexes, and RLS.
--   KEPT: every column, name, default and check.
--
-- ─── THE PARENT KEYS ALREADY EXIST ────────────────────────────────────────
--   uq_prospect_accounts_id_org    (id, organization_id)
--   uq_unified_persons_id_company  (id, company_id)
-- Neither is created here. Note the person parent is keyed on `company_id`:
-- `unified_persons` has no `organization_id` column, and `(person_id,
-- organization_id) -> unified_persons(id, company_id)` is exactly how
-- source_records and source_assertions already spell this relationship. The
-- naming asymmetry is pre-existing and is followed rather than corrected here.
--
-- ─── NULL LEGS ARE STILL LEGAL ────────────────────────────────────────────
-- An attempt names a person OR an account, never both, so one leg is always NULL.
-- A composite foreign key under the default MATCH SIMPLE is satisfied whenever any
-- referencing column is NULL, so an account attempt trivially satisfies the person
-- key and vice versa. This is the same mechanism the evidence tables rely on, and
-- the existing CHECK that exactly one is set is untouched.
--
-- ─── IT REFUSES RATHER THAN REPAIRS ───────────────────────────────────────
-- The preflight RAISEs on any row the new keys would reject — a tenant mismatch or
-- an orphan — and names the counts. It does NOT delete, re-point or quarantine
-- anything: inventing a cleanup policy for an audit ledger would destroy the
-- record of spend this table exists to hold, and which rows are wrong is a
-- question for whoever reads them. Applying this to a database with such rows is
-- therefore a loud, safe no-op.
--
-- IDEMPOTENT. Guarded on constraint existence, so replaying it onto an already
-- converted schema changes nothing, which the real-schema harness requires.
--
-- Rollback: re-adding the single-column keys would restore the defect. Not
-- authored deliberately; the conversion is strictly narrowing and the old shape is
-- the thing being removed.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_account_mismatch INT;
  v_person_mismatch  INT;
  v_orphan_account   INT;
  v_orphan_person    INT;
BEGIN
  IF to_regclass('public.prospect_enrichment_attempts') IS NULL THEN
    RAISE EXCEPTION 'G-6 preflight: public.prospect_enrichment_attempts is missing';
  END IF;

  -- The parent keys this migration depends on. Not created here; if either were
  -- absent the composite reference could not be built at all.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_prospect_accounts_id_org') THEN
    RAISE EXCEPTION 'G-6 preflight: uq_prospect_accounts_id_org is missing — cannot build a tenant-safe account reference';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_unified_persons_id_company') THEN
    RAISE EXCEPTION 'G-6 preflight: uq_unified_persons_id_company is missing — cannot build a tenant-safe person reference';
  END IF;

  -- Rows the new keys would reject. Reported, never repaired.
  SELECT count(*) INTO v_account_mismatch
    FROM public.prospect_enrichment_attempts a
    JOIN public.prospect_accounts p ON p.id = a.account_id
   WHERE a.account_id IS NOT NULL AND p.organization_id <> a.organization_id;

  SELECT count(*) INTO v_person_mismatch
    FROM public.prospect_enrichment_attempts a
    JOIN public.unified_persons u ON u.id = a.person_id
   WHERE a.person_id IS NOT NULL AND u.company_id <> a.organization_id;

  SELECT count(*) INTO v_orphan_account
    FROM public.prospect_enrichment_attempts a
   WHERE a.account_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.prospect_accounts p WHERE p.id = a.account_id);

  SELECT count(*) INTO v_orphan_person
    FROM public.prospect_enrichment_attempts a
   WHERE a.person_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.unified_persons u WHERE u.id = a.person_id);

  IF v_account_mismatch > 0 OR v_person_mismatch > 0
     OR v_orphan_account > 0 OR v_orphan_person > 0 THEN
    RAISE EXCEPTION
      'G-6 ABORTED: the attempt ledger holds rows the tenant keys would reject — '
      'account_tenant_mismatch=%, person_tenant_mismatch=%, orphan_account=%, orphan_person=%. '
      'Nothing was changed. These rows record provider spend and are not repaired here: '
      'decide what they mean before converting the keys.',
      v_account_mismatch, v_person_mismatch, v_orphan_account, v_orphan_person;
  END IF;

  RAISE NOTICE 'G-6 preflight: 0 incompatible rows; parent keys present.';
END
$preflight$;

-- ---------------------------------------------------------------------------
-- Replace the two single-column entity keys with tenant-coupled ones.
--
-- Dropped and re-added rather than altered: PostgreSQL has no way to widen a
-- foreign key's column list in place.
-- ---------------------------------------------------------------------------
DO $convert$
BEGIN
  -- ── account ──────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname='prospect_enrichment_attempts_account_id_fkey') THEN
    ALTER TABLE public.prospect_enrichment_attempts
      DROP CONSTRAINT prospect_enrichment_attempts_account_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='prospect_enrichment_attempts_account_tenant_fk') THEN
    ALTER TABLE public.prospect_enrichment_attempts
      ADD CONSTRAINT prospect_enrichment_attempts_account_tenant_fk
      FOREIGN KEY (account_id, organization_id)
      REFERENCES public.prospect_accounts (id, organization_id) ON DELETE CASCADE;
  END IF;

  -- ── person ───────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname='prospect_enrichment_attempts_person_id_fkey') THEN
    ALTER TABLE public.prospect_enrichment_attempts
      DROP CONSTRAINT prospect_enrichment_attempts_person_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='prospect_enrichment_attempts_person_tenant_fk') THEN
    ALTER TABLE public.prospect_enrichment_attempts
      ADD CONSTRAINT prospect_enrichment_attempts_person_tenant_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE CASCADE;
  END IF;
END
$convert$;

COMMENT ON CONSTRAINT prospect_enrichment_attempts_account_tenant_fk
  ON public.prospect_enrichment_attempts IS
  'G-6: tenant-coupled. An attempt may only name an account belonging to the '
  'tenant the attempt is attributed to. Because the attempt is opened BEFORE the '
  'provider is resolved, this refusal happens before any provider transport — '
  'which is the whole point of the key being composite.';

COMMENT ON CONSTRAINT prospect_enrichment_attempts_person_tenant_fk
  ON public.prospect_enrichment_attempts IS
  'G-6: tenant-coupled, keyed on unified_persons(id, company_id) because that is '
  'that table''s tenant column. Same guarantee as the account leg.';

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_composite INT;
  v_single    INT;
BEGIN
  -- Both new keys exist, each two-column, each carrying the tenant.
  SELECT count(*) INTO v_composite
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype='f' AND s.relname='prospect_enrichment_attempts'
     AND array_length(con.conkey, 1) = 2
     AND con.conname IN ('prospect_enrichment_attempts_account_tenant_fk',
                         'prospect_enrichment_attempts_person_tenant_fk');
  IF v_composite <> 2 THEN
    RAISE EXCEPTION 'G-6 postcondition: expected 2 composite tenant FKs, found %', v_composite;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_class s ON s.oid = con.conrelid
     WHERE con.contype='f' AND s.relname='prospect_enrichment_attempts'
       AND array_length(con.conkey, 1) = 2
       AND pg_get_constraintdef(con.oid) NOT LIKE '%, organization_id)%'
  ) THEN
    RAISE EXCEPTION 'G-6 postcondition: a composite FK does not carry organization_id as its second leg';
  END IF;

  -- The old single-column entity keys are gone. The tenant and source-record
  -- keys are legitimately single-column and are NOT counted here.
  SELECT count(*) INTO v_single
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype='f' AND s.relname='prospect_enrichment_attempts'
     AND con.conname IN ('prospect_enrichment_attempts_account_id_fkey',
                         'prospect_enrichment_attempts_person_id_fkey');
  IF v_single <> 0 THEN
    RAISE EXCEPTION 'G-6 postcondition: % single-column entity FK(s) survive', v_single;
  END IF;

  -- The semantics that had to be preserved.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='prospect_enrichment_attempts_account_tenant_fk' AND confdeltype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='prospect_enrichment_attempts_person_tenant_fk' AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'G-6 postcondition: ON DELETE CASCADE was not preserved on both entity legs';
  END IF;

  -- The lease arbiter and the attempt-number uniqueness must be untouched.
  IF (SELECT count(*) FROM pg_indexes
       WHERE schemaname='public'
         AND indexname IN ('prospect_enrichment_attempts_person_live',
                           'prospect_enrichment_attempts_account_live',
                           'prospect_enrichment_attempts_person_unique',
                           'prospect_enrichment_attempts_account_unique')) <> 4 THEN
    RAISE EXCEPTION 'G-6 postcondition: a lease or attempt-number index is missing';
  END IF;

  RAISE NOTICE 'G-6: attempt ledger is tenant-coupled — 2 composite FKs, ON DELETE CASCADE preserved, indexes intact.';
END
$verify$;

COMMIT;
