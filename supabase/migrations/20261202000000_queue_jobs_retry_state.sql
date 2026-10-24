-- queue_jobs.retry_state — durable "is a BullMQ retry still pending?" signal.
--
-- WHY THIS EXISTS
-- ---------------
-- The publish worker writes queue_jobs.status = 'failed' on EVERY failed
-- delivery, whether or not BullMQ will deliver the job again (the publish queue
-- runs attempts = 3 with exponential backoff, and no processor path raises
-- UnrecoverableError). 'failed' therefore means two different things:
--
--   * a backoff retry is still queued in Redis and WILL run, or
--   * the final attempt failed and nothing will run again.
--
-- Nothing in the database distinguishes them, so:
--
--   * cancelScheduledPostQueueEntry (unschedule / reschedule) only retires
--     'pending' | 'processing' rows — a job sitting in backoff survives a
--     cancel and publishes at the old time;
--   * the duplicate guards (enqueueScheduledPostAt, findDuePostsAndEnqueue)
--     do not count it, so a second live job can be created beside it;
--   * POST /api/scheduler/retry can enqueue a fresh job while the old one is
--     still going to retry.
--
-- WHAT IT RECORDS
-- ---------------
--   'awaiting_retry' — failed, BullMQ will deliver this job id again (LIVE).
--   'exhausted'      — the final delivery failed (TERMINAL).
--   NULL             — unknown. The value of every existing row, and of any
--                      row whose state write did not land. Application code
--                      never treats NULL as terminal.
--
-- Written by backend/queue/jobProcessors/publishProcessor.ts only, after a
-- delivery fails and only while the row is still 'failed'; cleared when a
-- delivery claims the row for processing. Read by the cancel helper and the
-- duplicate guards (backend/queue/publishRetryState.ts documents the contract).
--
-- NO BACKFILL. Existing rows stay NULL. A historical 'failed' row cannot be
-- classified from the database alone (whether its BullMQ retry still exists is
-- a Redis fact), and guessing 'exhausted' would make a still-pending retry
-- uncancellable — the defect this column exists to remove.
--
-- MIXED VERSIONS
-- --------------
-- Code that predates this column never names it, so applying the migration
-- changes nothing for an old worker or an old API build. New code tolerates
-- the column being ABSENT (42703 / PGRST204 naming retry_state) and falls back
-- to the pre-migration behaviour, so code may ship before or after this runs.
--
-- ADDITIVE AND NON-DESTRUCTIVE. One nullable column with no default (a
-- metadata-only change, no table rewrite) and one CHECK constraint that every
-- existing row satisfies because every existing row is NULL. No index is
-- changed; uidx_queue_jobs_live_job_per_post keeps its predicate. Rollback:
-- supabase/migrations/rollbacks/queue_jobs_retry_state_rollback.sql.

BEGIN;

ALTER TABLE public.queue_jobs
  ADD COLUMN IF NOT EXISTS retry_state text;

ALTER TABLE public.queue_jobs
  DROP CONSTRAINT IF EXISTS queue_jobs_retry_state_check;

ALTER TABLE public.queue_jobs
  ADD CONSTRAINT queue_jobs_retry_state_check
  CHECK (retry_state IS NULL OR retry_state IN ('awaiting_retry', 'exhausted'));

COMMENT ON COLUMN public.queue_jobs.retry_state IS
  'Publish retry state for a failed delivery: awaiting_retry (BullMQ will deliver again; live), '
  'exhausted (final delivery failed; terminal), NULL (unknown — never treated as terminal). '
  'Written only by the publish worker. No backfill: pre-existing rows are NULL.';

COMMIT;
