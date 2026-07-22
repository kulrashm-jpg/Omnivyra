/**
 * Writer Wave 3 — AI Runtime Consolidation: DETERMINISTIC RETRY.
 *
 * `executeWithRetry` wraps a single async unit of work (the GENERATION call) and
 * retries it under a RetryPolicy. It is:
 *
 *   - CLASSIFYING — every thrown error is mapped to a RetryErrorClass
 *     (transient / provider / timeout / fatal) via the policy's own `classify`
 *     (defaults to the gateway taxonomy in taskPolicyRegistry). transient,
 *     provider and timeout are retried; fatal is rethrown immediately.
 *
 *   - DETERMINISTIC — backoff is exponential on the policy's `backoffMs`
 *     (backoffMs * 2^(attempt-1), capped) with NO jitter, so a given failure
 *     sequence always produces the same delays. The sleep function is injectable
 *     for tests.
 *
 *   - IDEMPOTENT — it accepts an `idempotencyKey` and, by contract, wraps ONLY
 *     the pure generation call. Persistence is a SEPARATE post-success step the
 *     caller runs once, so a retried generation can NEVER double-persist. This
 *     wrapper performs no writes of its own.
 *
 * Returns the successful value plus the attempt/retry counts so the runtime can
 * emit `runtime.retries`.
 */

import type { RetryErrorClass, RetryPolicy } from './contracts';
import { classifyGatewayError } from './taskPolicyRegistry';

/** The error classes that are eligible for a retry. `fatal` is never retried. */
const RETRYABLE: ReadonlySet<RetryErrorClass> = new Set<RetryErrorClass>([
  'transient',
  'provider',
  'timeout',
]);

export interface ExecuteWithRetryOptions {
  /**
   * Idempotency marker for the wrapped generation call. Present so callers can
   * assert (and log) that a retried generation is safe; persistence is applied
   * once, by the caller, AFTER a successful return — never inside this wrapper.
   */
  idempotencyKey?: string;
  /** Override the policy's error classifier (defaults to policy.classify). */
  classify?: (err: unknown) => RetryErrorClass;
  /** Observe each retry decision (fail-safe; thrown errors here are swallowed). */
  onRetry?: (info: {
    attempt: number;
    errorClass: RetryErrorClass;
    error: unknown;
    delayMs: number;
  }) => void;
  /** Injectable sleep (tests pass a no-op / fake-timer aware fn). */
  sleep?: (ms: number) => Promise<void>;
  /** Hard cap on a single backoff delay. Defaults to backoffMs * 8. */
  maxBackoffMs?: number;
}

export interface RetryOutcome<T> {
  value: T;
  /** Total attempts made (always >= 1). */
  attempts: number;
  /** Retries consumed (attempts - 1). */
  retries: number;
  /** Classification of the last error seen, or null if none was thrown. */
  lastErrorClass: RetryErrorClass | null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` under `retry`, retrying retryable failures with deterministic
 * exponential backoff. `fn` receives the 1-based attempt number.
 */
export async function executeWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  retry: RetryPolicy,
  options: ExecuteWithRetryOptions = {},
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, Math.trunc(retry?.maxAttempts ?? 1));
  const backoffMs = Math.max(0, retry?.backoffMs ?? 0);
  const classify = options.classify ?? retry?.classify ?? classifyGatewayError;
  const sleep = options.sleep ?? defaultSleep;
  const maxBackoffMs = options.maxBackoffMs ?? backoffMs * 8;

  let lastError: unknown;
  let lastErrorClass: RetryErrorClass | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt, retries: attempt - 1, lastErrorClass };
    } catch (err) {
      lastError = err;
      let errorClass: RetryErrorClass;
      try {
        errorClass = classify(err);
      } catch {
        errorClass = 'fatal';
      }
      lastErrorClass = errorClass;

      // Fatal → surface immediately (validation, 4xx, programmer error, …).
      if (!RETRYABLE.has(errorClass)) throw err;
      // Retryable but out of attempts → surface the final error.
      if (attempt >= maxAttempts) throw err;

      // Deterministic exponential backoff, no jitter.
      const delayMs = Math.min(maxBackoffMs, backoffMs * Math.pow(2, attempt - 1));
      try {
        options.onRetry?.({ attempt, errorClass, error: err, delayMs });
      } catch {
        /* observation hook must never break the retry loop */
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  // Unreachable (the loop returns or throws), but typed-safe.
  throw lastError;
}
