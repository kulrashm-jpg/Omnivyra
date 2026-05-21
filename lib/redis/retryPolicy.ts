/**
 * Shared bounded reconnect policy for ioredis clients.
 *
 * Every reconnect to Upstash performs an AUTH, and AUTH is a billed command.
 * ioredis's default retryStrategy reconnects every <=2s indefinitely; under a
 * sustained outage (e.g. Upstash request-quota exhaustion, where the AUTH
 * itself is rejected) that is ~43,200 reconnect+AUTH cycles per day per
 * client — a self-amplifying burn storm that accelerates quota exhaustion.
 *
 * boundedRetryStrategy applies exponential backoff with full jitter, capped at
 * RECONNECT_MAX_DELAY_MS, so a sustained outage costs at most ~2,880
 * reconnects/day/client (~93% fewer) while still recovering within seconds
 * from a brief blip. It never returns null/undefined: a BullMQ worker that
 * stops reconnecting stops consuming jobs permanently, so recovery is always
 * preserved.
 */

/** First-attempt backoff before jitter. */
const RECONNECT_BASE_DELAY_MS = 200;
/** Hard cap on reconnect spacing — bounds steady-state outage burn. */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * ioredis `retryStrategy`. `times` is the consecutive reconnect attempt count.
 * Returns the delay (ms) before the next reconnect attempt.
 */
export function boundedRetryStrategy(times: number): number {
  const expo = RECONNECT_BASE_DELAY_MS * 2 ** Math.min(times, 8);
  const capped = Math.min(expo, RECONNECT_MAX_DELAY_MS);
  // Full jitter — spreads reconnects so co-located clients do not AUTH in
  // lockstep (lockstep AUTH bursts are themselves a burst of billed commands).
  return Math.round(capped / 2 + Math.random() * (capped / 2));
}

/**
 * Standalone (non-BullMQ) clients open the circuit after this many consecutive
 * failed reconnects. ~15 attempts of bounded backoff spans ~5-6 minutes —
 * enough to ride out a transient blip, after which a cache client should fail
 * fast to its in-memory fallback rather than hold an indefinite reconnect loop.
 */
export const MAX_STANDALONE_RECONNECT_ATTEMPTS = 15;

/**
 * ioredis `retryStrategy` for standalone clients (caches, cron guard/instr,
 * admin config, intent service). Same bounded backoff as boundedRetryStrategy,
 * but returns null (opens the circuit — ioredis stops reconnecting) after
 * MAX_STANDALONE_RECONNECT_ATTEMPTS. This is fail-fast on repeated failure.
 *
 * BullMQ connections must NOT use this — a worker that stops reconnecting
 * stops consuming jobs forever. They use boundedRetryStrategy, which never
 * gives up.
 */
export function circuitBreakerRetryStrategy(times: number): number | null {
  if (times > MAX_STANDALONE_RECONNECT_ATTEMPTS) return null;
  return boundedRetryStrategy(times);
}

/** Errors that a reconnect cannot fix — reconnecting only burns another AUTH. */
const NON_RECOVERABLE =
  /max requests limit exceeded|WRONGPASS|NOAUTH|invalid username-password|user is disabled/i;

export function isNonRecoverableRedisError(err: unknown): boolean {
  return NON_RECOVERABLE.test(((err as Error)?.message) || '');
}

/**
 * ioredis `reconnectOnError`. Decides whether an error *reply* should force a
 * reconnect. A quota/credential error is not fixable by reconnecting, so we
 * keep the socket and let the next command fail cheaply instead of triggering
 * a reconnect+AUTH cycle.
 */
export function reconnectOnError(err: Error): boolean {
  return !isNonRecoverableRedisError(err);
}
