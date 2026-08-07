/**
 * WS1-E6-T001 — dead-letter an exhausted BullMQ job.
 *
 * Before this module, EVERY BullMQ `failed` handler in the fleet ended at a
 * `console.error`. A job that burned all of its attempts left a log line and
 * nothing durable, so `worker_dead_letter_queue` — which
 * /api/system/dead-letters and /api/super-admin/dead-letter-queue read, and
 * which runtimePressureMonitor rolls up — stayed empty for queue work. An empty
 * DLQ is indistinguishable from a healthy one.
 *
 * This is NOT a new dead-letter mechanism. It is the exhaustion guard plus the
 * fail-safety wrapper around the platform's EXISTING sink,
 * workerRetryService.moveToDeadLetter (used already by jobRunner). It exists as
 * one function purely so that logic is written once instead of at every
 * `worker.on('failed')` site.
 *
 * Contract:
 *   - Republishes ONLY when BullMQ has spent every attempt. An intermediate
 *     failure is still going to be retried; dead-lettering it would report a
 *     live job as dead.
 *   - NEVER throws and NEVER rejects. It is called from event-emitter
 *     callbacks, where a rejection becomes an unhandled rejection and must
 *     never affect job processing. A DLQ outage degrades to the log line the
 *     caller already emitted.
 *   - Additive: callers keep their existing logging unchanged.
 */
import type { Job } from 'bullmq';

/** Minimal shape needed — accepts BullMQ Job or the `undefined` a failed handler may receive. */
type FailedJob = Pick<Job, 'id' | 'name' | 'data' | 'attemptsMade' | 'opts'> | undefined;

/** True once BullMQ has spent every configured attempt on this job. */
export function isExhausted(job: FailedJob): boolean {
  if (!job) return false;
  const allowed = job.opts?.attempts ?? 1;
  return job.attemptsMade >= allowed;
}

/**
 * Record an exhausted job in the platform dead-letter table. Fire-and-forget:
 * returns void, swallows every failure mode.
 *
 * @param workerName Queue/worker identity stored as `worker_name` — the column
 *                   operators filter dead letters by.
 */
export function deadLetterOnExhaustion(
  workerName: string,
  job: FailedJob,
  err: unknown,
): void {
  try {
    if (!isExhausted(job)) return;

    const payload: Record<string, unknown> = {
      job_id: String(job?.id ?? 'unknown'),
      job_name: job?.name ?? null,
      attempts_made: job?.attemptsMade ?? 0,
      attempts_allowed: job?.opts?.attempts ?? 1,
      data: job?.data ?? null,
    };

    // Imported lazily so this module stays free of a DB-client import chain at
    // worker-bootstrap time — the same technique the lead handler in
    // startWorkers.ts uses for leadQueueHardening.
    void import('../services/workerRetryService')
      .then(({ moveToDeadLetter }) =>
        moveToDeadLetter(
          workerName,
          payload,
          err instanceof Error ? err : String(err ?? 'unknown'),
          payload.attempts_made as number,
        ),
      )
      .catch(onDeadLetterError(workerName, payload.job_id as string));
  } catch (e) {
    // A synchronous throw (bad job shape, import resolution) must not escape
    // into the emitter — `.catch()` above cannot intercept this arm.
    onDeadLetterError(workerName, String(job?.id ?? 'unknown'))(e);
  }
}

function onDeadLetterError(workerName: string, jobId: string) {
  return (e: unknown) => {
    console.error(
      '[dead-letter-publish-failed]',
      JSON.stringify({
        worker_name: workerName,
        job_id: jobId,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  };
}
