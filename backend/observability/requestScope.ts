/**
 * HARDEN-001A — request-scoped DB profiling via AsyncLocalStorage.
 *
 * Accumulates per-request database stats (query count, total/avg/max time, slow
 * count) without touching query execution. The API wrapper seeds a scope around
 * each handler; recordDb() notes each query into the active scope; the wrapper
 * flushes the totals into the request's API metric on finish.
 *
 * Fully fail-safe and additive — when no scope is active (worker/cron paths),
 * noteDbQuery is a no-op.
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestDbStats {
  count: number;
  totalMs: number;
  slowCount: number;
  maxMs: number;
}

const store = new AsyncLocalStorage<RequestDbStats>();

export function newRequestDbStats(): RequestDbStats {
  return { count: 0, totalMs: 0, slowCount: 0, maxMs: 0 };
}

/** Run `fn` (and all its async continuations) with the given DB-stats scope. */
export function runWithRequestDbScope<T>(stats: RequestDbStats, fn: () => T): T {
  try {
    return store.run(stats, fn);
  } catch {
    // If ALS.run itself throws for any reason, still execute the handler.
    return fn();
  }
}

/** Note one DB query into the active request scope, if any. Fail-safe. */
export function noteDbQuery(durationMs: number, slow: boolean): void {
  try {
    const s = store.getStore();
    if (!s) return;
    s.count += 1;
    s.totalMs += durationMs;
    if (slow) s.slowCount += 1;
    if (durationMs > s.maxMs) s.maxMs = durationMs;
  } catch { /* fail-safe */ }
}

export function getRequestDbStats(): RequestDbStats | undefined {
  try { return store.getStore(); } catch { return undefined; }
}
