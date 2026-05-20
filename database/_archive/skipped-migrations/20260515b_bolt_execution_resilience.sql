-- ============================================================
-- BOLT Execution Resilience Substrate
-- ------------------------------------------------------------
-- Five additive capabilities that every future retry / resume /
-- partial-recovery / cancellation feature depends on:
--
--   1. Execution lock with expiry  → no two workers running the
--      same run; crashed worker locks auto-recover after TTL.
--   2. User cancellation flag      → pipeline checks between
--      stages and exits cleanly with status='cancelled'.
--   3. Heartbeat                   → stuck-run sweeper has a
--      reliable signal of liveness independent of `status`.
--   4. Progress monotonicity       → enforced in application
--      code via the updateRun helper (no schema change needed).
--   5. scheduled_posts idempotency → deterministic key + partial
--      unique index lets retries / resumes / partial recoveries
--      insert without producing duplicate scheduled posts.
--
-- All ALTERs use IF NOT EXISTS so this is safe to re-apply.
-- ============================================================

-- ── 1, 2, 3: run-level resilience columns ────────────────────
ALTER TABLE bolt_execution_runs
  -- (1) Atomic claim with TTL. lock_owner is a per-execution
  -- UUID minted by the pipeline at start; it's persisted so a
  -- second concurrent attempt can compare the token before
  -- mutating shared state. lock_expires_at lets the stuck-run
  -- sweeper / next worker take over when a previous worker
  -- crashed without releasing.
  ADD COLUMN IF NOT EXISTS lock_owner          TEXT,
  ADD COLUMN IF NOT EXISTS lock_acquired_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_expires_at     TIMESTAMPTZ,

  -- (2) Cancellation. Set by /api/bolt/cancel; the pipeline
  -- checks the flag at every stage boundary and exits with
  -- status='cancelled'. cancel_requested_by captures who asked
  -- for the cancel so audit logs can attribute it.
  ADD COLUMN IF NOT EXISTS cancel_requested    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_requested_by TEXT,

  -- (3) Heartbeat. Refreshed by the pipeline every time it
  -- writes progress. Sweeper-script logic:
  --     status = 'running'
  --     AND heartbeat_at < now() - interval '5 minutes'
  --     AND (lock_expires_at IS NULL OR lock_expires_at < now())
  --   → mark as failed with failed_stage = 'stuck'.
  ADD COLUMN IF NOT EXISTS heartbeat_at        TIMESTAMPTZ;

-- Partial indexes keep these covered queries cheap. The
-- predicate `status = 'running'` filters to the ~tens of rows
-- the sweeper / lock-recovery flow actually cares about.
CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_lock_expires
  ON bolt_execution_runs (lock_expires_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_heartbeat
  ON bolt_execution_runs (heartbeat_at)
  WHERE status = 'running';

-- ── 5: scheduled_posts idempotency ──────────────────────────
-- A deterministic key (campaign_id::week::day::platform::
-- content_type::seq) lets retries / resumes / partial
-- recoveries call INSERT … ON CONFLICT (idempotency_key) DO
-- NOTHING without ever creating duplicate posts. The column is
-- nullable so historical rows aren't touched; the unique index
-- is PARTIAL so it only enforces on rows that have one.
ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_scheduled_posts_idempotency_key
  ON scheduled_posts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
