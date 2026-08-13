-- ============================================================================
-- ROLLBACK — B7.8-C platform usage ledger
--   for supabase/migrations/20260930120000_platform_usage_events.sql
-- ============================================================================
--
-- The forward migration is purely additive (ONE new table plus its own indexes),
-- so this removes exactly that table and nothing else.
--
-- DATA GUARD (Phase A convention, mirrored): aborts if the table holds rows.
-- These rows are FINANCIAL RECORDS of real provider spend. Dropping them
-- destroys the only record that the money was spent — there is no second copy,
-- because the whole point of this table is that the spend does not appear in
-- usage_events or unified_transactions. The guard therefore refuses rather
-- than warns.
--
-- PRESERVED (never touched by the forward migration):
--   · public.usage_events            — customer billing
--   · public.unified_transactions    — customer financial ledger
--   · every pricing, credit and organization table
-- ============================================================================

BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.platform_usage_events') IS NOT NULL THEN
    SELECT count(*) FROM public.platform_usage_events INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'B7.8-C ROLLBACK ABORTED: public.platform_usage_events contains % financial row(s). These are the ONLY record of platform provider spend; dropping them is unrecoverable. Export or clear deliberately before proceeding.', n;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS public.platform_usage_events;

DO $$
BEGIN
  IF to_regclass('public.platform_usage_events') IS NOT NULL THEN
    RAISE EXCEPTION 'B7.8-C ROLLBACK INCOMPLETE: platform_usage_events still present';
  END IF;
  -- Assert customer billing survived untouched.
  IF to_regclass('public.usage_events') IS NULL OR to_regclass('public.unified_transactions') IS NULL THEN
    RAISE EXCEPTION 'B7.8-C ROLLBACK ERROR: a customer billing table is missing — this rollback must never touch them';
  END IF;
  RAISE NOTICE 'B7.8-C ROLLBACK COMPLETE — platform ledger removed; usage_events and unified_transactions untouched.';
END $$;

COMMIT;
