/**
 * Reservation Reconciliation Job — Phase C / F
 *
 * Sister to the existing `creditOrphanHoldReaper`. The reaper releases
 * HOLDs that crashed. THIS job validates the reservation state itself:
 *
 *   - HOLDs whose `expires_at` is in the past but the reaper has not yet
 *     released them (signal: cron lag).
 *   - HOLDs whose `billing_operations.status` is 'confirmed' but the ledger
 *     has no CONFIRM row (signal: book-keeping drift).
 *   - billing_operations stuck in 'initiated' / 'held' beyond an SLA
 *     window (signal: orphaned orchestrator call).
 *
 * Output is structured for the Billing Drift Dashboard and emits anomalies
 * for ops paging. Does NOT mutate the ledger — strictly observe + report.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { emitAnomaly } from '../billingAuditEmitter';
import { incrCounter } from '../billingMetrics';

export interface ReservationReconciliationResult {
  scanned:                  number;
  expiredHoldsAwaitingReap: number;
  bookKeepingMismatches:    number;
  stuckOrchestratorCalls:   number;
  details: {
    expiredHoldIds:        string[];
    mismatchedOpIds:       string[];
    stuckOpIds:            string[];
  };
}

export async function runReservationReconciliation(opts?: {
  stuckSlaMinutes?: number;
  scanLimit?:       number;
}): Promise<ReservationReconciliationResult> {
  const slaMin   = opts?.stuckSlaMinutes ?? 30;
  const scanLim  = opts?.scanLimit       ?? 500;

  // 1. Expired HOLDs not yet released.
  const { data: expiredHolds } = await supabase
    .from('credit_transactions')
    .select('id, organization_id, idempotency_key, expires_at')
    .eq('execution_phase', 'hold')
    .lt('expires_at', new Date().toISOString())
    .limit(scanLim);
  const expiredIds: string[] = [];
  for (const h of (expiredHolds ?? []) as Array<{ id: string; organization_id: string; idempotency_key: string }>) {
    // Check for sibling CONFIRM/RELEASE
    const { data: sibling } = await supabase
      .from('credit_transactions')
      .select('id, execution_phase')
      .eq('parent_transaction_id', h.id)
      .in('execution_phase', ['confirm', 'release'])
      .limit(1);
    if (!sibling || sibling.length === 0) {
      expiredIds.push(h.id);
    }
  }

  // 2. billing_operations claiming confirmed but no matching CONFIRM ledger row.
  const { data: confirmedOps } = await supabase
    .from('billing_operations')
    .select('id, organization_id, idempotency_key, confirm_txn_id')
    .eq('status', 'confirmed')
    .gte('completed_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .limit(scanLim);
  const mismatchedOpIds: string[] = [];
  for (const op of (confirmedOps ?? []) as Array<{ id: string; idempotency_key: string; confirm_txn_id: string | null }>) {
    if (!op.confirm_txn_id) {
      // Check ledger for a CONFIRM with the orchestrator's confirm key
      const confirmKey = `${op.idempotency_key}:confirm`;
      const { data: txn } = await supabase
        .from('credit_transactions')
        .select('id')
        .eq('idempotency_key', confirmKey)
        .maybeSingle();
      if (!txn) mismatchedOpIds.push(op.id);
    }
  }

  // 3. Orchestrator calls stuck in 'initiated' / 'held' beyond SLA.
  const stuckCutoff = new Date(Date.now() - slaMin * 60 * 1000).toISOString();
  const { data: stuckOps } = await supabase
    .from('billing_operations')
    .select('id, organization_id, module, action, started_at, status')
    .in('status', ['initiated', 'held', 'executed'])
    .lt('started_at', stuckCutoff)
    .limit(scanLim);
  const stuckOpIds = ((stuckOps ?? []) as Array<{ id: string }>).map(r => r.id);

  // 4. Emit anomalies + counters
  if (expiredIds.length > 0) {
    incrCounter('reservation_expiry_total', expiredIds.length);
    emitAnomaly({
      kind: 'reservation_orphan_reaped',
      severity: 'warn',
      message: `expired HOLDs awaiting reaper: ${expiredIds.length}`,
      metadata: { sample: expiredIds.slice(0, 5) },
    });
  }
  if (mismatchedOpIds.length > 0) {
    incrCounter('reconciliation_failures_total', mismatchedOpIds.length);
    emitAnomaly({
      kind: 'reservation_orphan_reaped',
      severity: 'critical',
      message: `billing_operations confirmed without ledger CONFIRM: ${mismatchedOpIds.length}`,
      metadata: { sample: mismatchedOpIds.slice(0, 5) },
    });
  }
  if (stuckOpIds.length > 0) {
    emitAnomaly({
      kind: 'reservation_orphan_reaped',
      severity: 'warn',
      message: `stuck orchestrator calls: ${stuckOpIds.length}`,
      metadata: { sla_minutes: slaMin, sample: stuckOpIds.slice(0, 5) },
    });
  }

  const scanned = (expiredHolds?.length ?? 0) + (confirmedOps?.length ?? 0) + (stuckOps?.length ?? 0);
  logger.info('reservation_reconciliation_completed', {
    scanned, expired: expiredIds.length, mismatched: mismatchedOpIds.length, stuck: stuckOpIds.length,
  });

  return {
    scanned,
    expiredHoldsAwaitingReap: expiredIds.length,
    bookKeepingMismatches:    mismatchedOpIds.length,
    stuckOrchestratorCalls:   stuckOpIds.length,
    details: {
      expiredHoldIds:  expiredIds,
      mismatchedOpIds,
      stuckOpIds,
    },
  };
}
