-- ROLLBACK — A3: canonical person anchor for lead outreach.
-- Reverses supabase/migrations/20261011000000_a3_outreach_person_anchor.sql
--
-- SAFETY — WHY THIS ROLLBACK IS A TRUE INVERSE
-- -------------------------------------------
-- Reverting a type change is normally lossy: the original text is gone and only
-- an approximation of it can be reconstructed. That objection does not apply
-- here, and it was checked rather than assumed.
--
-- All nine outreach tables held ZERO rows when the forward migration ran
-- (verified read-only against production, 2026-09-01), so there is no prior
-- text to reproduce at all. Any row written AFTER the forward migration holds a
-- uuid by construction, and `uuid -> text` renders it in exactly the canonical
-- 8-4-4-4-12 form the text column was already constrained to hold. This
-- rollback therefore restores the exact prior schema, not a lookalike.
--
-- WHAT IT GIVES UP
-- ----------------
-- Reverting removes the ONLY structural guarantee that an outreach task cannot
-- anchor to a person in a different tenant, and removes the columns that make a
-- target-only governance degradation visible in the decision log — after which
-- an allowed decision taken with full identity and one taken with none become
-- indistinguishable again. It does NOT re-introduce any send capability, and it
-- does not weaken any fail-closed path: those live in the service layer.
--
-- Roll back only if the forward migration itself caused a worse failure. Fixing
-- forward is almost always correct.
--
-- ORDER
-- -----
-- Constraints and indexes are dropped before their columns are retyped or
-- removed — a foreign key cannot survive its column changing type, and a
-- partial index cannot survive its predicate column being dropped. One
-- transaction: a failure at any step leaves the anchored state intact.
--
-- `uq_unified_persons_id_company` is NOT dropped. Unlike W2's rollback, A3 did
-- not create it — it already existed and is depended on by W2, W4, W5 and LI-2.
-- Dropping it here would break constraints this migration never owned.
--
-- The three `length(btrim(company_id)) > 0` CHECK constraints are RE-CREATED,
-- because the forward migration dropped them (they are text predicates and
-- `btrim(uuid)` does not exist). Restoring them is what makes the schema
-- byte-for-byte what it was, rather than merely functionally similar.
--
-- NOT TOUCHED: no row is deleted, no value rewritten, no trigger altered, no
-- legacy suppression table changed, and `consent_records` is not referenced at
-- all.
--
-- NOTE: rollback files are deliberately non-idempotent and are exempt from the
-- migration quality gate (scripts/check-migration-quality.js).

BEGIN;

DO $rollback$
DECLARE
  v_tbl  text;
  v_rows bigint;
  v_all  bigint := 0;
BEGIN
  -- Report what is being reverted. A rollback that silently discards a
  -- structural guarantee over populated tables should say so in the log.
  FOREACH v_tbl IN ARRAY ARRAY[
    'outreach_tasks', 'outreach_approvals', 'outreach_attempts',
    'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions',
    'outreach_governance_config', 'outreach_internal_work_items',
    'outreach_suppressions'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_tbl) INTO v_rows;
    v_all := v_all + v_rows;
  END LOOP;
  RAISE NOTICE 'a3_rollback: reverting the person anchor across the outreach family (% row(s) total).', v_all;

  IF EXISTS (SELECT 1 FROM public.outreach_tasks WHERE person_id IS NOT NULL) THEN
    RAISE WARNING 'a3_rollback: outreach_tasks holds anchored task(s); the person_id column and '
                  'every anchor stored in it are about to be DROPPED. Capture them first if the '
                  'link matters.';
  END IF;

  -- 1. Constraints and indexes first — neither can outlive its column.
  ALTER TABLE public.outreach_tasks
    DROP CONSTRAINT IF EXISTS outreach_tasks_person_tenant_fk;
  DROP INDEX IF EXISTS public.idx_outreach_tasks_company_person;

  ALTER TABLE public.outreach_decisions
    DROP CONSTRAINT IF EXISTS outreach_decisions_identity_coherent;
  ALTER TABLE public.outreach_decisions
    DROP CONSTRAINT IF EXISTS outreach_decisions_identity_anchor_valid;

  -- 2. The Contract 12 anchor and the Contract 13 decision columns.
  ALTER TABLE public.outreach_tasks       DROP COLUMN IF EXISTS person_id;
  ALTER TABLE public.outreach_decisions   DROP COLUMN IF EXISTS person_id;
  ALTER TABLE public.outreach_decisions   DROP COLUMN IF EXISTS identity_anchor;
  ALTER TABLE public.outreach_decisions   DROP COLUMN IF EXISTS identity_degraded;

  -- 3. Tenant column back to text across the family. `::text` on a uuid yields
  --    the canonical rendering, which is exactly what the text column held.
  --    Indexes and unique constraints over the column — including
  --    outreach_tasks_identity_unique — are rebuilt automatically, as they were
  --    on the way in.
  FOREACH v_tbl IN ARRAY ARRAY[
    'outreach_tasks', 'outreach_approvals', 'outreach_attempts',
    'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions',
    'outreach_governance_config', 'outreach_internal_work_items',
    'outreach_suppressions'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN company_id TYPE text USING company_id::text',
      v_tbl);
  END LOOP;

  -- 4. Restore the text-shaped tenant CHECK constraints the forward migration
  --    had to drop. Only now are they expressible again.
  ALTER TABLE public.outreach_tasks
    ADD CONSTRAINT outreach_tasks_company_not_blank
    CHECK (length(btrim(company_id)) > 0);
  ALTER TABLE public.outreach_governance_config
    ADD CONSTRAINT outreach_governance_config_company_not_blank
    CHECK (length(btrim(company_id)) > 0);
  ALTER TABLE public.outreach_internal_work_items
    ADD CONSTRAINT outreach_internal_work_items_company_not_blank
    CHECK (length(btrim(company_id)) > 0);

  RAISE NOTICE 'a3_rollback: complete; the outreach family is back to text tenants with no person anchor.';
END
$rollback$;

COMMIT;
