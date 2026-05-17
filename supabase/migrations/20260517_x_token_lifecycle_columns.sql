-- ============================================================================
-- 20260517_x_token_lifecycle_columns.sql
-- PHASE EX2 — Refresh Observability Normalization
-- ============================================================================
-- Adds the canonical token-lifecycle columns that backend/auth/tokenRefresh.ts
-- (and a future state machine / monitoring) require. These columns were
-- referenced in code but never existed in production ("phantom column" drift):
-- the recordTwitterRefreshOutcome write failed on every refresh and was
-- silently swallowed.
--
-- SAFETY:
--   * Idempotent — ADD COLUMN IF NOT EXISTS (safe to re-run)
--   * Transactional — wrapped in BEGIN/COMMIT
--   * Backward compatible — all columns NULLable or defaulted; existing rows
--     are untouched and remain valid
--   * NO data backfill that mutates tokens; only adds empty lifecycle columns
--   * NO auto-run — apply manually in Supabase SQL editor / reviewed migration
--     runner. Do NOT db:push.
--
-- AFTER APPLYING: deploy the EX3/EX4 code that reads/writes these columns.
-- Until applied, the current code (which writes connection_state/last_live_*)
-- continues to work unchanged — this migration is purely additive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FORWARD MIGRATION
-- ----------------------------------------------------------------------------
BEGIN;

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS refresh_status            text,
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_error        text,
  ADD COLUMN IF NOT EXISTS refresh_retry_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_successful_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_lock_owner        text,
  ADD COLUMN IF NOT EXISTS refresh_lock_acquired_at  timestamptz;

-- Constrain refresh_status to the canonical lifecycle vocabulary. NULL allowed
-- (pre-existing rows / never-refreshed accounts). Drop-then-add so re-runs are
-- idempotent.
ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_refresh_status_chk;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_refresh_status_chk
  CHECK (refresh_status IS NULL OR refresh_status IN (
    'CONNECTED',
    'TOKEN_EXPIRING',
    'TOKEN_REFRESHING',
    'TOKEN_EXPIRED',
    'PROVIDER_REAUTH_REQUIRED',
    'REFRESH_FAILED_RETRYABLE',
    'REFRESH_FAILED_FATAL',
    'SCHEDULER_UNREACHABLE'
  ));

-- Operational read paths: "find accounts that failed / are stuck / are stale".
-- Partial index keeps it cheap (only non-healthy rows indexed).
CREATE INDEX IF NOT EXISTS idx_social_accounts_refresh_status
  ON public.social_accounts (refresh_status, last_refresh_attempt_at)
  WHERE refresh_status IS NOT NULL
    AND refresh_status NOT IN ('CONNECTED');

CREATE INDEX IF NOT EXISTS idx_social_accounts_refresh_lock
  ON public.social_accounts (refresh_lock_acquired_at)
  WHERE refresh_lock_owner IS NOT NULL;

COMMIT;

-- ----------------------------------------------------------------------------
-- ROLLBACK  (run ONLY to revert — also transactional)
-- ----------------------------------------------------------------------------
-- BEGIN;
-- DROP INDEX IF EXISTS idx_social_accounts_refresh_lock;
-- DROP INDEX IF EXISTS idx_social_accounts_refresh_status;
-- ALTER TABLE public.social_accounts
--   DROP CONSTRAINT IF EXISTS social_accounts_refresh_status_chk;
-- ALTER TABLE public.social_accounts
--   DROP COLUMN IF EXISTS refresh_lock_acquired_at,
--   DROP COLUMN IF EXISTS refresh_lock_owner,
--   DROP COLUMN IF EXISTS last_successful_refresh_at,
--   DROP COLUMN IF EXISTS refresh_retry_count,
--   DROP COLUMN IF EXISTS last_refresh_error,
--   DROP COLUMN IF EXISTS last_refresh_attempt_at,
--   DROP COLUMN IF EXISTS refresh_status;
-- COMMIT;

-- ----------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only)
-- ----------------------------------------------------------------------------
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='social_accounts'
--   AND column_name IN ('refresh_status','last_refresh_attempt_at',
--     'last_refresh_error','refresh_retry_count','last_successful_refresh_at',
--     'refresh_lock_owner','refresh_lock_acquired_at')
-- ORDER BY column_name;
