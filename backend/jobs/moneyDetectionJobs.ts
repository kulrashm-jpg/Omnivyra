/**
 * MONEY detect-only jobs on the worker timer (2026-11-12, e9 ruling).
 *
 * These three existed as /api/cron routes with NO schedule anywhere (not in
 * vercel.json, not in backend/scheduler/cron.ts): they ran only when someone
 * opened a super-admin page. Each one READS and REPORTS (emitAnomaly / logs);
 * none writes a wallet, a hold or a ledger row:
 *
 *   creditReconciliation         reconcileAll                  ledger-vs-wallet drift report ("Read-only")
 *   billingReservationReconcile  runReservationReconciliation  stuck / expired holds -> anomalies
 *   billingOrphanUsageScan       runOrphanUsageReconciliation  usage with no ledger row -> anomalies
 *
 * Each run goes through runJob with the SAME job name and idempotency key as
 * its cron route, so a timer run and a manual route call in one period share
 * one audit lineage.
 *
 * NOT here on purpose: credit-orphan-hold-reap and monetization-reservation-
 * reconcile (they RELEASE and CONFIRM holds - i.e. move credits and charge
 * customers) and billing-idempotency-expire (finalizes stuck rows). Those need
 * a report-only first run and owner approval. billing-integrity-audit lands with
 * the Stripe event-state fix.
 *
 * Drift numbers from creditReconciliation are not to be read as truth until the
 * apply_credit_reservation double-count fix lands (open holds are counted twice).
 */
import { runJob } from '../services/jobRunner';
import { reconcileAll } from '../services/creditReconciliation';
import { runReservationReconciliation } from '../services/billing/jobs/reservationReconciliationJob';
import { runOrphanUsageReconciliation } from '../services/billing/jobs/orphanUsageReconciliationJob';

const HOUR_MS = 60 * 60 * 1000;

export type MoneyDetectionJobKey = 'creditReconciliation' | 'billingReservationReconcile' | 'billingOrphanUsageScan';

// idempotencyKey: byte-identical to the matching /api/cron route's key, so a
// timer run and a manual route call in the same period are ONE execution.
export const MONEY_DETECTION_JOBS: ReadonlyArray<{
  key: MoneyDetectionJobKey; intervalMs: number; jobName: string; idempotencyKey: (now: number) => string;
}> = [
  { key: 'creditReconciliation', intervalMs: 24 * HOUR_MS, jobName: 'cron:credit-reconciliation',
    idempotencyKey: (now) => `cron:credit-reconciliation:${new Date(now).toISOString().slice(0, 10)}` },
  { key: 'billingReservationReconcile', intervalMs: HOUR_MS, jobName: 'cron:billing-reservation-reconcile',
    idempotencyKey: (now) => `cron:billing-reservation-reconcile:${Math.floor(now / (15 * 60 * 1000))}` },
  { key: 'billingOrphanUsageScan', intervalMs: HOUR_MS, jobName: 'cron:billing-orphan-usage-scan',
    idempotencyKey: (now) => `cron:billing-orphan-usage-scan:${Math.floor(now / HOUR_MS)}` },
];

export async function runMoneyDetectionJob(key: MoneyDetectionJobKey): Promise<{ status: string }> {
  const job = MONEY_DETECTION_JOBS.find((j) => j.key === key);
  if (!job) throw new Error(`[moneyDetectionJobs] unknown job ${key}`);
  const run = key === 'creditReconciliation'
    ? () => reconcileAll()
    : key === 'billingReservationReconcile'
      ? () => runReservationReconciliation()
      : () => runOrphanUsageReconciliation({ windowMinutes: 60 });
  const outcome = await runJob(
    {
      jobName: job.jobName,
      triggerSource: 'scheduler',
      tenantId: null,
      principalKind: 'worker-timer',
      idempotencyKey: job.idempotencyKey(Date.now()),
    },
    run as () => Promise<unknown>,
  );
  return { status: outcome.status };
}
