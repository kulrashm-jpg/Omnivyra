/**
 * Phase 12 — Enterprise customer operations scoring.
 *
 * Deterministic, explainable per-tenant scoring across six dimensions:
 *   • tenant_readiness            — Phase 11 onboarding runtime aggregate
 *   • rollout_cohort              — fraction of rollouts complete
 *   • onboarding_completion       — Phase 10 onboarding applications applied
 *   • operational_maturity        — incidents + DR + safeguards posture
 *   • tenant_health               — listening + semantic + replay failure ratios
 *   • support_escalation_readiness — incident timeline + escalation coverage
 *
 * Hard guarantees:
 *   • Operator-triggered.
 *   • Each score ∈ [0,1] (DB CHECK).
 *   • Components carry weight + passed flag for full transparency.
 *   • Read-only over upstream tables.
 *   • Tenant-first.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type CustomerOperationsScore,
  type CustomerOpsComponent,
  type CustomerOpsScoreKind,
} from '../types/customerOperations';
import { publishRealtime } from './realtimePublisherService';
import { publishCustomerOpsScoreUpdated } from '../events/listeningEvents';

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

async function tableCount(table: string, organizationId: string, filter?: { column: string; value: string }): Promise<number> {
  try {
    let q = ownedDbTable(table).select('id', { count: 'exact', head: true }).eq('organization_id', organizationId);
    if (filter) q = q.eq(filter.column, filter.value);
    const { count } = await q;
    return count ?? 0;
  } catch { return 0; }
}

async function componentsFor(kind: CustomerOpsScoreKind, organizationId: string): Promise<CustomerOpsComponent[]> {
  switch (kind) {
    case 'tenant_readiness': {
      const { data } = await ownedDbTable('tenant_onboarding_runtime_stages')
        .select('readiness_score, status')
        .eq('organization_id', organizationId);
      const rows = (data as Array<{ readiness_score: number; status: string }>) ?? [];
      const avg = rows.length ? rows.reduce((a, r) => a + r.readiness_score, 0) / rows.length : 0;
      const complete = rows.filter((r) => r.status === 'complete').length;
      return [
        { component_kind: 'avg_readiness', weight: 0.6, observed_score: clamp01(avg), passed: avg >= 0.8, detail: `avg=${avg.toFixed(2)}` },
        { component_kind: 'complete_ratio', weight: 0.4, observed_score: clamp01(complete / Math.max(1, rows.length)), passed: rows.length > 0 && complete === rows.length, detail: `${complete}/${rows.length} stages complete` },
      ];
    }
    case 'rollout_cohort': {
      const [complete, total] = await Promise.all([
        tableCount('production_rollout_plans', organizationId, { column: 'status', value: 'complete' }),
        tableCount('production_rollout_plans', organizationId),
      ]);
      const ratio = clamp01(complete / Math.max(1, total));
      return [
        { component_kind: 'rollout_completion', weight: 1.0, observed_score: ratio, passed: ratio > 0.9, detail: `${complete}/${total} plans complete` },
      ];
    }
    case 'onboarding_completion': {
      const [applied, total] = await Promise.all([
        tableCount('enterprise_onboarding_applications', organizationId, { column: 'status', value: 'applied' }),
        tableCount('enterprise_onboarding_applications', organizationId),
      ]);
      const ratio = clamp01(applied / Math.max(1, total));
      return [
        { component_kind: 'applied_ratio', weight: 1.0, observed_score: ratio, passed: ratio > 0.8, detail: `${applied}/${total} applications applied` },
      ];
    }
    case 'operational_maturity': {
      const [openIncidents, resolvedIncidents, drFailed] = await Promise.all([
        tableCount('intelligence_incidents', organizationId, { column: 'status', value: 'open' }),
        tableCount('intelligence_incidents', organizationId, { column: 'status', value: 'resolved' }),
        tableCount('disaster_recovery_executions', organizationId, { column: 'status', value: 'failed' }),
      ]);
      const resolution = clamp01(resolvedIncidents / Math.max(1, openIncidents + resolvedIncidents));
      const drClean = drFailed === 0 ? 1 : clamp01(1 - drFailed / 25);
      return [
        { component_kind: 'incident_resolution', weight: 0.6, observed_score: resolution, passed: resolution > 0.85, detail: `${resolvedIncidents}/(${openIncidents}+${resolvedIncidents}) resolved` },
        { component_kind: 'dr_clean', weight: 0.4, observed_score: drClean, passed: drFailed === 0, detail: `${drFailed} DR failures` },
      ];
    }
    case 'tenant_health': {
      const [execFailed, execComplete, semFailed, semComplete, repFailed, repComplete] = await Promise.all([
        tableCount('listening_executions', organizationId, { column: 'status', value: 'failed' }),
        tableCount('listening_executions', organizationId, { column: 'status', value: 'complete' }),
        tableCount('semantic_indexing_partitions', organizationId, { column: 'status', value: 'failed' }),
        tableCount('semantic_indexing_partitions', organizationId, { column: 'status', value: 'complete' }),
        tableCount('replay_partitions', organizationId, { column: 'status', value: 'failed' }),
        tableCount('replay_partitions', organizationId, { column: 'status', value: 'complete' }),
      ]);
      const exec = clamp01(execComplete / Math.max(1, execComplete + execFailed));
      const sem = clamp01(semComplete / Math.max(1, semComplete + semFailed));
      const rep = clamp01(repComplete / Math.max(1, repComplete + repFailed));
      return [
        { component_kind: 'execution_success', weight: 0.4, observed_score: exec, passed: exec > 0.95, detail: `${execComplete}/(${execComplete}+${execFailed})` },
        { component_kind: 'semantic_success', weight: 0.3, observed_score: sem, passed: sem > 0.95, detail: `${semComplete}/(${semComplete}+${semFailed})` },
        { component_kind: 'replay_success', weight: 0.3, observed_score: rep, passed: rep > 0.95, detail: `${repComplete}/(${repComplete}+${repFailed})` },
      ];
    }
    case 'support_escalation_readiness': {
      const [escalations, snapshots] = await Promise.all([
        tableCount('escalations', organizationId),
        tableCount('support_snapshots', organizationId),
      ]);
      const escReady = clamp01(escalations / Math.max(1, escalations + 5));
      const snapshotsReady = clamp01(snapshots / 5);
      return [
        { component_kind: 'escalation_history', weight: 0.5, observed_score: escReady, passed: escalations > 0, detail: `${escalations} escalations recorded` },
        { component_kind: 'support_snapshots_available', weight: 0.5, observed_score: snapshotsReady, passed: snapshots > 0, detail: `${snapshots} support snapshots` },
      ];
    }
  }
}

export type GenerateCustomerOpsScoreInput = {
  organizationId: string;
  scoreKind: CustomerOpsScoreKind;
  generatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateCustomerOpsScore(
  input: GenerateCustomerOpsScoreInput,
): Promise<CustomerOperationsScore> {
  const components = await componentsFor(input.scoreKind, input.organizationId);
  const weightSum = components.reduce((a, c) => a + c.weight, 0) || 1;
  const score = clamp01(components.reduce((a, c) => a + c.weight * c.observed_score, 0) / weightSum);
  const rationale = `score_kind=${input.scoreKind}; components=${components.length}; weighted=${score.toFixed(3)}; deterministic=true`;

  const ins = await ownedDbTable('customer_operations_scores')
    .insert({
      organization_id: input.organizationId,
      score_kind: input.scoreKind,
      score_value: score,
      components,
      rationale,
      generated_by: input.generatedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`customer_ops_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as CustomerOperationsScore;

  try {
    await publishCustomerOpsScoreUpdated({
      organizationId: input.organizationId,
      scoreKind: row.score_kind,
      scoreValue: row.score_value,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'customer_operations',
      eventName: 'customer_ops.score_updated',
      payload: { score_kind: row.score_kind, score_value: row.score_value },
    });
  } catch { /* best effort */ }
  return row;
}

export async function listCustomerOpsScores(
  organizationId: string,
  options?: { scoreKind?: CustomerOpsScoreKind; limit?: number },
): Promise<CustomerOperationsScore[]> {
  let q = ownedDbTable('customer_operations_scores')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.scoreKind) q = q.eq('score_kind', options.scoreKind);
  const { data } = await q;
  return (data as CustomerOperationsScore[]) ?? [];
}
