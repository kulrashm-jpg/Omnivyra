-- ──────────────────────────────────────────────────────────────────────────
-- Queue concurrency lock RPC + storage janitor metadata columns.
--
-- Adds:
--   1. `try_scheduled_post_lock(uuid)` / `release_scheduled_post_lock(uuid)`
--      — transaction-scoped advisory locks keyed on the UUID's two 64-bit
--      halves (Postgres advisory locks take int8 args; we hash via uuid_hash).
--   2. `daily_content_plans.resumable_session_started_at` — TIMESTAMPTZ
--      column the upload-media-finalize / direct paths stamp when a TUS
--      session is initiated. The storage janitor uses this + the row's
--      lifecycle to decide whether an orphaned object can be deleted.
--   3. Index for janitor lookups on `(scheduled_post_id, content_status)`.
--
-- All changes are additive + idempotent. Pre-migration consumers keep
-- working unchanged.
-- ──────────────────────────────────────────────────────────────────────────

-- ── 1. Advisory lock helper RPCs ──────────────────────────────────────
-- The RPC uses `pg_try_advisory_xact_lock` semantics (non-blocking,
-- transaction-scoped). Since Supabase JS doesn't expose transactions, we
-- expose a session-scoped `pg_try_advisory_lock` instead, paired with a
-- release function. The lock key is derived from the UUID by mapping its
-- 16 bytes onto a (int8, int8) pair so collisions are vanishingly rare.

CREATE OR REPLACE FUNCTION public.try_scheduled_post_lock(p_scheduled_post_id UUID)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_high BIGINT;
  v_low BIGINT;
  v_bytes BYTEA;
BEGIN
  v_bytes := decode(replace(p_scheduled_post_id::text, '-', ''), 'hex');
  v_high := ('x' || encode(substring(v_bytes FROM 1 FOR 8), 'hex'))::bit(64)::bigint;
  v_low  := ('x' || encode(substring(v_bytes FROM 9 FOR 8), 'hex'))::bit(64)::bigint;
  RETURN pg_try_advisory_lock(v_high, v_low);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_scheduled_post_lock(p_scheduled_post_id UUID)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_high BIGINT;
  v_low BIGINT;
  v_bytes BYTEA;
BEGIN
  v_bytes := decode(replace(p_scheduled_post_id::text, '-', ''), 'hex');
  v_high := ('x' || encode(substring(v_bytes FROM 1 FOR 8), 'hex'))::bit(64)::bigint;
  v_low  := ('x' || encode(substring(v_bytes FROM 9 FOR 8), 'hex'))::bit(64)::bigint;
  RETURN pg_advisory_unlock(v_high, v_low);
END;
$$;

COMMENT ON FUNCTION public.try_scheduled_post_lock(UUID) IS
  'Non-blocking advisory lock keyed on a scheduled_post UUID. Returns true if acquired, false on contention. Pair with release_scheduled_post_lock.';

COMMENT ON FUNCTION public.release_scheduled_post_lock(UUID) IS
  'Release the advisory lock acquired by try_scheduled_post_lock for the same UUID.';

-- ── 2. Resumable-session timestamp column ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_content_plans'
      AND column_name = 'resumable_session_started_at'
  ) THEN
    ALTER TABLE public.daily_content_plans
      ADD COLUMN resumable_session_started_at TIMESTAMPTZ;
    RAISE NOTICE 'Added daily_content_plans.resumable_session_started_at';
  END IF;
END$$;

COMMENT ON COLUMN public.daily_content_plans.resumable_session_started_at IS
  'Timestamp the TUS upload session was initiated. Storage janitor uses this + lifecycle state to detect stranded uploads.';

-- ── 3. Janitor lookup index ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_daily_content_plans_resumable_session
  ON public.daily_content_plans(resumable_session_started_at, content_status)
  WHERE resumable_session_started_at IS NOT NULL;
