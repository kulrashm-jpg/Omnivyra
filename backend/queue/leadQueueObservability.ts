/**
 * Phase 1 — Lead queue observability extensions.
 *
 * Extends the Phase 0 hardening primitives (leadQueueHardening.ts) with
 * structured operational diagnostics:
 *   • Failure categorisation       — group errors by transient/permanent class
 *   • Idempotency-collision counter — duplicate enqueues blocked by jobId
 *   • DLQ readiness snapshot       — counts in DLQ + last-failure metadata
 *   • Enriched health snapshot     — engine-jobs counts + LEAD breakdown
 *
 * All observability writes go through lightweight in-process counters; the
 * Phase-2 ops console can read them via getLeadQueueObservabilitySnapshot()
 * without any new transport or telemetry pipeline.
 */

import { getLeadDeadLetterQueue } from './leadQueueHardening';
import { jobQueue } from './jobQueue';

export const FAILURE_CATEGORIES = [
  'TRANSIENT_NETWORK',
  'TRANSIENT_RATE_LIMIT',
  'AUTH_EXPIRED',
  'INVALID_INPUT',
  'UPSTREAM_DOWN',
  'TIMEOUT',
  'UNKNOWN',
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/**
 * Deterministic categorisation from a failure reason. Pattern matching is
 * intentionally narrow — false positives would mislead the operator. New
 * categories should be added as new patterns are observed, not by
 * loosening existing matchers.
 */
export function categoriseFailureReason(reason: string | null | undefined): FailureCategory {
  if (!reason) return 'UNKNOWN';
  const r = reason.toLowerCase();

  if (/(econnreset|enotfound|etimedout|socket hang up|network)/.test(r)) {
    return 'TRANSIENT_NETWORK';
  }
  if (/(429|rate limit|rate_limit|too many requests|throttl)/.test(r)) {
    return 'TRANSIENT_RATE_LIMIT';
  }
  if (/(401|403|unauthor|forbidden|expired|invalid_grant|token)/.test(r)) {
    return 'AUTH_EXPIRED';
  }
  if (/(400|invalid|bad request|missing|required)/.test(r)) {
    return 'INVALID_INPUT';
  }
  if (/(502|503|504|upstream|gateway|unavailable)/.test(r)) {
    return 'UPSTREAM_DOWN';
  }
  if (/(timeout|deadline|abort)/.test(r)) {
    return 'TIMEOUT';
  }
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// In-process counters
// ---------------------------------------------------------------------------

type FailureCounter = Record<FailureCategory, number>;

const initialFailureCounter: FailureCounter = {
  TRANSIENT_NETWORK: 0,
  TRANSIENT_RATE_LIMIT: 0,
  AUTH_EXPIRED: 0,
  INVALID_INPUT: 0,
  UPSTREAM_DOWN: 0,
  TIMEOUT: 0,
  UNKNOWN: 0,
};

let failureCounts: FailureCounter = { ...initialFailureCounter };
let idempotencyCollisions = 0;
let lastFailureAt: string | null = null;
let lastFailureCategory: FailureCategory | null = null;
let lastFailureJobId: string | null = null;
let enqueueCount = 0;
let enqueueTotalMs = 0;
let enqueueMaxMs = 0;

/**
 * Record a LEAD job failure. Called from the worker's `failed` handler in
 * startWorkers.ts. Increments the matching category counter, updates the
 * last-failure trio, and returns the categorisation so the caller can use
 * it for structured logging without re-pattern-matching.
 */
export function recordLeadJobFailure(args: {
  jobId: string;
  reason: string | null;
}): { category: FailureCategory } {
  const category = categoriseFailureReason(args.reason);
  failureCounts[category] += 1;
  lastFailureAt = new Date().toISOString();
  lastFailureCategory = category;
  lastFailureJobId = args.jobId;
  return { category };
}

/**
 * Record an idempotency-key collision (BullMQ dedup blocked a duplicate
 * enqueue). Enqueue paths should call this when add() returns an existing
 * job. Useful for spotting retry loops on the producer side.
 */
export function recordIdempotencyCollision(): void {
  idempotencyCollisions += 1;
}

export function recordLeadQueueEnqueue(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const rounded = Math.round(durationMs);
  enqueueCount += 1;
  enqueueTotalMs += rounded;
  enqueueMaxMs = Math.max(enqueueMaxMs, rounded);
}

/**
 * Reset counters. Use sparingly — primarily for tests; counters are
 * monotonically increasing in production.
 */
export function resetLeadQueueObservabilityCounters(): void {
  failureCounts = { ...initialFailureCounter };
  idempotencyCollisions = 0;
  lastFailureAt = null;
  lastFailureCategory = null;
  lastFailureJobId = null;
  enqueueCount = 0;
  enqueueTotalMs = 0;
  enqueueMaxMs = 0;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export type LeadQueueObservabilitySnapshot = {
  generated_at: string;
  engine_jobs: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  dead_letter: {
    waiting: number;
    failed: number;
  };
  failure_categorization: FailureCounter;
  idempotency_collisions: number;
  enqueue_metrics: {
    count: number;
    avg_ms: number;
    max_ms: number;
  };
  last_failure: {
    job_id: string | null;
    category: FailureCategory | null;
    at: string | null;
  };
};

/**
 * Composite snapshot. One round-trip to Redis for each of the two queues
 * involved; everything else is in-process counters. Safe to call from
 * dashboards on a 30-60s cadence.
 */
export async function getLeadQueueObservabilitySnapshot(): Promise<LeadQueueObservabilitySnapshot> {
  const [engineCounts, dlqCounts] = await Promise.all([
    jobQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    getLeadDeadLetterQueue().getJobCounts('waiting', 'failed'),
  ]);

  return {
    generated_at: new Date().toISOString(),
    engine_jobs: {
      waiting: engineCounts.waiting ?? 0,
      active: engineCounts.active ?? 0,
      completed: engineCounts.completed ?? 0,
      failed: engineCounts.failed ?? 0,
      delayed: engineCounts.delayed ?? 0,
    },
    dead_letter: {
      waiting: dlqCounts.waiting ?? 0,
      failed: dlqCounts.failed ?? 0,
    },
    failure_categorization: { ...failureCounts },
    idempotency_collisions: idempotencyCollisions,
    enqueue_metrics: {
      count: enqueueCount,
      avg_ms: enqueueCount > 0 ? Math.round(enqueueTotalMs / enqueueCount) : 0,
      max_ms: enqueueMaxMs,
    },
    last_failure: {
      job_id: lastFailureJobId,
      category: lastFailureCategory,
      at: lastFailureAt,
    },
  };
}
