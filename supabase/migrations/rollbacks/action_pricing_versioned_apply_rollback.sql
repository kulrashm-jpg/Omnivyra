-- ROLLBACK — billing defect B-1: versioned apply for action_pricing_config.
-- Reverses supabase/migrations/20270210000000_action_pricing_versioned_apply.sql
--
-- SAFETY. The forward migration only CREATEs one function; it changes no table, column, constraint or
-- index and writes no row. Dropping the function is a true inverse and loses no data.
--
-- ORDER. Roll back the CODE that calls apply_action_pricing_change (both admin writers) BEFORE running
-- this, or every admin pricing change will fail with "function does not exist". Note that the code it
-- replaced is itself broken in production (it omits the NOT NULL source_type and deactivates before
-- inserting), so a full rollback restores B-1; prefer fixing forward.

BEGIN;

DROP FUNCTION IF EXISTS public.apply_action_pricing_change(text, numeric, numeric, numeric, timestamptz, text, text);

DO $$
BEGIN
  IF to_regprocedure('public.apply_action_pricing_change(text, numeric, numeric, numeric, timestamptz, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback postcondition failed: apply_action_pricing_change still exists';
  END IF;
END
$$;

COMMIT;
