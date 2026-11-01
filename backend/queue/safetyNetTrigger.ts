/**
 * OPS-C — cron safety-net triggers for the DB-backed drain queues
 * (lead-thread-recompute, conversation-memory-rebuild).
 *
 * The durable work lives in database rows (the recompute / rebuild schedule
 * tables); the BullMQ job is only a "drain now" trigger under the fixed jobId
 * 'drain'. So:
 *   - a trigger that is not accepted loses nothing — the rows stay pending and
 *     the next tick (5 min) offers the trigger again;
 *   - a trigger the Redis usage guard parks is KEPT for the overflow replay
 *     ('keep'), and repeated ticks coalesce on jobId 'drain' instead of
 *     filling the overflow buffer with copies (the 2026-10-30 incident parked
 *     one copy per tick per queue);
 *   - nothing here throws: before OPS-C a parked trigger made safeEnqueue
 *     throw `TypeError: Cannot read properties of null (reading 'id')`, which
 *     scheduleWorker logged as a worker error every tick.
 */

import type { Queue } from 'bullmq';
import { enqueueWithOutcome, isEnqueuePending, type EnqueueOutcome, type EnqueueStatus } from '../middleware/queueBackpressure';

export const SAFETY_NET_JOB_ID = 'drain';

export interface SafetyNetResult {
  /** 1 when the trigger is in Redis or pending replay; 0 otherwise. */
  triggered: number;
  /** 1 when the trigger was not accepted and the next tick owns the retry. */
  retry_next_tick: number;
  /** 1 for a permanent failure (dropped_overflow_full / failed). */
  failed: number;
}

export async function triggerSafetyNetDrain(args: {
  label: string;
  getQueue: () => Queue;
  queueName: string;
  jobName: string;
  /** Injected for tests. */
  recordCounter?: (name: string, value: number, labels: Record<string, string>) => void;
  log?: (level: 'warn' | 'error', line: string) => void;
}): Promise<SafetyNetResult & { status: EnqueueStatus }> {
  let outcome: EnqueueOutcome;
  try {
    outcome = await enqueueWithOutcome(args.getQueue(), args.queueName, args.jobName, {}, {
      jobId: SAFETY_NET_JOB_ID,
      delay: 200,
      onDeferred: 'keep',
    });
  } catch (err) {
    // getQueue() itself failed (no Redis configuration) — enqueueWithOutcome never throws.
    outcome = { status: 'failed', errorName: err instanceof Error ? err.name.slice(0, 64) : 'UnknownError' };
  }

  const pending = isEnqueuePending(outcome);
  const permanent = outcome.status === 'dropped_overflow_full' || outcome.status === 'failed';
  try {
    const record = args.recordCounter ?? defaultRecordCounter;
    record('cron.safetynet.outcome', 1, { label: args.label, status: outcome.status });
  } catch { /* fail-safe */ }

  if (outcome.status !== 'enqueued') {
    const line = JSON.stringify({
      level: permanent ? 'ERROR' : 'WARN',
      event: 'cron_safetynet_not_enqueued',
      label: args.label,
      queue: args.queueName,
      status: outcome.status,
      pending,
      retry: pending ? 'overflow_replay' : 'next_tick',
    });
    const log = args.log ?? ((lvl, l) => (lvl === 'error' ? console.error(l) : console.warn(l)));
    log(permanent ? 'error' : 'warn', line);
  }

  return {
    status: outcome.status,
    triggered: pending ? 1 : 0,
    retry_next_tick: pending ? 0 : 1,
    failed: permanent ? 1 : 0,
  };
}

function defaultRecordCounter(name: string, value: number, labels: Record<string, string>): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { recordRawCounter } = require('../observability/metrics') as typeof import('../observability/metrics');
  recordRawCounter(name, value, labels);
}
