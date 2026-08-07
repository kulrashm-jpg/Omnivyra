/**
 * F-02 — Trace propagation kit (Foundation Batch A).
 *
 * Connects API-side request identity to worker-side job execution using the
 * EXISTING RequestContext ALS (backend/services/requestContext.ts) — no new
 * trace framework, no header format invention. The repo's identity fields
 * (requestId / correlationId, and F-03's traceId) are the trace.
 *
 * Two halves:
 *   - Enqueue side: `withTraceMeta(data)` returns the job payload with an
 *     additive `_trace` field carrying the caller's context. Adopted centrally
 *     via `safeEnqueue`, so every non-exempt enqueue is stamped.
 *   - Worker side: `runWithJobTraceContext(job, fn)` seeds the RequestContext
 *     ALS from `job.data._trace` when present, or from the job identity when
 *     absent, then runs the processor. Wired into the generic getWorker()
 *     factory — purely additive ALS scoping, zero behavior change.
 *
 * Everything is fail-safe: any error degrades to running `fn` unscoped.
 */
import {
  runWithRequestContext,
  getRequestContext,
  type RequestContext,
} from '../services/requestContext';

/** Reserved additive field on BullMQ job payloads. */
export const TRACE_JOB_FIELD = '_trace';

export interface JobTraceMeta {
  requestId?: string;
  correlationId?: string;
  traceId?: string;
}

/** Shape-compatible with a BullMQ Job without importing bullmq here. */
export interface JobLike {
  id?: string | number | null;
  name?: string;
  queueName?: string;
  data?: unknown;
}

/**
 * Capture the active context as job-trace metadata. Returns undefined when no
 * identity is present (worker-to-worker enqueues outside any scope), so bare
 * payloads stay bare.
 */
export function traceMetaForEnqueue(): JobTraceMeta | undefined {
  try {
    const ctx = getRequestContext();
    const traceId = ctx.traceId || ctx.correlationId || ctx.requestId;
    if (!traceId) return undefined;
    return {
      requestId: ctx.requestId,
      correlationId: ctx.correlationId || ctx.requestId,
      traceId,
    };
  } catch {
    return undefined;
  }
}

/**
 * Return `data` with the `_trace` field attached when an active context
 * exists; otherwise return `data` unchanged.
 *
 * Called from ONE place — `safeEnqueue` in backend/middleware/queueBackpressure.ts
 * — which is now the only sanctioned enqueue path (enforced by
 * queueBackpressureAdoption.test.ts). Every non-exempt job is therefore stamped
 * without any per-call-site adoption.
 */
export function withTraceMeta<T extends Record<string, unknown>>(
  data: T,
): T & { [TRACE_JOB_FIELD]?: JobTraceMeta } {
  try {
    const meta = traceMetaForEnqueue();
    if (!meta) return data;
    return { ...data, [TRACE_JOB_FIELD]: meta };
  } catch {
    return data;
  }
}

function readTraceMeta(job: JobLike | undefined): JobTraceMeta | undefined {
  try {
    const data = job?.data as Record<string, unknown> | undefined;
    const raw = data?.[TRACE_JOB_FIELD];
    if (!raw || typeof raw !== 'object') return undefined;
    const meta = raw as JobTraceMeta;
    if (!meta.traceId && !meta.correlationId && !meta.requestId) return undefined;
    return meta;
  } catch {
    return undefined;
  }
}

/**
 * Run a job processor inside a RequestContext seeded from the job's trace
 * metadata (when the enqueuer stamped it) or from the job identity (when it
 * didn't). This is what links `api → queue → worker` series once enqueue
 * sites adopt withTraceMeta(). Fail-safe: on any error, runs `fn` unscoped.
 */
export function runWithJobTraceContext<T>(job: JobLike | undefined, fn: () => T): T {
  try {
    const jobIdentity = `job:${job?.queueName ?? job?.name ?? 'queue'}:${job?.id ?? 'unknown'}`;
    const meta = readTraceMeta(job);
    const ctx: RequestContext = {
      requestId: jobIdentity,
      correlationId: meta?.correlationId || meta?.traceId || meta?.requestId || jobIdentity,
      traceId: meta?.traceId || meta?.correlationId || meta?.requestId || jobIdentity,
    };
    return runWithRequestContext(ctx, fn);
  } catch {
    return fn();
  }
}
