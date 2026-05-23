-- ============================================================
-- BOLT Execution Runs — Abandonment Forensic Fields
-- ============================================================
-- Adds two columns so the run-abandonment sweepers can record
-- abandonment metadata WITHOUT clobbering the real failure cause
-- that `persistPipelineFailure` may have already written.
--
-- Background — the prior overwrite-safe sweeper guards (see
-- pages/api/bolt/execute.ts and scripts/operator/bolt/
-- bolt-stuck-run-sweeper.js, hardened in the prior turn) used
-- `.is('error_message', null)` and `COALESCE(...)` to skip rows
-- with a real error already persisted. This works, but leaves
-- TWO gaps for forensic reconstruction:
--
--   1. A truly-abandoned row (no stage ever threw) gets a generic
--      message; operators can't distinguish "abandoned without
--      diagnostics" from "abandoned with diagnostics" later.
--   2. Both flavours of failure (real cause + abandonment marker)
--      could coexist on a single row, e.g. worker threw an error,
--      persisted it, then the process died before the next stage
--      could mark cleanup — the sweeper finishes the bookkeeping
--      but should record that fact alongside the real cause.
--
-- Solution: split abandonment metadata into its own pair of
-- columns. Sweepers stop touching error_message / raw_error_message
-- entirely (they remain the exclusive domain of
-- persistPipelineFailure). Sweepers ONLY mark the abandonment
-- reason and timestamp — additive, never destructive.
--
-- Columns:
--   * abandonment_reason       text — short machine-readable code,
--                                     e.g. 'sweeper_heartbeat_stale',
--                                     'sweeper_lock_expired',
--                                     'operator_stuck_sweep'
--   * abandonment_detected_at  timestamptz — when the sweeper ran
--
-- Both columns nullable; rows that were never swept have
-- abandonment_reason IS NULL.
--
-- Idempotent via IF NOT EXISTS. Safe to apply to a partially-
-- applied DB.
-- ============================================================

ALTER TABLE bolt_execution_runs
  ADD COLUMN IF NOT EXISTS abandonment_reason      TEXT,
  ADD COLUMN IF NOT EXISTS abandonment_detected_at TIMESTAMPTZ;

-- Partial index supports the "which runs got swept and when"
-- forensic query without bloating storage on the common case
-- (abandonment_reason IS NULL means the run was never swept).
CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_abandonment_detected
  ON bolt_execution_runs (abandonment_detected_at)
  WHERE abandonment_reason IS NOT NULL;
