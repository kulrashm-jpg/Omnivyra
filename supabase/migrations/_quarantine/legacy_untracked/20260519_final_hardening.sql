-- =============================================================================
-- Phase 7 Final — Data-Integrity Invariants
--
-- Enforces non-negative cost and credits-value at the DB layer. Existing
-- rows with negative values will cause the ADD CONSTRAINT to fail — that's
-- the correct signal to triage before the constraint is enforced.
--
-- If the ALTER fails in production, run:
--   SELECT id, api_cost_usd, credits_value_usd, created_at
--     FROM unified_transactions
--    WHERE api_cost_usd < 0 OR credits_value_usd < 0;
-- Fix the offending rows (likely backfill artifacts), then re-run.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'unified_txn_cost_non_negative'
       AND conrelid = 'unified_transactions'::regclass
  ) THEN
    ALTER TABLE unified_transactions
      ADD CONSTRAINT unified_txn_cost_non_negative
      CHECK (
        (api_cost_usd IS NULL OR api_cost_usd >= 0)
        AND (credits_value_usd IS NULL OR credits_value_usd >= 0)
      );
  END IF;
END$$;
