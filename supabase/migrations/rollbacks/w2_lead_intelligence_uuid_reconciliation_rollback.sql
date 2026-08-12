-- ROLLBACK — W2: canonical intelligence / UUID reconciliation.
-- Reverses supabase/migrations/20260921000000_w2_lead_intelligence_uuid_reconciliation.sql
--
-- SAFETY — WHY THIS ROLLBACK IS A TRUE INVERSE
-- -------------------------------------------
-- Reverting a type change is normally lossy: the original text is gone and only
-- an approximation of it can be reconstructed. That objection does not apply
-- here, and it was checked rather than assumed.
--
-- Before the forward migration ran, every stored value already WAS the canonical
-- UUID rendering — lowercase, hyphenated, length 36, no surrounding whitespace —
-- verified in production by
--
--     company_id        = company_id::uuid::text          (18/18)
--     unified_person_id = unified_person_id::uuid::text    (18/18)
--
-- so `uuid -> text` reproduces the original strings byte for byte. Any row
-- written AFTER the forward migration is a uuid by construction and renders the
-- same way. This rollback therefore restores the exact prior state, not a
-- normalized lookalike.
--
-- WHAT IT GIVES UP
-- ----------------
-- Reverting reinstates the drift W2 removed: the intelligence layer loses its
-- foreign keys, and with them the guarantee that a row cannot reference a person
-- in a different tenant. Roll back only if the forward migration itself caused a
-- worse failure. Fixing forward is almost always correct.
--
-- ORDER
-- -----
-- Constraints are dropped before the columns are retyped — a foreign key cannot
-- survive its column changing type. One transaction: a failure at any step
-- leaves the reconciled state intact.
--
-- uq_unified_persons_id_company is dropped last because the composite FK
-- depends on it. It is additive and harmless to keep; it is removed only so the
-- rollback is a complete inverse.
--
-- NOT TOUCHED: no row is deleted, no value rewritten, no legacy model altered,
-- and lead_intelligence_events / contacts / leads are not referenced at all.
--
-- NOTE: rollback files are deliberately non-idempotent and are exempt from the
-- migration quality gate (scripts/check-migration-quality.js).

DO $$
DECLARE
  li_rows  bigint;
  lip_rows bigint;
BEGIN
  SELECT count(*) INTO li_rows  FROM public.lead_intelligence;
  SELECT count(*) INTO lip_rows FROM public.lead_intelligence_profiles;
  RAISE NOTICE 'w2_rollback: reverting with % lead_intelligence and % profile row(s); values are restored byte-identically',
    li_rows, lip_rows;

  -- 1. Constraints first — an FK cannot outlive its column's type.
  ALTER TABLE public.lead_intelligence
    DROP CONSTRAINT IF EXISTS lead_intelligence_person_tenant_fk;
  ALTER TABLE public.lead_intelligence
    DROP CONSTRAINT IF EXISTS lead_intelligence_company_fk;
  ALTER TABLE public.lead_intelligence_profiles
    DROP CONSTRAINT IF EXISTS lead_intelligence_profiles_company_fk;

  -- 2. Types back to text. ::text on a uuid yields the canonical rendering,
  --    which is exactly what was stored before.
  ALTER TABLE public.lead_intelligence
    ALTER COLUMN company_id TYPE text USING company_id::text,
    ALTER COLUMN unified_person_id TYPE text USING unified_person_id::text;

  ALTER TABLE public.lead_intelligence_profiles
    ALTER COLUMN company_id TYPE text USING company_id::text;

  -- 3. The index that existed only to support the composite FK.
  DROP INDEX IF EXISTS public.uq_unified_persons_id_company;
END $$;
