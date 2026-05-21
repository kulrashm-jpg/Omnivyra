/**
 * Scheduled settlement-expiry sweep job (INTERNAL / CRON-ONLY).
 *
 * The cron-runtime wrapper around settlementExpirySweeper. It is invoked ONLY
 * from the internal cron scheduler (backend/scheduler/cron.ts) — there is NO
 * HTTP surface and NO unauthenticated trigger.
 *
 * EXECUTION LOCKING (distributed): the job acquires the `settlement_expiry_sweep`
 * lease from settlementRuntimeLock — a cross-process / cross-container /
 * cross-worker DB lock. An overlapping run (another instance, or a slow sweep
 * overrunning the next tick) fails to acquire and returns `ran:false`. The
 * lease is released in `finally`; a crashed holder's lease expires (stale-lock
 * recovery). Duplicate expiry transitions are independently prevented by the
 * deterministic expiry event id colliding on the append-only
 * billing_settlement_events ledger.
 *
 * Records persistent internal lifecycle metrics (candidates / expired /
 * duplicate suppressions). PRICING-BLIND — no amount is read or reported.
 * Never throws.
 */

import { logger } from '../services/logger';
import {
  sweepStaleSettlements,
  type ExpiryPolicy,
  type ExpirySweeperDeps,
} from '../services/billing/payments/settlementExpirySweeper';
import {
  acquireSettlementLock,
  releaseSettlementLock,
} from '../services/billing/payments/settlementRuntimeLock';
import { incrementSettlementMetric } from '../services/billing/payments/settlementMetrics';

/** The distributed lock key for the expiry sweep. */
export const SETTLEMENT_SWEEP_LOCK_KEY = 'settlement_expiry_sweep';
/** Lease TTL — bounds the hold so a crashed run is reclaimable. */
const SWEEP_LOCK_TTL_MS = 15 * 60 * 1000;

export interface SettlementExpirySweepReport {
  /** false → the distributed lock was held elsewhere; this run was a no-op. */
  ran: boolean;
  candidates: number;
  expired: number;
  duplicateSuppressed: number;
  skipped: number;
  durationMs: number;
}

const SKIPPED_LOCKED: SettlementExpirySweepReport = {
  ran: false, candidates: 0, expired: 0, duplicateSuppressed: 0, skipped: 0, durationMs: 0,
};

/** Runtime collaborators — injectable so the job is unit-testable without a DB. */
export interface SweepJobRuntimeDeps {
  acquireLock: typeof acquireSettlementLock;
  releaseLock: typeof releaseSettlementLock;
  recordMetric: typeof incrementSettlementMetric;
}

const DEFAULT_RUNTIME: SweepJobRuntimeDeps = {
  acquireLock: acquireSettlementLock,
  releaseLock: releaseSettlementLock,
  recordMetric: incrementSettlementMetric,
};

/**
 * Run one scheduled expiry sweep under the distributed lock. Safe to call on
 * every cron tick and from multiple instances — only the lock holder sweeps.
 */
export async function runSettlementExpirySweepJob(
  args?: { policy?: Partial<ExpiryPolicy>; nowMs?: number },
  sweeperDeps?: Partial<ExpirySweeperDeps>,
  runtimeOverride?: Partial<SweepJobRuntimeDeps>,
): Promise<SettlementExpirySweepReport> {
  const rt: SweepJobRuntimeDeps = { ...DEFAULT_RUNTIME, ...runtimeOverride };

  const lock = await rt.acquireLock(SETTLEMENT_SWEEP_LOCK_KEY, { ttlMs: SWEEP_LOCK_TTL_MS });
  if (!lock.acquired) {
    logger.info('settlement_expiry_sweep_skipped_locked', {});
    return SKIPPED_LOCKED;
  }

  const startedAt = Date.now();
  try {
    const result = await sweepStaleSettlements(args, sweeperDeps);
    // Persistent operational metrics — append-only, best-effort.
    await rt.recordMetric('candidates_scanned', result.candidates);
    await rt.recordMetric('sessions_expired', result.expired);
    await rt.recordMetric('duplicate_expiry_suppressions', result.duplicateSuppressed);
    const report: SettlementExpirySweepReport = {
      ran: true,
      candidates: result.candidates,
      expired: result.expired,
      duplicateSuppressed: result.duplicateSuppressed,
      skipped: result.skipped,
      durationMs: Date.now() - startedAt,
    };
    logger.info('settlement_expiry_sweep_complete', {
      candidates: report.candidates, expired: report.expired,
      duplicateSuppressed: report.duplicateSuppressed, durationMs: report.durationMs,
    });
    return report;
  } catch (err) {
    // Defensive — the sweeper itself never throws, but a job must not crash
    // the cron cycle.
    logger.warn('settlement_expiry_sweep_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { ran: true, candidates: 0, expired: 0, duplicateSuppressed: 0, skipped: 0, durationMs: Date.now() - startedAt };
  } finally {
    // Release the lease so the next tick can acquire promptly.
    await rt.releaseLock(SETTLEMENT_SWEEP_LOCK_KEY, lock.ownerToken);
  }
}
