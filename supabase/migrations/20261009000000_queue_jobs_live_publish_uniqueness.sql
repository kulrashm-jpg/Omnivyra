-- queue_jobs — one LIVE job per (scheduled_post, job_type), enforced by the database.
--
-- WHY THIS EXISTS
-- ---------------
-- Publishing to a public social platform is IRREVERSIBLE. The invariant that
-- keeps a post from being published twice is "at most one live publish job per
-- scheduled post". Today that invariant is enforced only by read-before-insert
-- checks in application code:
--
--   backend/scheduler/schedulerPostQueueControl.ts  (per-post guard)
--   backend/scheduler/schedulerService.ts           (whole-cycle guard)
--
-- Both are SELECT-then-INSERT. They cannot survive interleaving:
--
--   cron tick            : SELECT -> no live job
--   /api/scheduler/retry : SELECT -> no live job
--   cron tick            : INSERT  (live job #1)
--   retry                : INSERT  (live job #2)   <-- double publish
--
-- Commit 76a166d2 ("stop a failed database read from meaning nothing found")
-- repaired the OTHER half of this: both guards now fail CLOSED when the lookup
-- errors, instead of reading a failed read as "nothing queued". That repair
-- fixed the read; it explicitly carried forward the gap this migration closes —
-- "queue_jobs has no unique constraint; publish idempotency is keyed by job
-- rather than by post". A guard that reads correctly still cannot see a row a
-- concurrent transaction has not committed yet.
--
-- That the race happens in practice is already admitted by the codebase:
-- reconcileDuplicateQueueJobs() in backend/services/creatorQueueReliabilityService.ts
-- exists purely to find posts that ALREADY have more than one live queue_job
-- and cancel all but the newest, and creatorLifecycleIntegrityAuditService
-- scans for the same drift. Those are DETECTIVE controls that run after the
-- fact — by the time they fire, both jobs may already have published.
--
-- The advisory-lock helper (try_scheduled_post_lock) is not a substitute — and
-- not because it is weak, but because IT DOES NOT EXIST. PostgREST exposes 77
-- RPCs in production and that is not one of them: migration 20260657's lock
-- functions were never applied. tryAcquireScheduledPostQueueLock therefore
-- always falls through to its "optimistic check", which is explicitly
-- best-effort and returns acquired:true unconditionally. Every caller that
-- believes it is serialized today is not. Nothing in this design may lean on
-- it.
--
-- A unique index is enforced by the btree at INSERT time. It holds across
-- processes, pooled connections, Vercel and Railway runtimes, cron and API
-- paths, and regardless of which RPCs are deployed. It is the only place this
-- invariant can be made durable.
--
--
-- WHY IT IS PARTIAL, AND NOT A PLAIN UNIQUE CONSTRAINT
-- ----------------------------------------------------
-- A scheduled post LEGITIMATELY accumulates several queue_jobs rows over its
-- lifetime. Two paths in the current code produce a second row:
--
--   * POST /api/scheduler/retry resets a FAILED post to 'scheduled' and calls
--     enqueueScheduledPostAt(), which INSERTs a NEW row. The previous row stays
--     as status='failed'.
--   * atomicCancelAndReEnqueueScheduledPost() cancels the live row, then
--     enqueues a new one at the new time.
--
-- A total UNIQUE (scheduled_post_id) would therefore break manual retry and
-- reschedule — the two recovery paths users depend on. Only rows in a LIVE
-- state ('pending' | 'processing') may collide. Terminal rows ('completed',
-- 'failed', 'cancelled') are history and must never block a future re-enqueue.
--
-- The predicate uses the SAME status set as every application guard in the repo
-- (.in('status', ['pending','processing'])), so the database and the code agree
-- on what "live" means — including on NULL. public.queue_jobs.status is
-- nullable with DEFAULT 'pending'; a NULL status satisfies neither this SQL
-- predicate nor the application's IN filter, so both treat such a row as not
-- live. No insert site in the repo writes a NULL status.
--
-- The key includes job_type so a hypothetical future non-publish job for the
-- same post is not blocked by a live publish job. job_type is 'publish' for
-- every queue_jobs row written today — the only three insert sites
-- (schedulerPostQueueControl.ts, and the bulk and fallback paths of
-- schedulerService.ts) all hardcode it — so this is exactly as strict as
-- (scheduled_post_id) alone is right now.
--
-- Both key columns are NOT NULL in public.queue_jobs, so no NULLS NOT DISTINCT
-- clause is needed or permitted.
--
--
-- LOCKING — a PLAIN index, deliberately
-- -------------------------------------
-- Supabase runs each migration inside a transaction, and CREATE INDEX
-- CONCURRENTLY cannot run inside one. (The repo already handles that
-- constraint the same way elsewhere: 20260668_usage_events_ledger_linkage_
-- indexes.sql carries its CONCURRENTLY variants as comments for a manual psql
-- session.) This build therefore takes a SHARE lock on public.queue_jobs and
-- blocks writes to it for its duration. That cost is nil here: the table is
-- 176 kB / 14 rows, so the build is sub-millisecond. A plain index is the
-- right choice and no manual CONCURRENTLY variant is warranted. If this table
-- ever grows to a size where a brief write block matters, the index must
-- instead be built OUTSIDE the migration runner with an explicit CREATE UNIQUE
-- INDEX CONCURRENTLY in its own session (which cannot be wrapped in
-- BEGIN/COMMIT, and which leaves an INVALID index behind on failure that must
-- be dropped and rebuilt).
--
--
-- RELEASE SEQUENCING — land this WITH the cancel repair, not before it
-- --------------------------------------------------------------------
-- Production satisfies this index today: 14 rows, zero duplicate
-- (scheduled_post_id, job_type) groups at ANY status, zero NULLs in either key
-- column, job_type = 'publish' 14/14. It would be created successfully with no
-- data remediation.
--
-- It does, however, carry TWO STRANDED LIVE ROWS — one 'pending' untouched
-- since 2026-05-14, one 'processing' since 2026-05-21 — which exist because
-- cancelScheduledPostQueueEntry has never once marked a row 'cancelled' (0
-- cancelled rows, ever). Be precise about what that does and does not mean:
--
--   * They are ONE live row per post, so they do NOT violate this index.
--   * A re-enqueue for those two posts is ALREADY refused today by the
--     read-side duplicate guard, so this index does not make that case worse.
--   * What this index changes is the RACE case, which is the whole point.
--
-- But the cancel repair is what makes cancel -> terminal -> re-enqueue work at
-- all, and that transition is the escape hatch this index's partial predicate
-- depends on. Ship this migration WITH that fix, not ahead of it.
--
-- ADDITIVE AND NON-DESTRUCTIVE. No column is added, dropped or retyped, and no
-- row is modified or deleted. Rollback is a single DROP INDEX
-- (supabase/migrations/rollbacks/queue_jobs_live_publish_uniqueness_rollback.sql).

BEGIN;

-- ── Pre-flight: refuse to create the index on data that violates it ─────────
-- CREATE UNIQUE INDEX would fail anyway, but with an error that names a tuple
-- and not the problem. This states the remediation instead. It RAISES; it
-- NEVER deletes or modifies a row. Offending rows must be reconciled
-- deliberately (reconcileDuplicateQueueJobs keeps the newest and cancels the
-- rest) so that whoever runs this decides which live job survives.
DO $$
DECLARE
  offending_groups integer;
  offending_rows   integer;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO offending_groups, offending_rows
  FROM (
    SELECT count(*) AS n
    FROM public.queue_jobs
    WHERE status IN ('pending', 'processing')
    GROUP BY scheduled_post_id, job_type
    HAVING count(*) > 1
  ) dupes;

  IF offending_groups > 0 THEN
    RAISE EXCEPTION
      'queue_jobs already holds more than one LIVE job for % (scheduled_post_id, job_type) group(s), % row(s) total. '
      'Reconcile them first (keep the newest live row per group, set the others to status = ''cancelled'') '
      'and re-run this migration. Do not delete the rows.',
      offending_groups, offending_rows;
  END IF;
END
$$;

-- ── The durable invariant ──────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uidx_queue_jobs_live_job_per_post
  ON public.queue_jobs (scheduled_post_id, job_type)
  WHERE status IN ('pending', 'processing');

COMMENT ON INDEX public.uidx_queue_jobs_live_job_per_post IS
  'At most one LIVE (pending|processing) queue_job per (scheduled_post_id, job_type). '
  'Partial so terminal rows (completed/failed/cancelled) never block a legitimate '
  're-enqueue via /api/scheduler/retry or atomicCancelAndReEnqueueScheduledPost. '
  'Insert paths classify SQLSTATE 23505 on this index as "duplicate", not as a failure.';

COMMIT;
