-- Rollback for 20261009000000_queue_jobs_live_publish_uniqueness.sql
--
-- The forward migration only creates an index. Dropping it restores the exact
-- prior state: no row was added, modified or deleted, and no column changed.
-- The rollback is therefore lossless and needs no data reconciliation.
--
-- After this runs, "one live job per scheduled post" is once again enforced
-- only by the application's read-before-insert guards. Those fail closed on an
-- unreadable lookup (commit 76a166d2) but cannot see an uncommitted concurrent
-- INSERT, so the race described in the forward migration's header is reachable
-- again.
--
-- The insert-path error handling in schedulerService.ts (and in
-- schedulerPostQueueControl.ts) is INERT without the index: it classifies a
-- unique violation that can no longer be raised. It does not need reverting,
-- and reverting it separately is not required for this rollback to be
-- complete.
--
-- Like the forward migration, this cannot use DROP INDEX CONCURRENTLY inside a
-- transaction; at production's current 14 rows the ACCESS EXCLUSIVE lock is
-- momentary.

BEGIN;

DROP INDEX IF EXISTS public.uidx_queue_jobs_live_job_per_post;

COMMIT;
