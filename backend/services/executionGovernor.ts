/**
 * Execution Governor — canonical runtime authority for tenant-aware
 * concurrency limits, retry-rate ceilings, and burst damping.
 *
 * Why this exists:
 *   The platform already has bounded retries (workerRetryService) and
 *   per-job idempotency (jobRunner) and cron-overlap protection
 *   (scheduler_locks). What was missing:
 *     - per-tenant concurrency caps so one noisy tenant cannot saturate
 *       the worker pool against everyone else
 *     - per-(tenant, job) retry-rate detection so storms are visible
 *       and dampable
 *     - burst-damping so a single API endpoint cannot fan out to a
 *       million parallel runJob calls in milliseconds
 *
 * What this is NOT:
 *   - Not a queue. Not a scheduler. Not a job model. The governor is
 *     a thin acquire/release primitive composable into existing job
 *     wrappers. Per phase scope: do NOT rewrite queue / scheduler.
 *   - Not Redis-backed. In-memory `Map`s for the prototype; the public
 *     surface is shaped so a Redis swap is local. Multi-instance
 *     correctness requires Redis — single-instance correctness holds.
 *
 * Acquire/release pattern:
 *   const lease = governor.acquire({ key, max });
 *   if (!lease.ok) {
 *     // governor refused — caller decides retry policy
 *     return { status: 'pressure_rejected', reason: lease.reason };
 *   }
 *   try {
 *     return await doWork();
 *   } finally {
 *     lease.release();
 *   }
 *
 * Keys are caller-defined strings — typically `tenant:<orgId>` or
 * `tenant:<orgId>:job:<jobName>` or `global:<jobName>`. The governor
 * does not interpret the key shape; it just enforces the per-key cap.
 */

import { logger } from './logger';

// ── Concurrency state ────────────────────────────────────────────────────────

interface ConcurrencyEntry {
  count: number;
  lastChangeAt: number;
}

const concurrency = new Map<string, ConcurrencyEntry>();

// ── Retry-rate state ─────────────────────────────────────────────────────────

interface RetryWindow {
  count: number;
  windowStartedAt: number;
}

/** rolling 60-second window per scope. */
const retryWindows = new Map<string, RetryWindow>();
const RETRY_WINDOW_MS = 60_000;

// ── Burst-damping state ──────────────────────────────────────────────────────

interface BurstWindow {
  count: number;
  bucketStart: number;
}

const burstBuckets = new Map<string, BurstWindow>();
const BURST_BUCKET_MS = 1_000;

// ── Public types ─────────────────────────────────────────────────────────────

export type AcquireRefusedReason =
  | 'CONCURRENCY_LIMIT'
  | 'RETRY_STORM'
  | 'BURST_LIMIT';

export interface ConcurrencyLease {
  ok: true;
  key: string;
  inUse: number;
  release: () => void;
}

export type AcquireResult =
  | ConcurrencyLease
  | { ok: false; reason: AcquireRefusedReason; key: string; inUse?: number; retryRate?: number };

export interface AcquireInput {
  key: string;
  /** Max concurrent leases for this key. */
  max: number;
  /** Optional burst limit — max acquires per second for the same key. */
  maxPerSecond?: number;
  /** Optional retry-rate cap — max retry signals per minute for the same key. */
  maxRetriesPerMinute?: number;
  /** When provided, signals that this acquire is itself a retry attempt
   *  so retry-rate accounting increments. Default false. */
  isRetry?: boolean;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Try to acquire a concurrency lease. Returns `{ok: true, release}` on
 * success; `{ok: false, reason}` when the governor refuses (caller decides
 * how to handle — typically reject with a 429 or shed the work).
 *
 * The ordering is: burst → retry-rate → concurrency. The least-expensive
 * checks come first so a burst attack pays no concurrency-state cost.
 */
export function acquire(input: AcquireInput): AcquireResult {
  const now = Date.now();

  // ── 1. Burst limit ──────────────────────────────────────────────────────
  if (input.maxPerSecond && input.maxPerSecond > 0) {
    const bucketKey = `burst:${input.key}`;
    const cur = burstBuckets.get(bucketKey);
    if (cur && now - cur.bucketStart < BURST_BUCKET_MS) {
      if (cur.count >= input.maxPerSecond) {
        return { ok: false, reason: 'BURST_LIMIT', key: input.key };
      }
      cur.count += 1;
    } else {
      burstBuckets.set(bucketKey, { count: 1, bucketStart: now });
    }
  }

  // ── 2. Retry-rate cap ──────────────────────────────────────────────────
  if (input.isRetry && input.maxRetriesPerMinute && input.maxRetriesPerMinute > 0) {
    const winKey = `retry:${input.key}`;
    const cur = retryWindows.get(winKey);
    if (cur && now - cur.windowStartedAt < RETRY_WINDOW_MS) {
      if (cur.count >= input.maxRetriesPerMinute) {
        logger.warn('execution_governor_retry_storm', {
          key: input.key,
          count: cur.count,
          maxPerMinute: input.maxRetriesPerMinute,
        });
        return {
          ok: false,
          reason: 'RETRY_STORM',
          key: input.key,
          retryRate: cur.count,
        };
      }
      cur.count += 1;
    } else {
      retryWindows.set(winKey, { count: 1, windowStartedAt: now });
    }
  }

  // ── 3. Concurrency cap ─────────────────────────────────────────────────
  const cur = concurrency.get(input.key);
  const inUse = cur?.count ?? 0;
  if (inUse >= input.max) {
    return {
      ok: false,
      reason: 'CONCURRENCY_LIMIT',
      key: input.key,
      inUse,
    };
  }

  const next: ConcurrencyEntry = {
    count: inUse + 1,
    lastChangeAt: now,
  };
  concurrency.set(input.key, next);

  let released = false;
  return {
    ok: true,
    key:   input.key,
    inUse: next.count,
    release: () => {
      if (released) return;
      released = true;
      const after = concurrency.get(input.key);
      if (!after) return;
      const remaining = after.count - 1;
      if (remaining <= 0) {
        concurrency.delete(input.key);
      } else {
        concurrency.set(input.key, { count: remaining, lastChangeAt: Date.now() });
      }
    },
  };
}

// ── Inspection (consumed by runtimePressureMonitor) ──────────────────────────

export interface ConcurrencySnapshot {
  key:        string;
  inUse:      number;
  ageMs:      number;
}

export interface RetryRateSnapshot {
  key:               string;
  countLastMinute:   number;
  windowAgeMs:       number;
}

export function snapshotConcurrency(): ConcurrencySnapshot[] {
  const now = Date.now();
  const out: ConcurrencySnapshot[] = [];
  for (const [key, entry] of concurrency.entries()) {
    out.push({
      key,
      inUse: entry.count,
      ageMs: now - entry.lastChangeAt,
    });
  }
  return out.sort((a, b) => b.inUse - a.inUse);
}

export function snapshotRetryRates(): RetryRateSnapshot[] {
  const now = Date.now();
  const out: RetryRateSnapshot[] = [];
  for (const [winKey, entry] of retryWindows.entries()) {
    if (now - entry.windowStartedAt >= RETRY_WINDOW_MS) continue; // expired
    out.push({
      key:             winKey.replace(/^retry:/, ''),
      countLastMinute: entry.count,
      windowAgeMs:     now - entry.windowStartedAt,
    });
  }
  return out.sort((a, b) => b.countLastMinute - a.countLastMinute);
}

/**
 * Record a retry signal without acquiring a lease. Used by callers
 * that retry outside the governor's lease lifecycle (e.g. broker-driven
 * retries) but still want the rate-tracking visibility.
 */
export function recordRetry(key: string): void {
  const now = Date.now();
  const winKey = `retry:${key}`;
  const cur = retryWindows.get(winKey);
  if (cur && now - cur.windowStartedAt < RETRY_WINDOW_MS) {
    cur.count += 1;
  } else {
    retryWindows.set(winKey, { count: 1, windowStartedAt: now });
  }
}

/** Test-only — clears every internal map. Do NOT call from production. */
export function _internalClearAll(): void {
  concurrency.clear();
  retryWindows.clear();
  burstBuckets.clear();
}
