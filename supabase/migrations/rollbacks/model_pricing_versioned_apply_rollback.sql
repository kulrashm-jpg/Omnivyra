-- ROLLBACK — B-1 follow-up: versioned apply for llm_model_pricing.
-- Reverses supabase/migrations/20270210000001_model_pricing_versioned_apply.sql
--
-- SAFETY. The forward migration only CREATEs one function; it changes no table, column, constraint or
-- index and writes no row. Dropping the function is a true inverse and loses no data.
--
-- ORDER. Roll back the CODE that calls apply_model_pricing_change (the 'model' path of
-- /api/admin/pricing/update) BEFORE running this, or model pricing edits fail with "function does not exist".

BEGIN;

DROP FUNCTION IF EXISTS public.apply_model_pricing_change(text, text, text, numeric, numeric, timestamptz, text, integer, integer);

DO $$
BEGIN
  IF to_regprocedure('public.apply_model_pricing_change(text, text, text, numeric, numeric, timestamptz, text, integer, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback postcondition failed: apply_model_pricing_change still exists';
  END IF;
END
$$;

COMMIT;
