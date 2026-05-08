/**
 * Runtime Pressure Monitor — read-only operator visibility into the
 * platform's current execution pressure. Aggregates:
 *
 *   - in-flight concurrency leases  (executionGovernor.snapshotConcurrency)
 *   - retry-rate per scope          (executionGovernor.snapshotRetryRates)
 *   - active scheduler locks        (scheduler_locks table)
 *   - recent DLQ pressure           (worker_dead_letter_queue rollup)
 *
 * Read-only. No mutations. Bounded queries.
 *
 * Severity heuristics:
 *   - any retry-rate ≥ 30/min for a single scope → `alert`
 *   - any concurrency lease > 50 in-use for a single key → `alert`
 *   - DLQ rate ≥ 50 entries in window → `alert`
 *   - any non-zero pressure → at least `warn`
 *   - none of the above → `ok`
 *
 * The monitor classifies severity, but does NOT page anyone — the
 * monitor surface is the operator dashboard, not the alert layer.
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';
import {
  snapshotConcurrency,
  snapshotRetryRates,
  type ConcurrencySnapshot,
  type RetryRateSnapshot,
} from './executionGovernor';
import { summarizeDeadLetters } from './jobInspection';

export type PressureSeverity = 'ok' | 'warn' | 'alert';

export interface SchedulerLockSnapshot {
  jobName: string;
  lockedAt: string;
  ageMs: number;
  /** True when the lock has exceeded the standard 30-min stale threshold. */
  stale: boolean;
}

export interface RuntimePressureReport {
  generatedAt: string;
  /** Worst severity across every dimension. */
  overall: PressureSeverity;
  concurrency: {
    severity: PressureSeverity;
    /** Top N concurrency keys ordered by in-use count, descending. */
    topKeys: ReadonlyArray<ConcurrencySnapshot>;
    totalKeys: number;
    totalInUse: number;
    /** Number of distinct tenants with at least one in-flight lease.
     *  Computed from keys matching `tenant:<orgId>:...`. */
    distinctTenantsInUse: number;
    /** Highest single-tenant in-flight count (saturation hot-spot). */
    maxTenantInUse: number;
    /** The `tenant:<orgId>` prefix matching maxTenantInUse, if resolvable. */
    maxTenantKey: string | null;
    /** Crude global-capacity indicator: totalInUse aggregated across all
     *  keys. NOT a percentage — there is no canonical pool size. Use as
     *  a relative trend. */
    globalInUse: number;
  };
  retryRates: {
    severity: PressureSeverity;
    /** Top N retry scopes ordered by counts in the last minute. */
    topScopes: ReadonlyArray<RetryRateSnapshot>;
    totalScopes: number;
  };
  schedulerLocks: {
    severity: PressureSeverity;
    /** Active locks, sorted oldest-first so stale locks surface at the top. */
    active: ReadonlyArray<SchedulerLockSnapshot>;
    staleCount: number;
  };
  dlqPressure: {
    severity: PressureSeverity;
    windowHours: number;
    totalEntries: number;
    byWorker: ReadonlyArray<{ workerName: string; count: number }>;
  };
}

const STALE_LOCK_MS = 30 * 60 * 1000;
const ALERT_RETRY_RATE_PER_MINUTE = 30;
const WARN_RETRY_RATE_PER_MINUTE  = 5;
const ALERT_CONCURRENCY_INUSE     = 50;
const WARN_CONCURRENCY_INUSE      = 10;
const DLQ_WINDOW_HOURS_DEFAULT    = 1;
const ALERT_DLQ_PER_WINDOW        = 50;
const WARN_DLQ_PER_WINDOW         = 5;

interface SchedulerLockRow {
  job_name: string;
  locked_at: string;
}

function severityForCount(count: number, alertAt: number, warnAt: number): PressureSeverity {
  if (count >= alertAt) return 'alert';
  if (count >= warnAt)  return 'warn';
  return count > 0 ? 'warn' : 'ok';
}

function combine(...severities: PressureSeverity[]): PressureSeverity {
  if (severities.includes('alert')) return 'alert';
  if (severities.includes('warn'))  return 'warn';
  return 'ok';
}

async function fetchSchedulerLocks(): Promise<SchedulerLockSnapshot[]> {
  const { data, error } = await ownedDbTable('scheduler_locks')
    .select('job_name, locked_at')
    .order('locked_at', { ascending: true });
  if (error) {
    logger.warn('runtime_pressure_scheduler_locks_query_failed', { message: error.message });
    return [];
  }
  const now = Date.now();
  return ((data ?? []) as SchedulerLockRow[]).map((r) => {
    const lockedAtMs = Date.parse(r.locked_at);
    const ageMs = Number.isFinite(lockedAtMs) ? now - lockedAtMs : 0;
    return {
      jobName:  r.job_name,
      lockedAt: r.locked_at,
      ageMs,
      stale:    ageMs > STALE_LOCK_MS,
    };
  });
}

export async function reportRuntimePressure(input?: {
  /** Top-N caps for the concurrency / retry-rate snapshots. Default: 25 each. */
  topN?: number;
  /** DLQ window in hours. Default: 1. */
  dlqWindowHours?: number;
}): Promise<RuntimePressureReport> {
  const topN = Math.min(Math.max(input?.topN ?? 25, 1), 200);
  const dlqWindowHours = input?.dlqWindowHours ?? DLQ_WINDOW_HOURS_DEFAULT;
  const dlqSince = new Date(Date.now() - dlqWindowHours * 3_600_000).toISOString();

  // ── Concurrency snapshot ──────────────────────────────────────────────────
  const allConcurrency = snapshotConcurrency();
  const totalInUse = allConcurrency.reduce((sum, e) => sum + e.inUse, 0);
  const topConcurrency = allConcurrency.slice(0, topN);
  const maxInUse = allConcurrency[0]?.inUse ?? 0;
  const concurrencySeverity = severityForCount(maxInUse, ALERT_CONCURRENCY_INUSE, WARN_CONCURRENCY_INUSE);

  // Tenant-distribution stats — extract `tenant:<orgId>` from keys.
  // Aggregating per-tenant tells operators "is one tenant saturating?"
  // vs "is the platform broadly busy?" — different remediation.
  const tenantInUse = new Map<string, number>();
  for (const entry of allConcurrency) {
    const m = /^tenant:([^:]+)/.exec(entry.key);
    if (!m) continue;
    const tenantPrefix = `tenant:${m[1]}`;
    tenantInUse.set(tenantPrefix, (tenantInUse.get(tenantPrefix) ?? 0) + entry.inUse);
  }
  let maxTenantInUse = 0;
  let maxTenantKey: string | null = null;
  for (const [k, v] of tenantInUse.entries()) {
    if (v > maxTenantInUse) {
      maxTenantInUse = v;
      maxTenantKey = k;
    }
  }

  // ── Retry-rate snapshot ───────────────────────────────────────────────────
  const allRetryRates = snapshotRetryRates();
  const topRetries = allRetryRates.slice(0, topN);
  const maxRetryRate = allRetryRates[0]?.countLastMinute ?? 0;
  const retrySeverity = severityForCount(maxRetryRate, ALERT_RETRY_RATE_PER_MINUTE, WARN_RETRY_RATE_PER_MINUTE);

  // ── Scheduler locks ───────────────────────────────────────────────────────
  const locks = await fetchSchedulerLocks();
  const staleCount = locks.filter((l) => l.stale).length;
  const schedulerSeverity: PressureSeverity = staleCount > 0
    ? 'alert'
    : locks.length > 0
      ? 'warn'
      : 'ok';

  // ── DLQ pressure (window) ─────────────────────────────────────────────────
  const dlqByWorker = await summarizeDeadLetters({ since: dlqSince }).catch((err) => {
    logger.warn('runtime_pressure_dlq_summary_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return [] as Awaited<ReturnType<typeof summarizeDeadLetters>>;
  });
  const dlqTotal = dlqByWorker.reduce((sum, e) => sum + e.count, 0);
  const dlqSeverity = severityForCount(dlqTotal, ALERT_DLQ_PER_WINDOW, WARN_DLQ_PER_WINDOW);

  return {
    generatedAt: new Date().toISOString(),
    overall: combine(concurrencySeverity, retrySeverity, schedulerSeverity, dlqSeverity),
    concurrency: {
      severity:             concurrencySeverity,
      topKeys:              topConcurrency,
      totalKeys:            allConcurrency.length,
      totalInUse,
      distinctTenantsInUse: tenantInUse.size,
      maxTenantInUse,
      maxTenantKey,
      globalInUse:          totalInUse,
    },
    retryRates: {
      severity:    retrySeverity,
      topScopes:   topRetries,
      totalScopes: allRetryRates.length,
    },
    schedulerLocks: {
      severity:   schedulerSeverity,
      active:     locks,
      staleCount,
    },
    dlqPressure: {
      severity:     dlqSeverity,
      windowHours:  dlqWindowHours,
      totalEntries: dlqTotal,
      byWorker:     dlqByWorker.slice(0, topN),
    },
  };
}
