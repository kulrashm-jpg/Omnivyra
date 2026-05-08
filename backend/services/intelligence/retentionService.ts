// Retention enforcement service.
//
// Enforces tenant-aware retention policies across history / provider history /
// audit log / evidence / scan history. Operators run `enforceRetention()`
// periodically (cron, scheduled job). Audit log entries that record actions
// performed BY a user are preserved per compliance — only purely operational
// audit rows (provider_call) are eligible for purge inside the audit window.

import type { TenantContext, TenantPolicy } from './tenantGovernance';
import { loadTenantPolicy } from './tenantGovernance';
import { logAuditEvent } from './auditLog';

export type RetentionRunResult = {
  tenant_id: string;
  cutoffs: {
    history: string;
    provider_history: string;
    audit: string;
  };
  purged: {
    report_score_history: number;
    report_pillar_history: number;
    report_provider_history: number;
    report_evidence_history: number;
    report_recommendation_history: number;
    report_benchmark_history: number;
    audit_log_provider_calls: number;
    scan_queue_completed: number;
  };
  duration_ms: number;
};

export interface PurgeAdapter {
  /** Returns count of rows that would be purged WITHOUT actually deleting (dry-run). */
  countOlderThan(table: string, columnName: string, cutoffIso: string, extraEqs?: Array<[string, unknown]>): Promise<number>;
  /** Permanently delete rows older than the cutoff. */
  deleteOlderThan(table: string, columnName: string, cutoffIso: string, extraEqs?: Array<[string, unknown]>): Promise<number>;
}

class NoopPurgeAdapter implements PurgeAdapter {
  async countOlderThan(): Promise<number> {
    return 0;
  }
  async deleteOlderThan(): Promise<number> {
    return 0;
  }
}

let activePurgeAdapter: PurgeAdapter = new NoopPurgeAdapter();

export function registerPurgeAdapter(adapter: PurgeAdapter): void {
  activePurgeAdapter = adapter;
}

function cutoffIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Enforce retention for a single tenant. Consumes the tenant's
 * TenantRetentionPolicy and purges across every retention-bound table.
 *
 * @param mode 'dry_run' returns counts without deleting; 'commit' deletes.
 */
export async function enforceRetention(params: {
  tenantContext: TenantContext;
  mode: 'dry_run' | 'commit';
}): Promise<RetentionRunResult> {
  const startedAt = Date.now();
  const policy: TenantPolicy = await loadTenantPolicy(params.tenantContext.tenant_id);

  const historyCutoff = cutoffIso(policy.retention.history_retention_days);
  const providerCutoff = cutoffIso(policy.retention.provider_history_retention_days);
  const auditCutoff = cutoffIso(policy.retention.audit_retention_days);

  const op = params.mode === 'commit' ? activePurgeAdapter.deleteOlderThan : activePurgeAdapter.countOlderThan;

  // Score / pillar / evidence / recommendation / benchmark histories all share
  // the score-history retention window. Provider history has its own (typically
  // shorter) window because it's high-volume noise.
  const tenantEq: Array<[string, unknown]> = [['tenant_id', params.tenantContext.tenant_id]];

  const purged = {
    report_score_history: await op('report_score_history', 'observed_at', historyCutoff, tenantEq),
    report_pillar_history: await op('report_pillar_history', 'observed_at', historyCutoff, []),
    report_provider_history: await op('report_provider_history', 'observed_at', providerCutoff, []),
    report_evidence_history: await op('report_evidence_history', 'observed_at', historyCutoff, []),
    report_recommendation_history: await op('report_recommendation_history', 'observed_at', historyCutoff, []),
    report_benchmark_history: await op('report_benchmark_history', 'observed_at', historyCutoff, []),
    // Only operational audit rows (provider_call) are eligible — user-action
    // audit rows persist for compliance regardless of retention window.
    audit_log_provider_calls: await op('audit_log', 'occurred_at', auditCutoff, [
      ['tenant_id', params.tenantContext.tenant_id],
      ['kind', 'provider_call'],
    ]),
    // Scan queue rows in terminal states (completed/cancelled/failed) older
    // than the audit window are purged — they're operational, not analytical.
    scan_queue_completed: await op('scan_queue', 'completed_at', auditCutoff, [
      ['tenant_id', params.tenantContext.tenant_id],
    ]),
  };

  const result: RetentionRunResult = {
    tenant_id: params.tenantContext.tenant_id,
    cutoffs: {
      history: historyCutoff,
      provider_history: providerCutoff,
      audit: auditCutoff,
    },
    purged,
    duration_ms: Date.now() - startedAt,
  };

  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: 'tenant_policy_change',
    payload: { kind: 'retention_enforcement', mode: params.mode, result },
  });

  return result;
}
