-- ============================================================
-- Queue Jobs — Result Payload + Error Code Columns
-- ============================================================
-- Adds the two columns the queue-persistence layer writes but
-- which were never represented in supabase/migrations/ (they
-- existed only in legacy database/step4-media-queue-tables.sql,
-- which was the bootstrap-time schema dump, not a migration).
--
-- Without these columns, every call to
-- backend/db/queries.ts:updateQueueJobStatus() that sets
-- error_code or result_data fails at PostgREST with
-- "Could not find the 'result_data' / 'error_code' column",
-- and the job's terminal state is silently lost. This is part
-- of why BOLT failures were observed without any persisted
-- diagnostic.
--
-- Columns:
--   * result_data jsonb     — serialized result from completed
--                             jobs (publishProcessor handlers,
--                             retry/resume bookkeeping)
--   * error_code varchar(100) — indexed classification (e.g.
--                             'PROVIDER_TIMEOUT', 'RATE_LIMIT')
--                             used by error dashboards and retry
--                             policy logic.
--
-- All statements use IF NOT EXISTS — safely idempotent.
-- ============================================================

ALTER TABLE queue_jobs
  ADD COLUMN IF NOT EXISTS result_data JSONB,
  ADD COLUMN IF NOT EXISTS error_code  VARCHAR(100);

-- Indexes match the legacy database/add-error-code-to-queue-jobs.sql
-- shape so dashboards / retry policies that query by code stay fast.
CREATE INDEX IF NOT EXISTS idx_queue_jobs_error_code
  ON queue_jobs (error_code)
  WHERE error_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_queue_jobs_status_error_code
  ON queue_jobs (status, error_code, updated_at DESC)
  WHERE status = 'failed';
