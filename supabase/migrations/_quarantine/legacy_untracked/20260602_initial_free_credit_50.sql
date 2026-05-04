-- =============================================================================
-- Initial Free Credit — set canonical amount to 50
--
-- Replaces the historical 300-credit grant on the legacy 'initial' category
-- with a 50-credit grant on the new 'initial_free_credit' category. The
-- amount lives in free_credit_config so it can be tuned without code change.
--
-- Backwards compatibility: the legacy 'initial' row is left in place but
-- deactivated so any code path that still queries it falls through to the
-- defaults coded in initialFreeCreditService.ts (also 50). The new
-- 'initial_free_credit' row is the single source of truth going forward.
-- =============================================================================

-- 1. Upsert the canonical row used by initialFreeCreditService.ts.
INSERT INTO free_credit_config (category, credits, expiry_days, is_active)
VALUES ('initial_free_credit', 50, 14, true)
ON CONFLICT (category) DO UPDATE
  SET credits     = EXCLUDED.credits,
      expiry_days = EXCLUDED.expiry_days,
      is_active   = EXCLUDED.is_active,
      updated_at  = NOW();

-- 2. Deactivate the legacy 'initial' row. We leave it present (rather than
--    deleting it) so historical claims and any tooling that joins on it
--    keep their reference intact.
UPDATE free_credit_config
   SET is_active  = false,
       updated_at = NOW()
 WHERE category = 'initial';
