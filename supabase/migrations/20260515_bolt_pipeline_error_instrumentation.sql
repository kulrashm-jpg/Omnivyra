-- ============================================================
-- BOLT Pipeline Error Instrumentation
-- ------------------------------------------------------------
-- Persist the RAW underlying error separately from the
-- user-friendly fallback that the UI consumes.
--
-- Until now, every pipeline failure was overwritten with the
-- generic campaign-context fallback ("Your campaign plan was
-- disrupted...") before it hit the database. The actual error
-- only ever appeared in console logs, which left operators
-- unable to diagnose anything without access to the dev/server
-- terminal.
--
-- These columns are written by `persistPipelineFailure` in
-- backend/services/boltPipelineFailurePersistence.ts. The
-- existing `error_message` column continues to carry the
-- user-friendly text the UI already reads — it is NOT
-- replaced or removed.
-- ============================================================

ALTER TABLE bolt_execution_runs
  ADD COLUMN IF NOT EXISTS raw_error_message TEXT,
  ADD COLUMN IF NOT EXISTS error_stack       TEXT,
  ADD COLUMN IF NOT EXISTS failed_stage      TEXT,
  ADD COLUMN IF NOT EXISTS failed_after_ms   BIGINT,
  ADD COLUMN IF NOT EXISTS pipeline_mode     TEXT,
  ADD COLUMN IF NOT EXISTS campaign_type     TEXT;

-- Speeds up the common diagnostic query:
--   "show me the last N failed runs, grouped by which stage broke"
CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_failed_stage
  ON bolt_execution_runs (status, failed_stage, updated_at DESC)
  WHERE status = 'failed';
