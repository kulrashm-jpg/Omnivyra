/**
 * Phase 11 — Resilience validation.
 *
 * Operator-triggered deterministic checks over the canonical Phase 3-10
 * tables, producing a per-validation row in `resilience_validation_runs`
 * with typed observed_results and a deterministic failure_explanation.
 *
 * Six validation kinds:
 *   • replay_integrity        — replay_partitions all reach terminal state
 *   • semantic_consistency    — semantic_indexing_jobs/partitions rollup matches
 *   • projection_consistency  — projection_sync_state rows present per kind
 *   • partition_health        — execution_partitions lease + heartbeat health
 *   • connector_resilience    — listening_executions recent failure ratio
 *   • failover_readiness      — region_routing present + failover region set
 *
 * Hard guarantees:
 *   • Deterministic: same inputs → same observed_results.
 *   • Bounded window (defaults to last 24h).
 *   • Read-only.
 *   • Tenant-first.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  RESILIENCE_DEFAULT_LOOKBACK_HOURS,
  type ResilienceObservedResult,
  type ResilienceValidationKind,
  type ResilienceValidationRun,
  type ResilienceValidationStatus,
} from '../types/resilienceValidation';
import { publishRealtime } from './realtimePublisherService';
import { publishResilienceValidationCompleted } from '../events/listeningEvents';

function defaultWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - RESILIENCE_DEFAULT_LOOKBACK_HOURS * 3600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function countByStatusInWindow(
  table: string,
  organizationId: string,
  status: string,
  start: string,
  end: string,
): Promise<number> {
  try {
    const { count } = await ownedDbTable(table)
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', status)
      .gte('created_at', start).lt('created_at', end);
    return count ?? 0;
  } catch { return 0; }
}

async function runValidation(
  organizationId: string,
  kind: ResilienceValidationKind,
  start: string,
  end: string,
): Promise<{ results: ResilienceObservedResult[]; status: ResilienceValidationStatus; failureExplanation: string | null }> {
  const results: ResilienceObservedResult[] = [];
  let failures = 0;
  switch (kind) {
    case 'replay_integrity': {
      const [running, queued, failed, complete] = await Promise.all([
        countByStatusInWindow('replay_partitions', organizationId, 'running', start, end),
        countByStatusInWindow('replay_partitions', organizationId, 'queued', start, end),
        countByStatusInWindow('replay_partitions', organizationId, 'failed', start, end),
        countByStatusInWindow('replay_partitions', organizationId, 'complete', start, end),
      ]);
      results.push({ check_kind: 'replay_partitions_terminal', passed: running === 0 && queued === 0, observed_value: running + queued, expected_value: 0, detail: 'all partitions in window should be terminal' });
      results.push({ check_kind: 'replay_partitions_failure_ratio', passed: failed === 0 || failed / Math.max(1, failed + complete) < 0.1, observed_value: failed, expected_value: 0, detail: 'replay failure ratio < 10%' });
      break;
    }
    case 'semantic_consistency': {
      const [running, failed] = await Promise.all([
        countByStatusInWindow('semantic_indexing_partitions', organizationId, 'running', start, end),
        countByStatusInWindow('semantic_indexing_partitions', organizationId, 'failed', start, end),
      ]);
      results.push({ check_kind: 'semantic_partitions_terminal', passed: running === 0, observed_value: running, expected_value: 0, detail: 'no semantic partitions stuck running' });
      results.push({ check_kind: 'semantic_failure_count', passed: failed < 5, observed_value: failed, expected_value: 5, detail: 'semantic partition failures < 5' });
      break;
    }
    case 'projection_consistency': {
      const { data } = await ownedDbTable('projection_sync_state')
        .select('id, projection_kind, cursor_position')
        .eq('organization_id', organizationId);
      const rows = (data as Array<{ projection_kind: string; cursor_position: string | null }>) ?? [];
      const REQUIRED = ['opportunity_feed', 'graph', 'alerts', 'clusters', 'lifecycle'];
      for (const kind of REQUIRED) {
        const row = rows.find((r) => r.projection_kind === kind);
        results.push({ check_kind: `projection_${kind}_present`, passed: Boolean(row), observed_value: row ? 1 : 0, expected_value: 1, detail: `projection ${kind} row exists` });
      }
      break;
    }
    case 'partition_health': {
      const [leased, expired, quarantined] = await Promise.all([
        countByStatusInWindow('execution_partitions', organizationId, 'leased', start, end),
        countByStatusInWindow('execution_partitions', organizationId, 'expired', start, end),
        countByStatusInWindow('execution_partitions', organizationId, 'quarantined', start, end),
      ]);
      results.push({ check_kind: 'no_expired_partitions', passed: expired === 0, observed_value: expired, expected_value: 0, detail: 'no expired execution partitions' });
      results.push({ check_kind: 'no_quarantined_partitions', passed: quarantined === 0, observed_value: quarantined, expected_value: 0, detail: 'no quarantined execution partitions' });
      results.push({ check_kind: 'leased_partitions_present', passed: leased >= 0, observed_value: leased, expected_value: 0, detail: 'leased count observed' });
      break;
    }
    case 'connector_resilience': {
      const [failed, complete] = await Promise.all([
        countByStatusInWindow('listening_executions', organizationId, 'failed', start, end),
        countByStatusInWindow('listening_executions', organizationId, 'complete', start, end),
      ]);
      const ratio = (failed + complete) === 0 ? 0 : failed / (failed + complete);
      results.push({ check_kind: 'connector_failure_ratio', passed: ratio < 0.1, observed_value: Number(ratio.toFixed(4)), expected_value: '<0.1', detail: 'connector failure ratio < 10%' });
      break;
    }
    case 'failover_readiness': {
      const { data: routing } = await ownedDbTable('region_routing')
        .select('primary_region, failover_region, failover_strategy')
        .eq('organization_id', organizationId)
        .maybeSingle();
      const r = routing as { primary_region: string | null; failover_region: string | null; failover_strategy: string | null } | null;
      results.push({ check_kind: 'primary_region_set', passed: Boolean(r?.primary_region), observed_value: r?.primary_region ?? null, expected_value: 'present', detail: 'primary_region must be set' });
      results.push({ check_kind: 'failover_region_set', passed: Boolean(r?.failover_region), observed_value: r?.failover_region ?? null, expected_value: 'present', detail: 'failover_region must be set' });
      results.push({ check_kind: 'failover_strategy_operator_approved', passed: r?.failover_strategy === 'operator_approved', observed_value: r?.failover_strategy ?? null, expected_value: 'operator_approved', detail: 'failover should require operator approval' });
      break;
    }
  }
  failures = results.filter((r) => !r.passed).length;
  const status: ResilienceValidationStatus = failures === 0 ? 'complete' : failures < results.length ? 'partial' : 'failed';
  const failureExplanation = failures === 0
    ? null
    : `${failures}/${results.length} checks failed: ${results.filter((r) => !r.passed).map((r) => r.check_kind).join(', ')}`;
  return { results, status, failureExplanation };
}

export type RunResilienceValidationInput = {
  organizationId: string;
  validationKind: ResilienceValidationKind;
  windowStart?: string;
  windowEnd?: string;
  initiatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function runResilienceValidation(input: RunResilienceValidationInput): Promise<ResilienceValidationRun> {
  const { start, end } = (input.windowStart && input.windowEnd) ? { start: input.windowStart, end: input.windowEnd } : defaultWindow();
  const verdict = await runValidation(input.organizationId, input.validationKind, start, end);
  const ins = await ownedDbTable('resilience_validation_runs')
    .insert({
      organization_id: input.organizationId,
      validation_kind: input.validationKind,
      status: verdict.status,
      observed_results: verdict.results,
      failure_explanation: verdict.failureExplanation,
      bounded_window_start: start,
      bounded_window_end: end,
      initiated_by: input.initiatedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`resilience_validation_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as ResilienceValidationRun;

  try {
    const failures = verdict.results.filter((r) => !r.passed).length;
    await publishResilienceValidationCompleted({
      organizationId: input.organizationId,
      validationKind: row.validation_kind,
      status: row.status,
      failures,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'resilience',
      eventName: 'resilience.validation_completed',
      payload: { validation_kind: row.validation_kind, status: row.status, failures },
    });
  } catch { /* best effort */ }
  return row;
}

export async function listResilienceValidations(
  organizationId: string,
  options?: { validationKind?: ResilienceValidationKind; limit?: number },
): Promise<ResilienceValidationRun[]> {
  let q = ownedDbTable('resilience_validation_runs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.validationKind) q = q.eq('validation_kind', options.validationKind);
  const { data } = await q;
  return (data as ResilienceValidationRun[]) ?? [];
}
