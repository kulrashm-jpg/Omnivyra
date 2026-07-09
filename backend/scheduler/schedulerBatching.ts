/**
 * HARDEN-004 — scheduler batching + controlled-concurrency primitives.
 *
 * Shared helpers for eliminating scheduler N+1 patterns without changing
 * behavior:
 *   - mapWithConcurrency: bounded-parallel map that PRESERVES INPUT ORDER in
 *     its results and captures per-item errors instead of failing the batch
 *     (mirrors the per-item try/catch pattern the sequential loops used).
 *   - getSchedulerConcurrency: env-configurable limit (SCHEDULER_CONCURRENCY,
 *     default 5, clamped 1..20) so operators can tune without a deploy.
 *
 * Never use unbounded Promise.all for per-company/per-post work — the
 * database pool is the shared bottleneck.
 */

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 20;

/** Env-configurable scheduler concurrency limit (SCHEDULER_CONCURRENCY). */
export function getSchedulerConcurrency(): number {
  const raw = Number(process.env.SCHEDULER_CONCURRENCY);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.floor(raw));
}

// Non-union shape (the repo compiles with strict:false, where discriminated-
// union narrowing is unreliable): exactly one of value/error is set, per `ok`.
export interface ConcurrentResult<R> {
  ok: boolean;
  value?: R;
  error?: Error;
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Results come back in
 * INPUT ORDER (deterministic aggregation regardless of completion order), and
 * each item's failure is captured in its slot rather than rejecting the whole
 * batch — identical semantics to a sequential `for..of` with per-item
 * try/catch, just faster.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<ConcurrentResult<R>[]> {
  const results: ConcurrentResult<R>[] = new Array(items.length);
  if (items.length === 0) return results;
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  async function runner(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        const value = await fn(items[index], index);
        results[index] = { ok: true, value };
      } catch (err) {
        results[index] = { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => runner()));
  return results;
}
