/**
 * PERF-001 — request-scoped deterministic-load memoization.
 *
 * WHY
 * ───
 * Opening a workspace fans a single HTTP request through helpers that each
 * re-load the SAME campaign data. The clearest case: `loadSources`
 * (canonicalExecutionAdapter) is invoked 2-3× within one /activity-workspace/
 * resolve request, and each invocation re-fetches the full campaign blueprint
 * (getUnifiedCampaignBlueprint) + all daily plans (getDailyPlans). That is
 * duplicate, identical DB work inside a single request.
 *
 * This provides an AsyncLocalStorage-backed memo scoped to ONE request: the
 * first call for a key runs the loader, later calls with the same key reuse the
 * in-flight/settled Promise. Because the scope lives only for the request, the
 * data snapshot is identical for every reader — there is ZERO staleness risk and
 * business behavior is unchanged (a later edit is a new request → fresh load).
 *
 * SAFETY
 * ──────
 *   - No active scope (worker/cron/most routes) → passthrough: the loader runs
 *     exactly as before. Opt-in per handler via runWithRequestMemo().
 *   - A rejected load is dropped from the memo so a retry re-loads (failures are
 *     never cached).
 *   - Fail-safe: any ALS error degrades to a direct load.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { recordRawCounter } from '../observability';

const als = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Seed a fresh memo scope for the duration of `fn` (one request). */
export function runWithRequestMemo<T>(fn: () => T): T {
  try {
    return als.run(new Map<string, Promise<unknown>>(), fn);
  } catch {
    return fn();
  }
}

/**
 * Return the memoized result for `key` within the active request scope, running
 * `load` at most once. Outside a scope, just runs `load` (identical behavior).
 */
export function memoRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  let store: Map<string, Promise<unknown>> | undefined;
  try { store = als.getStore(); } catch { store = undefined; }
  if (!store) return load();

  const existing = store.get(key);
  if (existing) {
    try { recordRawCounter('perf.request_memo', 1, { result: 'hit' }); } catch { /* fail-safe */ }
    return existing as Promise<T>;
  }
  try { recordRawCounter('perf.request_memo', 1, { result: 'miss' }); } catch { /* fail-safe */ }
  const p = load();
  store.set(key, p);
  // Never cache a failed load — drop it so a subsequent caller can retry.
  p.catch(() => { try { store?.delete(key); } catch { /* fail-safe */ } });
  return p;
}

/** True when a request memo scope is active (for tests/diagnostics). */
export function hasRequestMemoScope(): boolean {
  try { return als.getStore() !== undefined; } catch { return false; }
}
