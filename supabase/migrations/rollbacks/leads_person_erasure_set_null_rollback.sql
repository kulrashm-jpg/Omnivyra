-- ROLLBACK for 20270112000001_leads_person_erasure_set_null.sql
--
-- ─── ORDER ─────────────────────────────────────────────────────────────────
-- Reverse version order, one transaction per file:
--   (20270113000000 A6-10 bridge, if applied) → 20270112000005 →
--   20270112000004 → 20270112000003 → 20270112000002 →
--   20270112000001 (this file) → 20270112000000.
-- REFUSES while any function other than this migration's own still names
-- person_erased_at or pi_erasure_detach_legacy_leads (20270112000003's finalize
-- and inconsistency detector, 20270112000004's redaction hook).
--
-- ─── WHAT IT RESTORES ──────────────────────────────────────────────────────
--   * leads.unified_person_id NOT NULL (baseline; identity-spine file 6);
--   * leads.unified_person_id without a column comment (it had none);
-- and REMOVES, in dependency order:
--   * CHECK leads_person_or_erased (dropped AFTER NOT NULL is back, so the
--     column is never unguarded inside the transaction);
--   * trigger trg_leads_person_erasure_guard and leads_person_erasure_guard();
--   * pi_erasure_detach_legacy_leads(uuid, uuid);
--   * column leads.person_erased_at.
-- leads_person_tenant_fk (W5) was never changed and stays
-- ON DELETE SET NULL (unified_person_id) — i.e. the pre-migration contradiction
-- (NOT NULL vs SET NULL) returns: deleting a person who owns a legacy lead fails
-- with 23502 again, so lead-kind persons are unerasable again.
--
-- ─── IT REFUSES WHEN ANY LEAD'S PERSON WAS ERASED ──────────────────────────
-- An erased lead has unified_person_id NULL and person_erased_at set. NOT NULL
-- cannot be restored over it, and dropping person_erased_at would destroy the
-- record that the erasure happened. Re-linking the lead to a person would be
-- re-identification, and deleting it would destroy a business record. None of
-- those is a rollback's decision, so it refuses. MEASURE FIRST:
--
--   SELECT count(*) FILTER (WHERE person_erased_at IS NOT NULL) AS erased_stamped,
--          count(*) FILTER (WHERE unified_person_id IS NULL)    AS person_null
--     FROM public.leads;
--
-- If either is non-zero, stay on this migration.

BEGIN;

DO $rollback_guard$
DECLARE
  v_dep     text;
  v_erased  bigint;
  v_null    bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.leads'::regclass AND attname = 'person_erased_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION '20270112000001 rollback refused: leads.person_erased_at does not exist (not applied, or already rolled back)';
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_dep
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('leads_person_erasure_guard', 'pi_erasure_detach_legacy_leads')
     AND (p.prosrc LIKE '%person_erased_at%' OR p.prosrc LIKE '%pi_erasure_detach_legacy_leads%');
  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION '20270112000001 rollback refused: still referenced by % - roll back 20270112000004 and 20270112000003 first', v_dep;
  END IF;

  -- Block concurrent writers to leads until COMMIT, then measure.
  LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) FILTER (WHERE person_erased_at IS NOT NULL),
         count(*) FILTER (WHERE unified_person_id IS NULL)
    INTO v_erased, v_null
    FROM public.leads;
  IF v_erased > 0 OR v_null > 0 THEN
    RAISE EXCEPTION
      '20270112000001 rollback refused: % lead(s) carry an erasure stamp and % lead(s) have no person. '
      'NOT NULL cannot be restored and person_erased_at cannot be dropped without destroying or '
      're-identifying erased data. Stay on the migration (see this file''s header).',
      v_erased, v_null;
  END IF;
END
$rollback_guard$;

ALTER TABLE public.leads ALTER COLUMN unified_person_id SET NOT NULL;
ALTER TABLE public.leads DROP CONSTRAINT leads_person_or_erased;
DROP TRIGGER trg_leads_person_erasure_guard ON public.leads;
DROP FUNCTION public.leads_person_erasure_guard();
DROP FUNCTION public.pi_erasure_detach_legacy_leads(uuid, uuid);
ALTER TABLE public.leads DROP COLUMN person_erased_at;
COMMENT ON COLUMN public.leads.unified_person_id IS NULL;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.leads'::regclass AND attname = 'unified_person_id'
                    AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION '20270112000001 rollback postcondition: leads.unified_person_id is not NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.leads'::regclass AND attname = 'person_erased_at' AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads'::regclass AND conname = 'leads_person_or_erased')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.leads'::regclass AND tgname = 'trg_leads_person_erasure_guard')
     OR to_regprocedure('public.leads_person_erasure_guard()') IS NOT NULL
     OR to_regprocedure('public.pi_erasure_detach_legacy_leads(uuid, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '20270112000001 rollback postcondition: a 20270112000001 object survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'leads_person_tenant_fk' AND conrelid = 'public.leads'::regclass) THEN
    RAISE EXCEPTION '20270112000001 rollback postcondition: leads_person_tenant_fk is missing';
  END IF;
END
$verify$;

COMMIT;
