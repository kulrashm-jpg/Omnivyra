/**
 * Creator Reliability Cron Tick
 *
 * Single entry-point invoked by the global cron loop. Coordinates the
 * creator-workflow recurring jobs under one timer + telemetry context:
 *
 *   - storage janitor      (orphan + stale session cleanup)
 *   - queue drift sweep    (BullMQ ↔ DB reconciliation)
 *   - stuck-job recovery   (processing > 15 min)
 *   - integrity audit      (lifecycle/FSM/FK)
 *   - alert evaluator      (window + thresholds)
 *
 * Each sub-job runs under its own `creator_cron_lease` lease so different
 * cadences don't block each other. The tick itself is gated by an outer
 * lease keyed `creator_reliability_tick` so two parallel cron processes
 * never even attempt the sub-jobs concurrently.
 *
 * Configure cadence via env (defaults shown):
 *   - CREATOR_RELIABILITY_TICK_INTERVAL_MS = 15 min
 *   - CREATOR_JANITOR_INTERVAL_HOURS       = 6
 *   - CREATOR_INTEGRITY_AUDIT_HOURS        = 24
 *   - CREATOR_ALERT_INTERVAL_MINUTES       = 5
 *
 * KILL SWITCH:  set CREATOR_RELIABILITY_CRON_ENABLED=false to skip entirely.
 */

import { runCronJobWithLease } from '../services/creatorCronOrchestrationService';
import { runCreatorMediaStorageJanitor } from './creatorMediaStorageJanitorJob';
import {
  sweepQueueDrift,
  recoverStuckProcessingJobs,
} from '../services/creatorQueueReliabilityService';
import { runCreatorLifecycleIntegrityAudit } from '../services/creatorLifecycleIntegrityAuditService';
import { evaluateCreatorAlerts } from '../services/creatorAlertingService';
import { logger } from '../services/logger';
import { emitCreatorEvent, withTrace, newTraceId } from '../services/creatorOperationalTelemetryService';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

let lastJanitorRun = 0;
let lastIntegrityRun = 0;
let lastAlertRun = 0;
let lastDriftRun = 0;
let lastStuckRun = 0;

const JANITOR_INTERVAL_MS = parseInt(process.env.CREATOR_JANITOR_INTERVAL_HOURS ?? '6', 10) * HOUR;
const INTEGRITY_INTERVAL_MS = parseInt(process.env.CREATOR_INTEGRITY_AUDIT_HOURS ?? '24', 10) * HOUR;
const ALERT_INTERVAL_MS = parseInt(process.env.CREATOR_ALERT_INTERVAL_MINUTES ?? '5', 10) * MIN;
const DRIFT_INTERVAL_MS = 15 * MIN;
const STUCK_INTERVAL_MS = 10 * MIN;

export async function runCreatorReliabilityCronTick(): Promise<{
  ran: boolean;
  janitor?: unknown;
  integrity?: unknown;
  alerts?: unknown;
  drift?: unknown;
  stuck?: unknown;
}> {
  if (process.env.CREATOR_RELIABILITY_CRON_ENABLED === 'false') {
    return { ran: false };
  }

  // Outer lease: only one cron loop participates per tick window.
  return withTrace({ traceId: newTraceId(), source: 'cron' }, async () => {
    const result: any = { ran: true };
    const now = Date.now();

    if (now - lastJanitorRun >= JANITOR_INTERVAL_MS) {
      const r = await runCronJobWithLease({
        jobName: 'creator_storage_janitor',
        ttlMs: 4 * MIN,
        timeoutMs: 3 * MIN + 30_000,
        run: () => runCreatorMediaStorageJanitor({
          minAgeHours: 24,
          maxDeletes: 500,
          staleSessionHours: 72,
        }),
      });
      result.janitor = r;
      if (r.ran) lastJanitorRun = now;
    }

    if (now - lastDriftRun >= DRIFT_INTERVAL_MS) {
      const r = await runCronJobWithLease({
        jobName: 'creator_queue_drift_sweep',
        ttlMs: 2 * MIN,
        timeoutMs: 90_000,
        run: () => sweepQueueDrift({ maxScan: 1000 }),
      });
      result.drift = r;
      if (r.ran) lastDriftRun = now;
    }

    if (now - lastStuckRun >= STUCK_INTERVAL_MS) {
      const r = await runCronJobWithLease({
        jobName: 'creator_stuck_job_recovery',
        ttlMs: 2 * MIN,
        timeoutMs: 90_000,
        run: () => recoverStuckProcessingJobs({ staleMinutes: 15 }),
      });
      result.stuck = r;
      if (r.ran) lastStuckRun = now;
    }

    if (now - lastIntegrityRun >= INTEGRITY_INTERVAL_MS) {
      const r = await runCronJobWithLease({
        jobName: 'creator_integrity_audit',
        ttlMs: 6 * MIN,
        timeoutMs: 5 * MIN + 30_000,
        run: () => runCreatorLifecycleIntegrityAudit({ applyAutoHeal: true }),
      });
      result.integrity = r;
      if (r.ran) lastIntegrityRun = now;
    }

    if (now - lastAlertRun >= ALERT_INTERVAL_MS) {
      const r = await runCronJobWithLease({
        jobName: 'creator_alert_eval',
        ttlMs: 2 * MIN,
        timeoutMs: 90_000,
        run: () => evaluateCreatorAlerts({ window: '1h' }),
      });
      result.alerts = r;
      if (r.ran) lastAlertRun = now;
    }

    emitCreatorEvent({
      event: 'reliability_tick_completed',
      metadata: {
        ran_janitor: !!result.janitor,
        ran_integrity: !!result.integrity,
        ran_alerts: !!result.alerts,
        ran_drift: !!result.drift,
        ran_stuck: !!result.stuck,
      },
    });

    return result;
  });
}

/** TEST ONLY — reset internal timers. */
export function __resetCreatorReliabilityCronForTests(): void {
  lastJanitorRun = 0;
  lastIntegrityRun = 0;
  lastAlertRun = 0;
  lastDriftRun = 0;
  lastStuckRun = 0;
}
