/**
 * BOLT execution recovery — reconciling DB lifecycle state with worker reality.
 *
 * A BOLT run's `status` is written by the process executing it. When that
 * process stops existing — a deploy restart, an OOM, a container kill — no code
 * runs to record the ending, so the row stays `running` forever while the UI
 * faithfully renders that state as a spinner.
 *
 * BullMQ recovers the JOB (stalled → retry → eventually failed). It does not
 * and cannot recover the DATABASE row: those are two separate stores, and
 * nothing in BullMQ knows `bolt_execution_runs` exists. This module is the
 * seam that closes that gap.
 *
 * Ownership authority (unchanged, reused deliberately — this introduces no
 * second lifecycle system):
 *   - `lock_owner` / `lock_expires_at` prove which process owns a run.
 *   - `updateRun` refreshes `heartbeat_at` + `lock_expires_at` on every
 *     progress write, so a live run continuously re-proves ownership.
 *   - A run whose lock has EXPIRED has no owner, by definition.
 *
 * Forensic contract (identical to the inline + cron sweepers): this NEVER
 * writes `error_message`, `raw_error_message`, or `failed_stage`. Those belong
 * exclusively to `persistPipelineFailure`, so a run that genuinely threw keeps
 * its real cause alongside the abandonment marker.
 */

import { ownedDbTable } from '../db/writeOwner';

/**
 * Stalled-recovery cadence for the `bolt-execution` queue only.
 *
 * Deliberately aligned with the lock refresh window: `updateRun` writes
 * `lock_expires_at = now + 2min`, so after 2 minutes without a progress write a
 * run provably has no live owner. Matching the stalled check to that window
 * means BullMQ notices a dead worker on roughly the same timescale the database
 * does, instead of up to 60 minutes later (two passes of the 30-minute global
 * default).
 *
 * Every other queue keeps the 30-minute default — see `getWorker`.
 */
export const BOLT_STALLED_INTERVAL_MS = 120_000;

/** Abandonment reasons written by this module. */
export type BoltAbandonmentReason =
  | 'worker_job_failed_terminal'
  | 'worker_shutdown_interrupted';

export type ReconcileResult =
  | { ok: true; reconciled: number }
  | { ok: false; error: string };

/**
 * Transition a single run out of `running` when its worker has provably ceased
 * ownership.
 *
 * Safety properties, all enforced in the WHERE clause so the DATABASE arbitrates
 * rather than this process:
 *   - never touches a terminal run (`status IN ('started','running')` only);
 *   - never touches a run a live worker still owns (lock must be absent or
 *     expired) — so a run another worker legitimately took over is left alone;
 *   - idempotent: `abandonment_detected_at IS NULL` means a second call
 *     reconciles 0 rows rather than restamping;
 *   - errors are RETURNED, never swallowed — a failed reconciliation must not
 *     read as "nothing needed reconciling".
 *
 * Returns the number of rows actually changed, which is 0 in the (expected,
 * healthy) case where the run finished normally or someone else owns it.
 */
export async function reconcileAbandonedBoltRun(
  runId: string,
  reason: BoltAbandonmentReason,
): Promise<ReconcileResult> {
  if (!runId || typeof runId !== 'string') {
    return { ok: false, error: 'reconcileAbandonedBoltRun: runId is required' };
  }

  const nowIso = new Date().toISOString();

  const { data, error } = await ownedDbTable('bolt_execution_runs')
    .update({
      status: 'failed',
      abandonment_reason: reason,
      abandonment_detected_at: nowIso,
      lock_owner: null,
      lock_expires_at: null,
      updated_at: nowIso,
    })
    .eq('id', runId)
    .in('status', ['started', 'running'])
    .or(`lock_expires_at.is.null,lock_expires_at.lt.${nowIso}`)
    .is('abandonment_detected_at', null)
    .select('id');

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, reconciled: Array.isArray(data) ? data.length : 0 };
}

/** Minimal structural shape of the worker we attach to (avoids a bullmq import). */
export type BoltWorkerLike = {
  on(event: 'failed', listener: (job: BoltFailedJobLike, err: Error) => void): unknown;
};

/**
 * Reconcile the DB run whenever a `bolt-execution` job fails terminally.
 *
 * This is the piece BullMQ cannot do for us. When a worker dies mid-run, the
 * surviving worker's stalled check eventually fails the job — at which point a
 * LIVE process exists that can write the ending the dead one never got to.
 * Without this, the row waits for the cron sweep; with it, the transition is
 * immediate and carries a precise reason.
 *
 * Never throws: a reconciliation failure is logged, because throwing inside an
 * EventEmitter handler would take down the worker process.
 */
export function attachBoltRunReconciliation(worker: BoltWorkerLike): void {
  worker.on('failed', (job, err) => {
    if (!isTerminalBoltJobFailure(job, err)) return;
    const runId = boltRunIdFromJob(job);
    if (!runId) return;
    void reconcileAbandonedBoltRun(runId, 'worker_job_failed_terminal')
      .then((result) => {
        // `strict: false` repo-wide, so a discriminated union does NOT narrow on
        // `!result.ok`. Presence-check the member instead.
        if ('error' in result) {
          console.error('[bolt-recovery] reconcile failed', { run_id: runId, error: result.error });
        } else if (result.reconciled > 0) {
          console.warn('[bolt-recovery] run reconciled after terminal job failure', { run_id: runId });
        }
      })
      .catch((e) => {
        console.error('[bolt-recovery] reconcile threw', { run_id: runId, error: (e as Error)?.message });
      });
  });
}

/** Minimal structural shape of the BullMQ job fields we depend on. */
export type BoltFailedJobLike = {
  id?: string | null;
  data?: { run_id?: unknown } | null;
  attemptsMade?: number;
  opts?: { attempts?: number } | null;
} | null | undefined;

/**
 * Will BullMQ retry this job, or was that its last breath?
 *
 * This distinction is load-bearing. `reconcileAbandonedBoltRun` writes
 * `status='failed'`, and `executeBoltPipelineRuntime` treats `failed` as
 * terminal and refuses to re-enter — so reconciling a job that BullMQ still
 * intends to retry would permanently destroy that retry. We reconcile ONLY when
 * no attempt remains.
 *
 * A stalled-limit failure is always terminal: BullMQ raises it instead of
 * requeueing, regardless of how many `attempts` the job was configured with.
 */
export function isTerminalBoltJobFailure(job: BoltFailedJobLike, err: Error | null | undefined): boolean {
  if (/stalled more than allowable limit/i.test(err?.message ?? '')) return true;
  if (!job) return false;
  const configured = job.opts?.attempts ?? 1;
  const made = job.attemptsMade ?? 0;
  return made >= configured;
}

/** Extract the BOLT run id a failed job was executing, if it carries one. */
export function boltRunIdFromJob(job: BoltFailedJobLike): string | null {
  const raw = job?.data?.run_id;
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

/**
 * Release this process's claim on a run without declaring it failed.
 *
 * Used at shutdown: the process is about to disappear, but the job may still be
 * retried by BullMQ or picked up by the replacement worker. Clearing the lock
 * makes the run immediately reclaimable instead of forcing the next attempt to
 * wait out the lock TTL — while leaving `status` alone so a retry resumes
 * rather than resurrecting a run that was declared dead.
 *
 * Guarded by `lock_owner` so we can only ever release a lock WE hold; a run that
 * a different worker has already claimed is untouched.
 */
export async function releaseBoltRunClaimOnShutdown(
  runId: string,
  lockOwner: string,
): Promise<ReconcileResult> {
  if (!runId || !lockOwner) {
    return { ok: false, error: 'releaseBoltRunClaimOnShutdown: runId and lockOwner are required' };
  }

  const nowIso = new Date().toISOString();

  const { data, error } = await ownedDbTable('bolt_execution_runs')
    .update({ lock_owner: null, lock_expires_at: null, updated_at: nowIso })
    .eq('id', runId)
    .eq('lock_owner', lockOwner)
    .in('status', ['started', 'running'])
    .select('id');

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, reconciled: Array.isArray(data) ? data.length : 0 };
}
