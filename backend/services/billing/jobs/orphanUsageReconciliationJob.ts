/**
 * Orphan Usage Reconciliation Job — Phase C / F
 *
 * Bridges the gap audit risk G-1: `usage_events` rows (aiGateway cost
 * telemetry) that have no matching CONFIRM row in `credit_transactions`.
 *
 * Each orphan is a "real LLM spend with no credit charge". This job
 * scans recent windows and reports — it does NOT auto-charge (that
 * would be a destructive remediation). Instead it produces an alertable
 * signal that a billing leak exists.
 *
 * The signal feeds the AI Billing Dashboard and the financial-integrity
 * audit job.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { emitAnomaly } from '../billingAuditEmitter';
import { incrCounter } from '../billingMetrics';

export interface OrphanUsageResult {
  scanned:              number;
  orphanCount:          number;
  estimatedUntrackedUsd: number;
  byOrgTop10:           Array<{ organizationId: string; orphanCount: number; estimatedUsd: number }>;
  byOperationTop10:     Array<{ operation: string; orphanCount: number }>;
}

export async function runOrphanUsageReconciliation(opts?: {
  windowMinutes?: number;
  limit?:         number;
}): Promise<OrphanUsageResult> {
  const minutes = opts?.windowMinutes ?? 60;
  const limit   = opts?.limit         ?? 1000;
  const sinceIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  // Verify usage_events table exists in this environment
  const { data: probe, error: probeErr } = await supabase
    .from('usage_events')
    .select('id')
    .limit(1);
  if (probeErr && /relation .* does not exist/i.test(probeErr.message)) {
    logger.warn('usage_events_table_missing', { message: probeErr.message });
    return { scanned: 0, orphanCount: 0, estimatedUntrackedUsd: 0, byOrgTop10: [], byOperationTop10: [] };
  }
  void probe;

  const { data: rows, error } = await supabase
    .from('usage_events')
    .select('id, organization_id, operation, cost_usd, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('orphan_usage_query_failed', { message: error.message });
    return { scanned: 0, orphanCount: 0, estimatedUntrackedUsd: 0, byOrgTop10: [], byOperationTop10: [] };
  }
  const events = (rows ?? []) as Array<{ id: string; organization_id: string; operation: string; cost_usd: number | null; created_at: string }>;

  // For each event, check whether a credit_transactions CONFIRM exists in a small window
  // around the event (±5 min) for the same org. This is an O(N) scan; for high-volume
  // orgs the next iteration should switch to a window-bucketed join SQL query.
  const orphans: typeof events = [];
  for (const e of events) {
    const lo = new Date(Date.parse(e.created_at) - 5 * 60 * 1000).toISOString();
    const hi = new Date(Date.parse(e.created_at) + 5 * 60 * 1000).toISOString();
    const { data: match } = await supabase
      .from('credit_transactions')
      .select('id')
      .eq('organization_id', e.organization_id)
      .eq('execution_phase', 'confirm')
      .gte('created_at', lo)
      .lte('created_at', hi)
      .limit(1);
    if (!match || match.length === 0) orphans.push(e);
  }

  // Aggregations
  const byOrg = new Map<string, { orphanCount: number; estimatedUsd: number }>();
  const byOp  = new Map<string, number>();
  let totalUsd = 0;
  for (const o of orphans) {
    const usd = Number(o.cost_usd ?? 0);
    totalUsd += usd;
    const ob = byOrg.get(o.organization_id) ?? { orphanCount: 0, estimatedUsd: 0 };
    ob.orphanCount += 1;
    ob.estimatedUsd += usd;
    byOrg.set(o.organization_id, ob);
    byOp.set(o.operation, (byOp.get(o.operation) ?? 0) + 1);
  }
  const byOrgTop10 = Array.from(byOrg.entries())
    .map(([organizationId, v]) => ({ organizationId, ...v }))
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd)
    .slice(0, 10);
  const byOperationTop10 = Array.from(byOp.entries())
    .map(([operation, orphanCount]) => ({ operation, orphanCount }))
    .sort((a, b) => b.orphanCount - a.orphanCount)
    .slice(0, 10);

  if (orphans.length > 0) {
    incrCounter('untracked_ai_call_blocked_total', orphans.length);
    emitAnomaly({
      kind: 'untracked_ai_call_blocked',
      severity: orphans.length > 50 ? 'critical' : 'warn',
      message: `usage_events orphans (no matching credit CONFIRM in ±5min): ${orphans.length}, estUsd=${totalUsd.toFixed(4)}`,
      metadata: { window_minutes: minutes, byOrgTop10, byOperationTop10 },
    });
  }

  return {
    scanned:               events.length,
    orphanCount:           orphans.length,
    estimatedUntrackedUsd: totalUsd,
    byOrgTop10,
    byOperationTop10,
  };
}
