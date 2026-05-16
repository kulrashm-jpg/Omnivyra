/**
 * Phase 12 — Runtime governance convergence.
 *
 * Deterministic, explainable scoring across the rollout, safeguard, SLA,
 * resilience, and operational-risk surfaces. Two scores per row:
 *   • convergence_score  — [0,1], higher = more converged / healthy
 *   • drift_score        — [0,1], higher = more drift from baseline
 *
 * `risk_overlays` carries typed severity hints; `contributing_components`
 * carries the per-component weight + observed score + pass flag.
 *
 * Hard guarantees:
 *   • Read-only over Phase 7-11 owned tables.
 *   • Deterministic: same inputs → same scores.
 *   • Operator-triggered.
 *   • Emits `governance.drift_detected` when drift_score > 0.5.
 *   • Tenant-first.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type ConvergenceComponent,
  type GovernanceConvergenceScope,
  type GovernanceConvergenceScore,
  type RiskOverlay,
} from '../types/governanceConvergence';
import { publishRealtime } from './realtimePublisherService';
import { publishGovernanceDriftDetected } from '../events/listeningEvents';

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

async function countOf(table: string, organizationId: string, filter?: { column: string; value: string }): Promise<number> {
  try {
    let q = ownedDbTable(table).select('id', { count: 'exact', head: true }).eq('organization_id', organizationId);
    if (filter) q = q.eq(filter.column, filter.value);
    const { count } = await q;
    return count ?? 0;
  } catch { return 0; }
}

async function scoreForScope(
  scope: GovernanceConvergenceScope,
  organizationId: string,
): Promise<{ components: ConvergenceComponent[]; overlays: RiskOverlay[]; drift: number }> {
  switch (scope) {
    case 'overall': {
      const sub = await Promise.all([
        scoreForScope('rollout', organizationId),
        scoreForScope('safeguards', organizationId),
        scoreForScope('sla', organizationId),
        scoreForScope('resilience', organizationId),
      ]);
      const components: ConvergenceComponent[] = [];
      let drift = 0;
      for (const s of sub) {
        const wSum = s.components.reduce((a, c) => a + c.weight, 0) || 1;
        const sScore = s.components.reduce((a, c) => a + c.weight * c.observed_score, 0) / wSum;
        components.push({ component_kind: 'aggregate', weight: 0.25, observed_score: Number(sScore.toFixed(3)), passed: sScore > 0.7, detail: `${s.components.length} sub-components` });
        drift = Math.max(drift, s.drift);
      }
      return { components, overlays: sub.flatMap((s) => s.overlays), drift };
    }
    case 'rollout': {
      const [complete, failed, rolledBack] = await Promise.all([
        countOf('production_rollout_plans', organizationId, { column: 'status', value: 'complete' }),
        countOf('production_rollout_plans', organizationId, { column: 'status', value: 'failed' }),
        countOf('production_rollout_plans', organizationId, { column: 'status', value: 'rolled_back' }),
      ]);
      const total = complete + failed + rolledBack;
      const successRatio = clamp01(complete / Math.max(1, total));
      const components: ConvergenceComponent[] = [
        { component_kind: 'rollout_success_ratio', weight: 1.0, observed_score: Number(successRatio.toFixed(3)), passed: successRatio > 0.9, detail: `${complete}/${total} complete` },
      ];
      const overlays: RiskOverlay[] = [];
      if (rolledBack > 0) overlays.push({ overlay_kind: 'rollout_rollback_recent', severity: 'warn', detail: `${rolledBack} rollouts rolled back` });
      return { components, overlays, drift: clamp01((failed + rolledBack) / Math.max(1, total)) };
    }
    case 'safeguards': {
      const [tripped, frozen, overridden] = await Promise.all([
        countOf('operational_safety_rails', organizationId, { column: 'state', value: 'triggered' }),
        countOf('operational_safety_rails', organizationId, { column: 'state', value: 'frozen' }),
        countOf('operational_safety_rails', organizationId, { column: 'state', value: 'overridden' }),
      ]);
      const components: ConvergenceComponent[] = [
        { component_kind: 'safeguards_green', weight: 1.0, observed_score: tripped + frozen + overridden === 0 ? 1 : 0, passed: tripped + frozen + overridden === 0, detail: `tripped=${tripped} frozen=${frozen} overridden=${overridden}` },
      ];
      const overlays: RiskOverlay[] = [];
      if (tripped > 0) overlays.push({ overlay_kind: 'safeguard_tripped', severity: 'critical', detail: `${tripped} safety rails tripped` });
      if (frozen > 0) overlays.push({ overlay_kind: 'safeguard_frozen', severity: 'warn', detail: `${frozen} safety rails frozen` });
      return { components, overlays, drift: clamp01((tripped * 0.5 + frozen * 0.25 + overridden * 0.1) / 5) };
    }
    case 'sla': {
      const breaches = await countOf('sla_breach_events', organizationId);
      const components: ConvergenceComponent[] = [
        { component_kind: 'sla_no_breaches', weight: 1.0, observed_score: clamp01(1 - Math.min(1, breaches / 50)), passed: breaches < 5, detail: `${breaches} breaches` },
      ];
      const overlays: RiskOverlay[] = [];
      if (breaches > 5) overlays.push({ overlay_kind: 'sla_breach_volume', severity: 'warn', detail: `${breaches} SLA breach events` });
      return { components, overlays, drift: clamp01(breaches / 50) };
    }
    case 'resilience': {
      const { data } = await ownedDbTable('resilience_validation_runs')
        .select('id, status')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(50);
      const rows = (data as Array<{ status: string }>) ?? [];
      const completeRatio = clamp01(rows.filter((r) => r.status === 'complete').length / Math.max(1, rows.length));
      const components: ConvergenceComponent[] = [
        { component_kind: 'resilience_completion_ratio', weight: 1.0, observed_score: Number(completeRatio.toFixed(3)), passed: completeRatio > 0.9, detail: `${rows.length} recent runs` },
      ];
      return { components, overlays: [], drift: clamp01(1 - completeRatio) };
    }
    case 'operational_risk': {
      const [openIncidents, criticalIncidents] = await Promise.all([
        countOf('intelligence_incidents', organizationId, { column: 'status', value: 'open' }),
        countOf('intelligence_incidents', organizationId, { column: 'severity', value: 'sev1' }),
      ]);
      const components: ConvergenceComponent[] = [
        { component_kind: 'open_incidents', weight: 0.5, observed_score: clamp01(1 - Math.min(1, openIncidents / 25)), passed: openIncidents < 5, detail: `${openIncidents} open incidents` },
        { component_kind: 'critical_severity_present', weight: 0.5, observed_score: criticalIncidents === 0 ? 1 : 0, passed: criticalIncidents === 0, detail: `${criticalIncidents} sev1 incidents` },
      ];
      const overlays: RiskOverlay[] = [];
      if (criticalIncidents > 0) overlays.push({ overlay_kind: 'sev1_present', severity: 'critical', detail: `${criticalIncidents} sev1 incidents present` });
      return { components, overlays, drift: clamp01((openIncidents + criticalIncidents * 5) / 50) };
    }
    case 'governance_drift': {
      const overrides = await countOf('operational_safety_rails', organizationId, { column: 'state', value: 'overridden' });
      const components: ConvergenceComponent[] = [
        { component_kind: 'no_governance_overrides', weight: 1.0, observed_score: overrides === 0 ? 1 : 0, passed: overrides === 0, detail: `${overrides} active overrides` },
      ];
      return { components, overlays: [], drift: clamp01(overrides / 5) };
    }
  }
}

export type GenerateConvergenceScoreInput = {
  organizationId: string;
  scopeKind: GovernanceConvergenceScope;
  generatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateConvergenceScore(
  input: GenerateConvergenceScoreInput,
): Promise<GovernanceConvergenceScore> {
  const { components, overlays, drift } = await scoreForScope(input.scopeKind, input.organizationId);
  const weightSum = components.reduce((a, c) => a + c.weight, 0) || 1;
  const score = clamp01(components.reduce((a, c) => a + c.weight * c.observed_score, 0) / weightSum);
  const rationale = `scope=${input.scopeKind}; components=${components.length}; weighted_score=${score.toFixed(3)}; drift=${drift.toFixed(3)}; deterministic=true`;

  const ins = await ownedDbTable('governance_convergence_scores')
    .insert({
      organization_id: input.organizationId,
      scope_kind: input.scopeKind,
      convergence_score: score,
      drift_score: drift,
      risk_overlays: overlays,
      contributing_components: components,
      derivation_explanation: rationale,
      generated_by: input.generatedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`gov_convergence_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as GovernanceConvergenceScore;

  if (drift > 0.5) {
    try {
      await publishGovernanceDriftDetected({
        organizationId: input.organizationId,
        scopeKind: row.scope_kind,
        driftScore: row.drift_score,
        convergenceScore: row.convergence_score,
      });
      void publishRealtime({
        organizationId: input.organizationId,
        topic: 'governance_convergence',
        eventName: 'governance.drift_detected',
        payload: { scope_kind: row.scope_kind, drift_score: row.drift_score, convergence_score: row.convergence_score },
      });
    } catch { /* best effort */ }
  }
  return row;
}

export async function listConvergenceScores(
  organizationId: string,
  options?: { scopeKind?: GovernanceConvergenceScope; limit?: number },
): Promise<GovernanceConvergenceScore[]> {
  let q = ownedDbTable('governance_convergence_scores')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.scopeKind) q = q.eq('scope_kind', options.scopeKind);
  const { data } = await q;
  return (data as GovernanceConvergenceScore[]) ?? [];
}
