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

// F-08 (Foundation Batch C): the implementation was PROMOTED verbatim to the
// platform concurrency kit — this re-export keeps every scheduler call site
// unchanged while guaranteeing there is exactly ONE implementation.
export { mapWithConcurrency } from '../../lib/platform/concurrency';
export type { ConcurrentResult } from '../../lib/platform/concurrency';
