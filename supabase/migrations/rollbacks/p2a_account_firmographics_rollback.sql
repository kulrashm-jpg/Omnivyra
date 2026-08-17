-- ============================================================================
-- ROLLBACK — P2A prospect_accounts firmographic completion
--   forward: supabase/migrations/20261005000000_p2a_account_firmographics.sql
--
-- Reverses ONLY what P2A added: six columns, four check constraints and four
-- indexes. It does NOT touch the firmographic columns LI-1 added
-- (industry, employee_count, employee_band, country_code, region, city,
-- description) — those belong to LI-1 and are reversed by LI-1's own rollback.
-- Dropping them here would silently undo a different migration.
--
-- ─── THIS IS LOSSY IF THE COLUMNS HOLD DATA ────────────────────────────────
-- Dropping a column discards its values irrecoverably. At the time of writing
-- `prospect_accounts` holds ZERO rows, so this rollback is lossless in fact.
-- That will not stay true once ingestion runs: the guard below refuses to drop
-- a column that holds any non-null value, so a later operator gets an error
-- rather than silent data loss. Override deliberately if that is genuinely
-- intended.
-- ============================================================================

DO $guard$
DECLARE
  v_rows INT;
BEGIN
  IF to_regclass('public.prospect_accounts') IS NULL THEN
    RAISE NOTICE 'P2A rollback: prospect_accounts is absent — nothing to do';
    RETURN;
  END IF;

  EXECUTE $q$
    SELECT count(*) FROM public.prospect_accounts
     WHERE annual_revenue IS NOT NULL
        OR revenue_band   IS NOT NULL
        OR founded_year   IS NOT NULL
        OR technologies   IS NOT NULL
        OR funding_stage  IS NOT NULL
        OR last_funding_at IS NOT NULL
  $q$ INTO v_rows;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'P2A rollback refused: % row(s) hold firmographic data that dropping these columns would destroy. Export first, then re-run with this guard removed.',
      v_rows;
  END IF;
END
$guard$;

DROP INDEX IF EXISTS public.idx_prospect_accounts_org_industry;
DROP INDEX IF EXISTS public.idx_prospect_accounts_org_employee_count;
DROP INDEX IF EXISTS public.idx_prospect_accounts_org_annual_revenue;
DROP INDEX IF EXISTS public.idx_prospect_accounts_org_country;

ALTER TABLE public.prospect_accounts
  DROP CONSTRAINT IF EXISTS prospect_accounts_firmographics_p2a_not_blank,
  DROP CONSTRAINT IF EXISTS prospect_accounts_annual_revenue_valid,
  DROP CONSTRAINT IF EXISTS prospect_accounts_founded_year_valid,
  DROP CONSTRAINT IF EXISTS prospect_accounts_technologies_is_array;

ALTER TABLE public.prospect_accounts
  DROP COLUMN IF EXISTS annual_revenue,
  DROP COLUMN IF EXISTS revenue_band,
  DROP COLUMN IF EXISTS founded_year,
  DROP COLUMN IF EXISTS technologies,
  DROP COLUMN IF EXISTS funding_stage,
  DROP COLUMN IF EXISTS last_funding_at;

DO $verify$
DECLARE
  v_cols INT;
BEGIN
  SELECT count(*) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'public.prospect_accounts'::regclass
     AND NOT attisdropped
     AND attname IN ('annual_revenue','revenue_band','founded_year','technologies','funding_stage','last_funding_at');
  IF v_cols <> 0 THEN
    RAISE EXCEPTION 'P2A rollback verify: % firmographic column(s) remain', v_cols;
  END IF;

  -- LI-1's columns must survive this rollback untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.prospect_accounts'::regclass
       AND attname = 'industry' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'P2A rollback verify: LI-1 industry column was removed — rollback overreached';
  END IF;
END
$verify$;
