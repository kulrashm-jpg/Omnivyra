/**
 * retryPolicy — centralized retry behavior for auth-relevant fetches.
 *
 * Design constraints
 * ──────────────────
 *   1. Exponential backoff with full jitter to avoid retry storms.
 *   2. Capped maximum attempts AND capped maximum total elapsed time.
 *   3. Retryability awareness — the policy NEVER retries a fatal code
 *      (INVALID_SESSION / ACCOUNT_DELETED / ACCOUNT_DISABLED).
 *   4. Optional server hint via `Retry-After` / `retryAfterMs` in the
 *      payload — the policy respects it as a lower bound on the next
 *      delay.
 *   5. Deterministic in tests via the `nowMs` / `randomMs` injectables.
 *
 * Usage
 * ─────
 *   const policy = createRetryPolicy({ maxAttempts: 4, baseDelayMs: 400 });
 *   const result = await runWithRetry(policy, async () => {
 *     return fetch('/api/company-profile?mode=list', { ... });
 *   });
 *   if (result.outcome === 'success') ...
 *   if (result.outcome === 'failed')  ...
 */

import {
  AUTH_ERROR_CODE,
  type AuthErrorCode,
  isSessionFatalCode,
} from '../../shared/contracts/security/AuthErrorCodes';
import { parseAuthErrorResponse } from '../../shared/contracts/security/AuthErrorResponse';

export interface RetryPolicy {
  maxAttempts:     number;
  baseDelayMs:     number;
  /** Hard cap on a single delay before next attempt. */
  maxDelayMs:      number;
  /** Hard cap on total elapsed time across attempts. */
  totalBudgetMs:   number;
  /** Injectable for tests. */
  nowMs?:    () => number;
  randomMs?: () => number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts:     4,
  baseDelayMs:     400,
  maxDelayMs:      8_000,
  totalBudgetMs:   30_000,
};

export interface AttemptOutcome<T> {
  ok:        boolean;
  value?:    T;
  /** Set when the attempt produced a fatal auth code — DO NOT retry. */
  fatalCode?: AuthErrorCode;
  /** Set when the attempt produced a retryable failure. */
  retryableReason?: string;
  /** Server-supplied retry hint in ms. */
  retryAfterMs?:   number;
}

export interface RetryResult<T> {
  outcome:     'success' | 'fatal' | 'exhausted' | 'budget_exceeded';
  attempts:    number;
  lastError?:  string;
  fatalCode?:  AuthErrorCode;
  value?:      T;
}

export interface RunInput<T> {
  attempt: () => Promise<AttemptOutcome<T>>;
  /** Caller-supplied label used in event logs. */
  label:   string;
  /** Optional sleep hook for tests. Default uses setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export function createRetryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, ...overrides };
}

/**
 * Run `attempt()` under the policy. Returns a structured outcome.
 * NEVER throws; failure modes are returned as outcomes.
 */
export async function runWithRetry<T>(
  policy: RetryPolicy,
  input: RunInput<T>,
): Promise<RetryResult<T>> {
  const now    = policy.nowMs    ?? (() => Date.now());
  const rand   = policy.randomMs ?? (() => Math.random());
  const sleep  = input.sleep     ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const startedAt = now();
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    if (now() - startedAt > policy.totalBudgetMs) {
      return { outcome: 'budget_exceeded', attempts: attempt - 1, lastError };
    }
    const result = await input.attempt();
    if (result.ok) {
      return { outcome: 'success', attempts: attempt, value: result.value };
    }
    if (result.fatalCode) {
      return {
        outcome:   'fatal',
        attempts:  attempt,
        lastError: result.retryableReason,
        fatalCode: result.fatalCode,
      };
    }
    lastError = result.retryableReason ?? 'unknown';
    if (attempt === policy.maxAttempts) {
      return { outcome: 'exhausted', attempts: attempt, lastError };
    }
    // Exponential backoff with full jitter, optionally clamped up by the
    // server's Retry-After hint. Jitter range is [0, expDelay].
    const expDelay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
    let nextDelay = Math.floor(rand() * expDelay);
    if (result.retryAfterMs !== undefined) {
      nextDelay = Math.max(nextDelay, result.retryAfterMs);
    }
    await sleep(nextDelay);
  }
  return { outcome: 'exhausted', attempts: policy.maxAttempts, lastError };
}

/**
 * Translate a fetch Response + parsed body into an {@link AttemptOutcome}.
 * Provided as a convenience so callers don't re-implement the classification
 * matrix at every site.
 */
export function classifyFetchOutcome<T>(input: {
  res: Response;
  body: unknown;
  value?: T;
}): AttemptOutcome<T> {
  const { res, body } = input;
  if (res.ok) return { ok: true, value: input.value };

  const parsed = parseAuthErrorResponse(body);
  if (parsed) {
    if (parsed.fatal || isSessionFatalCode(parsed.code)) {
      return { ok: false, fatalCode: parsed.code, retryableReason: parsed.error };
    }
    if (parsed.retryable) {
      return {
        ok: false,
        retryableReason: parsed.error,
        retryAfterMs:    parsed.retryAfterMs,
      };
    }
    // Non-retryable, non-fatal — treat as exhausted-after-one-attempt.
    return { ok: false, retryableReason: parsed.error };
  }

  // No envelope — apply HTTP-status heuristic. 4xx that isn't 408/429
  // is non-retryable; 5xx and 408/429 are retryable.
  if (res.status >= 500 || res.status === 408 || res.status === 429) {
    return { ok: false, retryableReason: `http_${res.status}` };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      fatalCode: AUTH_ERROR_CODE.INVALID_SESSION,
      retryableReason: `http_${res.status}`,
    };
  }
  return { ok: false, retryableReason: `http_${res.status}` };
}
