-- ============================================================
-- BOLT Execution Resilience — Lock, Cancel, Heartbeat Columns
-- ============================================================
-- Revives the previously-skipped 20260515b migration as a fresh
-- dated entry so the ledger advances monotonically. Content is
-- byte-identical to database/_archive/skipped-migrations/
-- 20260515b_bolt_execution_resilience.sql; only the version
-- prefix changes so `supabase db push` can apply it without
-- conflicting with archived versions.
--
-- These columns are load-bearing for the running pipeline:
--   * boltPipelineService.updateRun writes lock_expires_at and
--     heartbeat_at on every progress write. With the columns
--     absent, every write fails at PostgREST → no liveness signal
--     reaches the row → the abandonment sweeper unconditionally
--     marks the run failed after 90s with a generic "technical
--     glitch" message, overwriting any real planner error that
--     persistPipelineFailure tried to record.
--   * boltExecutionLock.{acquire,extend,release,getStatus} all
--     key on lock_owner / lock_expires_at / lock_acquired_at.
--
-- All ALTERs use IF NOT EXISTS so the migration is safely
-- idempotent: re-applying against a partially-applied DB is a
-- no-op for the satisfied columns.
-- ============================================================

ALTER TABLE bolt_execution_runs
  -- (1) Atomic claim with TTL. lock_owner is a per-execution
  -- UUID minted by the pipeline at start; persisted so a second
  -- concurrent attempt can compare the token before mutating
  -- shared state. lock_expires_at lets the stuck-run sweeper /
  -- next worker take over when a previous worker crashed without
  -- releasing.
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

-- Partial indexes keep the sweeper / lock-recovery queries cheap.
-- The predicate `status = 'running'` filters to the small set of
-- rows those flows actually scan.
CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_lock_expires
  ON bolt_execution_runs (lock_expires_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_heartbeat
  ON bolt_execution_runs (heartbeat_at)
  WHERE status = 'running';

-- scheduled_posts idempotency. A deterministic key
-- (campaign_id::week::day::platform::content_type::seq) lets
-- retries / resumes / partial recoveries call INSERT … ON CONFLICT
-- (idempotency_key) DO NOTHING without producing duplicates. The
-- column is nullable so historical rows aren't touched; the unique
-- index is PARTIAL so it only enforces on rows that have one.
ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_scheduled_posts_idempotency_key
  ON scheduled_posts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
