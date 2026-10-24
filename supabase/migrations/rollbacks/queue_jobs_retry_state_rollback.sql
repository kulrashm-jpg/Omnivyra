-- Rollback for 20261202000000_queue_jobs_retry_state.sql
--
-- Drops the column and its CHECK constraint. The recorded retry states are
-- lost; no other column or row is affected.
--
-- Application code tolerates the column being absent (it falls back to the
-- pre-migration behaviour on an unknown-column error naming retry_state), so
-- this rollback does not require reverting code first. After it runs, a failed
-- job waiting in BullMQ backoff is once again invisible to cancellation and to
-- the duplicate guards — except that the cancel helper's fallback retires every
-- 'failed' row for the post, since none can be shown to be terminal.

BEGIN;

ALTER TABLE public.queue_jobs
  DROP CONSTRAINT IF EXISTS queue_jobs_retry_state_check;

ALTER TABLE public.queue_jobs
  DROP COLUMN IF EXISTS retry_state;

COMMIT;
