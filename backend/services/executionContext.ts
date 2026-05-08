/**
 * ExecutionContext — canonical attribution + lineage carrier for every
 * background-execution surface (cron, queue processors, scheduler
 * dispatchers, admin-triggered jobs).
 *
 * Why this exists:
 *   The HTTP surface uses `requestContext` (AsyncLocalStorage keyed by
 *   request). Background jobs run outside that lifecycle and previously
 *   had no canonical place to record:
 *     - which trigger started the work (cron / queue / scheduler / admin)
 *     - which tenant the work is acting on (if any)
 *     - which user / system principal authorized it
 *     - the correlation chain back to an upstream HTTP request
 *     - the idempotency key for replay safety
 *     - retry attempt count + lineage of prior failures
 *
 * Design:
 *   - AsyncLocalStorage so deep service-layer code can read context
 *     without being passed through every call.
 *   - Compatible with `requestContext`: when a job is enqueued from an
 *     HTTP request, the request's correlationId chains forward into the
 *     job's executionId so distributed traces stay linkable.
 *   - Pure attribution / lineage carrier — does NOT execute work and does
 *     NOT mutate state on its own. Callers (jobRunner, cron handlers,
 *     queue processors) wrap their work with `runWithExecutionContext`.
 *
 * What this is NOT:
 *   - Not a queue. Not a scheduler. Not a retry mechanism. Those exist
 *     and are not being rewritten this phase.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID, createHash } from 'crypto';
import { getRequestContext } from './requestContext';

export type ExecutionTriggerSource =
  | 'cron'        // cron host / Vercel cron / external scheduler
  | 'queue'       // queue processor consumed a message
  | 'scheduler'   // internal scheduler dispatcher fired
  | 'admin'       // operator manually triggered (super-admin endpoint, ops tool)
  | 'webhook'     // external webhook landed (Stripe, OAuth, social platform)
  | 'system';     // internal system maintenance (reaper, reconciler, expiry)

export interface ExecutionContext {
  /** Stable identifier for this single execution. */
  executionId: string;

  /** Where the work originated. */
  triggerSource: ExecutionTriggerSource;

  /** Job name / topic / cron path. Used for routing + dead-letter classification. */
  jobName: string;

  /** Organization the work is acting on. Null for platform-wide work. */
  tenantId: string | null;

  /** User attributable for the work. Null for system-triggered work. */
  principalUserId: string | null;

  /** Free-text label of the principal source (e.g. 'cron-secret', 'super-admin', 'queue:campaign.execute'). */
  principalKind: string;

  /** Chained from upstream HTTP request when the job was triggered by a user. */
  correlationId: string;

  /**
   * Deterministic idempotency key — every mutation downstream MUST use this
   * (or a key derived from it) to remain replay-safe. The job runner
   * populates it from the queue payload, the cron-trigger derivation, or
   * `makeJobIdempotencyKey` below.
   */
  idempotencyKey: string;

  /** Retry attempt count (1 on first run). */
  attempt: number;

  /** Wall-clock start of this attempt. */
  startedAt: string;
}

const executionStore = new AsyncLocalStorage<ExecutionContext>();

/**
 * Run `fn` with an active execution context. The most common entry
 * point is `jobRunner.runJob` — direct callers should usually use that
 * instead of constructing context manually.
 */
export function runWithExecutionContext<T>(
  ctx: ExecutionContext,
  fn: () => T,
): T {
  return executionStore.run(ctx, fn);
}

/**
 * Read the active execution context. Returns null when called outside a
 * job (e.g. from an HTTP route — HTTP code uses `requestContext` instead).
 */
export function getExecutionContext(): ExecutionContext | null {
  return executionStore.getStore() ?? null;
}

/**
 * Build a fresh execution context. Called by the job runner; rarely by
 * direct callers.
 */
export function buildExecutionContext(input: {
  triggerSource:    ExecutionTriggerSource;
  jobName:          string;
  tenantId?:        string | null;
  principalUserId?: string | null;
  principalKind?:   string;
  /**
   * Chain a correlationId from upstream context. When omitted, this
   * helper attempts to lift it from the active `requestContext` (if
   * the job was just enqueued in an HTTP request that's still active),
   * otherwise generates one.
   */
  correlationId?:   string;
  /**
   * Caller-supplied idempotency key. Strongly recommended for queue +
   * cron paths so a replay does not duplicate side effects. When
   * omitted, derived from (jobName, tenantId, time-bucket).
   */
  idempotencyKey?:  string;
  attempt?:         number;
}): ExecutionContext {
  const upstream = getRequestContext();
  const correlationId =
    input.correlationId ||
    upstream.correlationId ||
    upstream.requestId ||
    randomUUID();

  const tenantId = input.tenantId ?? null;
  const idempotencyKey =
    input.idempotencyKey ||
    makeJobIdempotencyKey({
      jobName:  input.jobName,
      tenantId,
      bucketSeconds: 3600,
    });

  return {
    executionId:     randomUUID(),
    triggerSource:   input.triggerSource,
    jobName:         input.jobName,
    tenantId,
    principalUserId: input.principalUserId ?? null,
    principalKind:   input.principalKind   ?? input.triggerSource,
    correlationId,
    idempotencyKey,
    attempt:         Math.max(1, input.attempt ?? 1),
    startedAt:       new Date().toISOString(),
  };
}

/**
 * Build a deterministic idempotency key for a background job. Two
 * invocations of the same (jobName, tenantId, salt) within the same
 * time bucket produce the same key — replays that land in the same
 * window collapse to one mutation.
 *
 * Cron callers: pass `salt = bucketed-time-string` to make every cron
 * tick its own key.
 * Queue callers: pass `salt = messageId` so the broker's at-least-once
 * delivery doesn't double-mutate.
 */
export function makeJobIdempotencyKey(input: {
  jobName: string;
  tenantId?: string | null;
  salt?: string;
  bucketSeconds?: number;
}): string {
  const tenant = input.tenantId ?? '_platform';
  const bucket = input.salt
    ? input.salt
    : Math.floor(Date.now() / ((input.bucketSeconds ?? 3600) * 1000)).toString();
  const raw = `${input.jobName}|${tenant}|${bucket}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}
