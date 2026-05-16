/**
 * Financial Integrity Audit Job — Phase F
 *
 * Composite job: runs the three integrity checks the audit prompt requires
 * and produces a single rolled-up report. Designed to be called from a
 * daily cron and from on-demand super-admin "are we okay?" inspections.
 *
 *   1. Wallet ↔ ledger reconciliation (delegates to creditReconciliation)
 *   2. Reservation state reconciliation (delegates to reservationReconciliationJob)
 *   3. Usage_events ↔ credit_transactions orphans (delegates to orphanUsageReconciliationJob)
 *   4. Approval workflow stale-pending (computed inline)
 *   5. Payment fulfillment stuck rows (computed inline)
 *
 * The report drives alerts (anomalies are emitted by the delegated jobs)
 * and powers the Financial Integrity Dashboard.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { reconcileAll, type ReconciliationSummary } from '../../creditReconciliation';
import { runReservationReconciliation, type ReservationReconciliationResult } from './reservationReconciliationJob';
import { runOrphanUsageReconciliation, type OrphanUsageResult } from './orphanUsageReconciliationJob';
import { emitAnomaly } from '../billingAuditEmitter';

export interface FinancialIntegrityReport {
  generatedAt:        string;
  walletReconciliation: ReconciliationSummary;
  reservationState:     ReservationReconciliationResult;
  orphanUsage:          OrphanUsageResult;
  stalePendingApprovals: number;
  stuckFulfillments:     number;
  overallStatus:         'healthy' | 'degraded' | 'critical';
}

export async function runFinancialIntegrityAudit(opts?: {
  reconcileLimit?:      number;
  usageWindowMinutes?:  number;
  reservationSlaMin?:   number;
}): Promise<FinancialIntegrityReport> {
  const [wallet, reservation, orphan] = await Promise.all([
    reconcileAll({ limit: opts?.reconcileLimit ?? 1000 }),
    runReservationReconciliation({ stuckSlaMinutes: opts?.reservationSlaMin }),
    runOrphanUsageReconciliation({ windowMinutes: opts?.usageWindowMinutes ?? 60 }),
  ]);

  // Stale pending approvals (older than 24h)
  const { data: stale } = await supabase
    .from('credit_action_approvals')
    .select('id')
    .eq('status', 'pending')
    .lt('proposed_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  const stalePendingApprovals = stale?.length ?? 0;

  // Stuck fulfillments — payment provider events recorded but never processed
  const { data: stuck } = await supabase
    .from('payment_provider_event_state')
    .select('provider_event_pk')
    .in('processing_status', ['recorded', 'requeued'])
    .lt('updated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());
  const stuckFulfillments = stuck?.length ?? 0;

  // Derive overall status
  const criticalSignals =
    wallet.orgsDrifted +
    reservation.bookKeepingMismatches +
    (orphan.orphanCount > 50 ? 1 : 0);

  const degradedSignals =
    reservation.expiredHoldsAwaitingReap +
    reservation.stuckOrchestratorCalls +
    stalePendingApprovals +
    stuckFulfillments +
    (orphan.orphanCount > 0 && orphan.orphanCount <= 50 ? 1 : 0);

  const overallStatus: FinancialIntegrityReport['overallStatus'] =
    criticalSignals > 0 ? 'critical' :
    degradedSignals > 0 ? 'degraded' :
                          'healthy';

  if (overallStatus !== 'healthy') {
    emitAnomaly({
      kind: 'reservation_orphan_reaped',
      severity: overallStatus === 'critical' ? 'critical' : 'warn',
      message: `financial_integrity_audit status=${overallStatus}`,
      metadata: {
        walletDrifted: wallet.orgsDrifted,
        reservationMismatch: reservation.bookKeepingMismatches,
        orphanUsage: orphan.orphanCount,
        stalePending: stalePendingApprovals,
        stuckFulfillments,
      },
    });
  }

  const report: FinancialIntegrityReport = {
    generatedAt:           new Date().toISOString(),
    walletReconciliation:  wallet,
    reservationState:      reservation,
    orphanUsage:           orphan,
    stalePendingApprovals,
    stuckFulfillments,
    overallStatus,
  };

  logger.info('financial_integrity_audit_completed', {
    status: report.overallStatus,
    orgs_drifted: wallet.orgsDrifted,
    reservation_mismatch: reservation.bookKeepingMismatches,
    orphan_usage: orphan.orphanCount,
  });

  return report;
}
