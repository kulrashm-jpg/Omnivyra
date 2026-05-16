/**
 * Billing Consistency Verifier — Final activation phase
 *
 * Composite verification that the billing system is in a self-consistent
 * state. Called pre-rollout and post-rollout to gate progression to the
 * next staged step.
 *
 * Verifies (read-only):
 *   1. Ledger reconciliation drift (zero is healthy)
 *   2. Reservation state mismatches
 *   3. Orphan usage scan
 *   4. Stale pending approvals
 *   5. Stuck `billing_operations` rows
 *   6. Stuck payment provider events
 *   7. Integrity audit overall status
 *
 * Contract:
 *   Returns `BillingConsistencyReport` with:
 *     overallStatus: 'pass' | 'degraded' | 'fail'
 *     rollbackRequired: boolean (true on `fail`)
 *
 * The rollout coordinator gates progression on `overallStatus === 'pass'`
 * (or `!== 'fail'` for non-strict modes); rollback service triggers on
 * `rollbackRequired`.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { runFinancialIntegrityAudit, type FinancialIntegrityReport } from '../jobs/financialIntegrityAuditJob';

export type ConsistencyStatus = 'pass' | 'degraded' | 'fail';

export interface BillingConsistencySignal {
  name:    string;
  passed:  boolean;
  detail:  Record<string, unknown>;
  blocker: boolean;
}

export interface BillingConsistencyReport {
  generatedAt:      string;
  organizationId?:  string;
  overallStatus:    ConsistencyStatus;
  rollbackRequired: boolean;
  signals:          BillingConsistencySignal[];
  recommendation:   string;
  integrityReport:  FinancialIntegrityReport;
}

export interface VerifyOptions {
  organizationId?:        string;
  orphanUsageThreshold?:  number;
  reservationSlaMinutes?: number;
  approvalPendingHours?:  number;
}

export async function verifyBillingConsistency(opts: VerifyOptions = {}): Promise<BillingConsistencyReport> {
  const orphanThreshold = opts.orphanUsageThreshold ?? 5;
  const slaMin          = opts.reservationSlaMinutes ?? 30;
  const pendingHours    = opts.approvalPendingHours ?? 24;

  const integrityReport = await runFinancialIntegrityAudit({
    reservationSlaMin:  slaMin,
    usageWindowMinutes: 60,
  });

  const signals: BillingConsistencySignal[] = [];

  signals.push({
    name:    'wallet_ledger_drift_zero',
    passed:  integrityReport.walletReconciliation.orgsDrifted === 0,
    detail:  {
      orgsDrifted: integrityReport.walletReconciliation.orgsDrifted,
      orgsScanned: integrityReport.walletReconciliation.orgsScanned,
    },
    blocker: true,
  });

  signals.push({
    name:    'reservation_state_consistent',
    passed:  integrityReport.reservationState.bookKeepingMismatches === 0,
    detail:  {
      mismatched:      integrityReport.reservationState.bookKeepingMismatches,
      expiredAwaiting: integrityReport.reservationState.expiredHoldsAwaitingReap,
    },
    blocker: true,
  });

  signals.push({
    name:    'orphan_usage_below_threshold',
    passed:  integrityReport.orphanUsage.orphanCount <= orphanThreshold,
    detail:  {
      orphanCount:  integrityReport.orphanUsage.orphanCount,
      threshold:    orphanThreshold,
      estimatedUsd: integrityReport.orphanUsage.estimatedUntrackedUsd,
    },
    blocker: integrityReport.orphanUsage.orphanCount > orphanThreshold * 10,
  });

  // Stale pending approvals — optionally scoped to org
  let stalePendingQ = supabase
    .from('credit_action_approvals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('proposed_at', new Date(Date.now() - pendingHours * 3600_000).toISOString());
  if (opts.organizationId) stalePendingQ = stalePendingQ.eq('organization_id', opts.organizationId);
  const { count: stalePendingCount } = await stalePendingQ;
  signals.push({
    name:    'no_stale_pending_approvals',
    passed:  Number(stalePendingCount ?? 0) === 0,
    detail:  { stalePending: Number(stalePendingCount ?? 0), pendingHours },
    blocker: false,
  });

  // Stuck billing operations — optionally scoped to org
  let stuckOpsQ = supabase
    .from('billing_operations')
    .select('id', { count: 'exact', head: true })
    .in('status', ['initiated', 'held', 'executed'])
    .lt('started_at', new Date(Date.now() - slaMin * 60_000).toISOString());
  if (opts.organizationId) stuckOpsQ = stuckOpsQ.eq('organization_id', opts.organizationId);
  const { count: stuckOps } = await stuckOpsQ;
  signals.push({
    name:    'no_stuck_billing_operations',
    passed:  Number(stuckOps ?? 0) === 0,
    detail:  { stuck: Number(stuckOps ?? 0), slaMin },
    blocker: false,
  });

  const { count: stuckPaymentEvents } = await supabase
    .from('payment_provider_event_state')
    .select('provider_event_pk', { count: 'exact', head: true })
    .in('processing_status', ['recorded', 'requeued'])
    .lt('updated_at', new Date(Date.now() - 30 * 60_000).toISOString());
  signals.push({
    name:    'no_stuck_payment_events',
    passed:  Number(stuckPaymentEvents ?? 0) === 0,
    detail:  { stuck: Number(stuckPaymentEvents ?? 0) },
    blocker: false,
  });

  signals.push({
    name:    'integrity_audit_healthy',
    passed:  integrityReport.overallStatus === 'healthy',
    detail:  { status: integrityReport.overallStatus },
    blocker: integrityReport.overallStatus === 'critical',
  });

  const blockingFailures    = signals.filter(s => !s.passed && s.blocker);
  const nonBlockingFailures = signals.filter(s => !s.passed && !s.blocker);

  let overallStatus: ConsistencyStatus;
  if (blockingFailures.length > 0)      overallStatus = 'fail';
  else if (nonBlockingFailures.length > 0) overallStatus = 'degraded';
  else                                   overallStatus = 'pass';

  const rollbackRequired = overallStatus === 'fail';

  const recommendation =
    overallStatus === 'pass'     ? 'Safe to proceed with the next rollout step.' :
    overallStatus === 'degraded' ? `Proceed with caution — degraded signals: ${nonBlockingFailures.map(s => s.name).join(', ')}` :
                                   `Rollout BLOCKED — fix: ${blockingFailures.map(s => s.name).join(', ')}`;

  logger.info('billing_consistency_verification', {
    overall:       overallStatus,
    blockerFails:  blockingFailures.length,
    nonBlockerFails: nonBlockingFailures.length,
    totalSignals:  signals.length,
    rollbackRequired,
    org:           opts.organizationId ?? null,
  });

  return {
    generatedAt:      new Date().toISOString(),
    organizationId:   opts.organizationId,
    overallStatus,
    rollbackRequired,
    signals,
    recommendation,
    integrityReport,
  };
}
