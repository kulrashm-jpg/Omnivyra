/**
 * Phase 1 + 4 — Heartbeat-based liveness + retry containment.
 *
 * Adds:
 *   reports.last_heartbeat_at  TIMESTAMPTZ NULL  — refreshed every ~60 s
 *                                                  while a generation is in
 *                                                  flight; primary signal for
 *                                                  the recovery reaper.
 *   reports.attempt_count      INTEGER  NOT NULL — bumped per generation
 *                                       DEFAULT 1  attempt for a (company,
 *                                                  domain). Used by retry-
 *                                                  containment ceiling.
 *
 * Backfill:
 *   Existing 'generating' rows have last_heartbeat_at anchored to their
 *   started_at (or created_at) so the heartbeat-aware reaper treats them
 *   as already stale and reaps them on the next sweep.
 *
 * Index:
 *   Partial (last_heartbeat_at, started_at) on rows where
 *   status='generating' so the reaper's ORDER BY ... LIMIT N batched
 *   query is index-supported.
 */

BEGIN;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;

UPDATE public.reports
SET last_heartbeat_at = COALESCE(started_at, created_at)
WHERE status = 'generating'
  AND last_heartbeat_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_reports_generating_liveness
  ON public.reports (last_heartbeat_at NULLS FIRST, started_at)
  WHERE status = 'generating';

COMMIT;
