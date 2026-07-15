/**
 * F-14 — Long-Operation Runway (Foundation Batch D).
 *
 * Generalization of the W3-4 async-planner pattern (EXTRACTED from that
 * implementation — plan.ts and the ai-heavy worker now consume this): any
 * >5 s operation runs as
 *
 *   API:    enqueueRunwayOperation() → 202 envelope (or stored result on
 *           re-poll) — deterministic pollKey doubles as the BullMQ jobId so
 *           duplicate submissions coalesce, and as the result-store
 *           idempotency key so results survive worker restarts.
 *   Worker: completeRunwayOperation() persists the payload to the EXISTING
 *           aiExecutionResultStore (billing_operations.metadata — the
 *           CAMPAIGN-IMPL-005 resume seam; no new storage).
 *   Client: re-submits the same request → 200 with the stored payload.
 *
 * Progress reporting: the enqueue path stamps trace context (W0-3 via
 * safeEnqueue) and existing per-flow progress channels (BOLT substages)
 * keep working unchanged — this module deliberately owns only the
 * enqueue/poll/result lifecycle. Cancellation hook: cancelRunwayOperation
 * removes a still-waiting job (best-effort; running jobs finish and their
 * result simply expires unread).
 */
import { createHash } from 'crypto';
import type { Queue } from 'bullmq';
import { safeEnqueue } from '../../backend/middleware/queueBackpressure';
import {
  loadAiExecutionResult,
  saveAiExecutionResult,
} from '../../backend/services/ai/aiExecutionResultStore';
import { recordRawCounter } from '../../backend/observability';

export interface RunwayEnvelope {
  async: true;
  status: 'queued' | 'busy';
  poll_key: string;
  retry_after_ms: number;
}

/**
 * Deterministic poll key from the operation's identity + inputs.
 * CERT-FIX (housekeeping): stable serialization — object keys are sorted
 * recursively so structurally-equal inputs always produce the same key, and
 * unserializable inputs (circular refs) degrade to a defensive fallback
 * instead of throwing on the request path.
 */
export function buildRunwayPollKey(operation: string, scopeId: string, inputs: unknown): string {
  const stableStringify = (value: unknown): string => {
    const seen = new WeakSet<object>();
    const walk = (v: unknown): unknown => {
      if (v === null || typeof v !== 'object') return v;
      if (seen.has(v as object)) return '[circular]';
      seen.add(v as object);
      if (Array.isArray(v)) return v.map(walk);
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    };
    return JSON.stringify(walk(value));
  };
  let serialized: string;
  try {
    serialized = stableStringify(inputs ?? null);
  } catch {
    serialized = String(inputs);
  }
  const hash = createHash('sha256').update(serialized).digest('hex').slice(0, 24);
  return `${operation}:${scopeId}:${hash}`;
}

/** Stored-result lookup for the poll path. */
export async function pollRunwayResult<T = unknown>(pollKey: string): Promise<T | null> {
  const stored = await loadAiExecutionResult<T>(pollKey);
  return stored ? stored.payload : null;
}

export interface RunwayJobStatus {
  state: 'absent' | 'pending' | 'active' | 'completed_no_result' | 'failed';
  failedReason?: string;
}

/**
 * CERT-FIX P1 (certification §14.1): inspect the underlying job so the poll
 * path can surface DETERMINISTIC failure instead of polling forever.
 *
 *   failed              → the job threw (planner error, or persistence
 *                          rejected — see completeRunwayOperation). The job
 *                          is REMOVED so a re-submission re-runs instead of
 *                          being swallowed by jobId dedup against a retained
 *                          failed job.
 *   completed_no_result → the job finished but no result is stored (legacy
 *                          persist-failure window). Also removed for re-run.
 *   pending/active      → still working (202).
 *   absent              → nothing enqueued (caller may enqueue).
 *
 * Never throws — Redis trouble reports 'pending' (the safe answer: keep
 * polling; the enqueue path's jobId idempotency prevents duplicates).
 */
export async function getRunwayJobStatus(queue: Queue, pollKey: string): Promise<RunwayJobStatus> {
  try {
    const job = await queue.getJob(pollKey);
    if (!job) return { state: 'absent' };
    const state = await job.getState();
    if (state === 'failed') {
      const failedReason = String((job as { failedReason?: string }).failedReason ?? 'operation failed');
      try { await job.remove(); } catch { /* retention will clear it */ }
      try { recordRawCounter('runway.poll_failed_surfaced', 1, {}); } catch { /* fail-safe */ }
      return { state: 'failed', failedReason };
    }
    if (state === 'completed') {
      // Result should have been stored; caller already checked and found
      // none → persistence failed. Clear the job so a re-submission re-runs.
      try { await job.remove(); } catch { /* retention will clear it */ }
      try { recordRawCounter('runway.poll_completed_no_result', 1, {}); } catch { /* fail-safe */ }
      return { state: 'completed_no_result' };
    }
    return { state: state === 'active' ? 'active' : 'pending' };
  } catch {
    return { state: 'pending' };
  }
}

export class RunwayPersistError extends Error {
  constructor(action: string) {
    super(
      `runway result persistence failed for '${action}' — payload exceeded the resume-store cap ` +
      `(enable 'result-store-compression' for large results) or the store write failed`,
    );
    this.name = 'RunwayPersistError';
  }
}

/**
 * Enqueue the operation (idempotent on pollKey) and return the 202 envelope.
 * Callers check pollRunwayResult FIRST and only enqueue on miss.
 */
export async function enqueueRunwayOperation(args: {
  queue: Queue;
  queueName: string;
  jobName: string;
  pollKey: string;
  payload: Record<string, unknown>;
  priority?: number;
  retryAfterMs?: number;
}): Promise<RunwayEnvelope> {
  const enqueued = await safeEnqueue(
    args.queue,
    args.queueName,
    args.jobName,
    { ...args.payload, pollKey: args.pollKey },
    { jobId: args.pollKey, priority: args.priority ?? 5 },
  );
  try { recordRawCounter('runway.enqueued', 1, { job: args.jobName, ok: Boolean(enqueued) }); } catch { /* fail-safe */ }
  return {
    async: true,
    status: enqueued ? 'queued' : 'busy',
    poll_key: args.pollKey,
    retry_after_ms: args.retryAfterMs ?? 2_500,
  };
}

/**
 * Worker-side completion: persist the result under the poll key.
 *
 * CERT-FIX P1: persistence failure now THROWS (RunwayPersistError) so the
 * BullMQ job transitions to `failed` and the poll path surfaces a
 * deterministic error — previously the job completed silently with no
 * result and clients polled until job retention expired (~12 h). Billing is
 * unaffected: charges happen inside the operation itself, and a re-run of a
 * settled idempotency key is UNCHARGED by the existing IMPL-005 resume
 * semantics.
 */
export async function completeRunwayOperation(args: {
  pollKey: string;
  action: string;
  organizationId: string;
  actorUserId: string;
  module: string;
  payload: unknown;
}): Promise<boolean> {
  const saved = await saveAiExecutionResult({
    idempotencyKey: args.pollKey,
    action: args.action,
    organizationId: args.organizationId,
    actorUserId: args.actorUserId || 'system',
    module: args.module,
    payload: args.payload,
  });
  try { recordRawCounter('runway.completed', 1, { action: args.action, persisted: saved }); } catch { /* fail-safe */ }
  if (!saved) throw new RunwayPersistError(args.action);
  return saved;
}

/** Best-effort cancellation of a not-yet-running job. */
export async function cancelRunwayOperation(queue: Queue, pollKey: string): Promise<boolean> {
  try {
    const job = await queue.getJob(pollKey);
    if (!job) return false;
    const state = await job.getState();
    if (state === 'waiting' || state === 'delayed') {
      await job.remove();
      try { recordRawCounter('runway.cancelled', 1, {}); } catch { /* fail-safe */ }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
