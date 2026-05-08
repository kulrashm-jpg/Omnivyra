/**
 * Scheduler-Lock Sweeper — proactive cleanup of stale rows in the
 * `scheduler_locks` table.
 *
 * Why this exists:
 *   Each long-running scheduler job (e.g. dailyIntelligenceScheduler)
 *   acquires a row in `scheduler_locks` at the start of its run and
 *   releases it on completion. If the worker crashes mid-run, the row
 *   stays. Each job's `acquireLock` reactively overrides locks older
 *   than 30 minutes, so stale rows don't block forever — but they do
 *   accumulate, clutter the table, and inflate the count surfaced by
 *   `runtimePressureMonitor`. This sweeper deletes them.
 *
 * Read-write but bounded: only deletes rows older than the configured
 * staleness threshold. Safe to run alongside live jobs (their rows are
 * younger than the threshold).
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';

const DEFAULT_STALE_AGE_MS = 30 * 60 * 1000; // 30 min — matches every job's reactive override threshold

export interface SchedulerLockSweepResult {
  scanned: number;
  deleted: number;
  oldestStaleAgeMs: number;
  jobNames: ReadonlyArray<string>;
}

interface LockRow {
  job_name: string;
  locked_at: string;
}

export async function sweepStaleSchedulerLocks(input?: {
  staleAgeMs?: number;
  limit?: number;
}): Promise<SchedulerLockSweepResult> {
  const staleAgeMs = input?.staleAgeMs ?? DEFAULT_STALE_AGE_MS;
  const limit = Math.min(Math.max(input?.limit ?? 200, 1), 5000);
  const cutoffIso = new Date(Date.now() - staleAgeMs).toISOString();

  const { data: candidates, error: queryErr } = await ownedDbTable('scheduler_locks')
    .select('job_name, locked_at')
    .lt('locked_at', cutoffIso)
    .limit(limit);

  if (queryErr) {
    logger.error('scheduler_lock_sweeper_query_failed', { message: queryErr.message });
    throw new Error(`scheduler_lock_sweeper_query_failed: ${queryErr.message}`);
  }

  const rows = (candidates ?? []) as LockRow[];
  if (rows.length === 0) {
    return { scanned: 0, deleted: 0, oldestStaleAgeMs: 0, jobNames: [] };
  }

  const now = Date.now();
  const oldestStaleAgeMs = rows.reduce((max, r) => {
    const age = now - Date.parse(r.locked_at);
    return age > max ? age : max;
  }, 0);

  const jobNames = Array.from(new Set(rows.map((r) => r.job_name)));

  // Delete in one statement bounded by the same predicate. Safe vs.
  // a job that just acquired its lock — that row's `locked_at` is
  // newer than `cutoffIso` and is excluded by the WHERE clause.
  const { data: deleted, error: deleteErr } = await ownedDbTable('scheduler_locks')
    .delete()
    .lt('locked_at', cutoffIso)
    .in('job_name', jobNames)
    .select('job_name');

  if (deleteErr) {
    logger.error('scheduler_lock_sweeper_delete_failed', { message: deleteErr.message });
    throw new Error(`scheduler_lock_sweeper_delete_failed: ${deleteErr.message}`);
  }

  const deletedCount = (deleted ?? []).length;
  if (deletedCount > 0) {
    logger.warn('scheduler_lock_sweeper_deleted', {
      deleted: deletedCount,
      jobNames,
      oldestStaleAgeMs,
    });
  }

  return {
    scanned:           rows.length,
    deleted:           deletedCount,
    oldestStaleAgeMs,
    jobNames,
  };
}
