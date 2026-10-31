/**
 * OPS-C — the outcome-reporting add that applyQueueProtection() attaches to
 * every protected queue.
 *
 * The patched `queue.add` keeps its historical contract (it returns `null` when
 * the usage guard parks or drops the job), because the exempt direct-add paths
 * (dead-letter republication, operator requeue) rely on it. `null` alone,
 * however, cannot tell a caller whether the job was parked (and will be
 * replayed), coalesced into an already-parked job, or dropped because the
 * overflow buffer was full. safeEnqueue() needs that distinction, so the guard
 * also exposes this richer entry point under a registry symbol.
 *
 * A registry symbol (`Symbol.for`) keeps queueBackpressure free of a runtime
 * import of bullmqClient (which would pull the Redis connection graph into
 * every producer that only needs the backpressure helper).
 */

export const PROTECTED_ADD = Symbol.for('omnivyra.queue.protectedAdd');

export type ProtectedAddResult =
  /** Accepted by Redis. `job` is whatever the underlying `add` returned. */
  | { kind: 'added'; job: { id?: string | null } | null }
  /** Parked in the in-process overflow buffer; replayed when usage falls below throttle. */
  | { kind: 'overflow_stored'; retract: () => boolean }
  /** A job with the same jobId is already parked; this add was folded into it. */
  | { kind: 'overflow_coalesced' }
  /** The overflow buffer for this queue is full; nothing was stored. */
  | { kind: 'overflow_dropped' };

export type ProtectedAddFn = (
  name: string,
  data: unknown,
  opts?: Record<string, unknown>,
) => Promise<ProtectedAddResult>;

export function getProtectedAdd(queue: unknown): ProtectedAddFn | null {
  if (!queue || (typeof queue !== 'object' && typeof queue !== 'function')) return null;
  const fn = (queue as Record<symbol, unknown>)[PROTECTED_ADD];
  return typeof fn === 'function' ? (fn as ProtectedAddFn) : null;
}
