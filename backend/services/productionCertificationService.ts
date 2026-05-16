/**
 * Phase 11 — Production certification tooling.
 *
 * Operator-triggered, deterministic certification scoring over the
 * Phase 7-11 audit-grade surfaces. Each report carries:
 *   • certification_score in [0, 1] — weighted average of components
 *   • components[]                  — per-check weight + observed score
 *   • evidence_refs[]               — typed pointers to upstream rows
 *   • derivation_explanation        — single-paragraph deterministic rationale
 *
 * Hard guarantees:
 *   • Deterministic scoring: same upstream state → same score.
 *   • Read-only.
 *   • Export-safe: numeric components only; no PII in evidence refs.
 *   • Tenant-first.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type CertificationComponent,
  type CertificationEvidenceRef,
  type ProductionCertificationKind,
  type ProductionCertificationReport,
  type ProductionCertificationStatus,
} from '../types/productionCertification';
import { publishRealtime } from './realtimePublisherService';
import { publishCertificationGenerated } from '../events/listeningEvents';

async function tableCount(table: string, organizationId: string, filter?: { column: string; value: string }): Promise<number> {
  try {
    let q = ownedDbTable(table).select('id', { count: 'exact', head: true }).eq('organization_id', organizationId);
    if (filter) q = q.eq(filter.column, filter.value);
    const { count } = await q;
    return count ?? 0;
  } catch { return 0; }
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

async function scoreFor(kind: ProductionCertificationKind, organizationId: string): Promise<{ components: CertificationComponent[]; evidence: CertificationEvidenceRef[] }> {
  switch (kind) {
    case 'operational_readiness': {
      const [incidentsOpen, incidentsResolved, drComplete, drFailed] = await Promise.all([
        tableCount('intelligence_incidents', organizationId, { column: 'status', value: 'open' }),
        tableCount('intelligence_incidents', organizationId, { column: 'status', value: 'resolved' }),
        tableCount('disaster_recovery_executions', organizationId, { column: 'status', value: 'complete' }),
        tableCount('disaster_recovery_executions', organizationId, { column: 'status', value: 'failed' }),
      ]);
      const incScore = clamp01(1 - incidentsOpen / Math.max(1, incidentsOpen + incidentsResolved));
      const drScore = clamp01(drComplete / Math.max(1, drComplete + drFailed));
      return {
        components: [
          { component_kind: 'incident_resolution_ratio', weight: 0.6, observed_score: Number(incScore.toFixed(3)), passed: incScore > 0.8, detail: `${incidentsResolved}/(${incidentsOpen}+${incidentsResolved}) resolved` },
          { component_kind: 'dr_success_ratio', weight: 0.4, observed_score: Number(drScore.toFixed(3)), passed: drScore > 0.95, detail: `${drComplete}/(${drComplete}+${drFailed}) DR success` },
        ],
        evidence: [
          { source_kind: 'intelligence_incidents', source_id: '*', detail: `open=${incidentsOpen}, resolved=${incidentsResolved}` },
          { source_kind: 'disaster_recovery_executions', source_id: '*', detail: `complete=${drComplete}, failed=${drFailed}` },
        ],
      };
    }
    case 'governance_readiness': {
      const [policies, enforcements] = await Promise.all([
        tableCount('intelligence_governance_policies', organizationId),
        tableCount('governance_enforcement_events', organizationId),
      ]);
      const polScore = clamp01(policies / 5);
      const enfScore = clamp01(enforcements / 50);
      return {
        components: [
          { component_kind: 'governance_policy_coverage', weight: 0.5, observed_score: Number(polScore.toFixed(3)), passed: polScore >= 1, detail: `${policies} active policies (target 5)` },
          { component_kind: 'governance_enforcement_observed', weight: 0.5, observed_score: Number(enfScore.toFixed(3)), passed: enfScore > 0, detail: `${enforcements} enforcement events recorded` },
        ],
        evidence: [
          { source_kind: 'intelligence_governance_policies', source_id: '*', detail: `count=${policies}` },
          { source_kind: 'governance_enforcement_events', source_id: '*', detail: `count=${enforcements}` },
        ],
      };
    }
    case 'deployment_readiness': {
      const [rolloutComplete, rolloutFailed, migrationsExecuted, migrationsFailed] = await Promise.all([
        tableCount('production_rollout_plans', organizationId, { column: 'status', value: 'complete' }),
        tableCount('production_rollout_plans', organizationId, { column: 'status', value: 'failed' }),
        tableCount('migration_dry_runs', organizationId, { column: 'status', value: 'executed' }),
        tableCount('migration_dry_runs', organizationId, { column: 'status', value: 'failed' }),
      ]);
      const rolloutScore = clamp01(rolloutComplete / Math.max(1, rolloutComplete + rolloutFailed));
      const migrationScore = clamp01(migrationsExecuted / Math.max(1, migrationsExecuted + migrationsFailed));
      return {
        components: [
          { component_kind: 'rollout_success_ratio', weight: 0.6, observed_score: Number(rolloutScore.toFixed(3)), passed: rolloutScore > 0.9, detail: `${rolloutComplete}/(${rolloutComplete}+${rolloutFailed})` },
          { component_kind: 'migration_success_ratio', weight: 0.4, observed_score: Number(migrationScore.toFixed(3)), passed: migrationScore > 0.95, detail: `${migrationsExecuted}/(${migrationsExecuted}+${migrationsFailed})` },
        ],
        evidence: [
          { source_kind: 'production_rollout_plans', source_id: '*', detail: `complete=${rolloutComplete}, failed=${rolloutFailed}` },
          { source_kind: 'migration_dry_runs', source_id: '*', detail: `executed=${migrationsExecuted}, failed=${migrationsFailed}` },
        ],
      };
    }
    case 'sla_readiness': {
      const [slaBreaches] = await Promise.all([
        tableCount('sla_breach_events', organizationId),
      ]);
      const score = clamp01(1 - Math.min(1, slaBreaches / 50));
      return {
        components: [
          { component_kind: 'sla_breach_count', weight: 1.0, observed_score: Number(score.toFixed(3)), passed: slaBreaches < 5, detail: `${slaBreaches} SLA breach events recorded` },
        ],
        evidence: [{ source_kind: 'sla_breach_events', source_id: '*', detail: `count=${slaBreaches}` }],
      };
    }
    case 'resilience_certification': {
      const { data } = await ownedDbTable('resilience_validation_runs')
        .select('id, validation_kind, status')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(50);
      const runs = (data as Array<{ id: string; validation_kind: string; status: string }>) ?? [];
      const completeRatio = clamp01(runs.filter((r) => r.status === 'complete').length / Math.max(1, runs.length));
      return {
        components: [
          { component_kind: 'resilience_completion_ratio', weight: 1.0, observed_score: Number(completeRatio.toFixed(3)), passed: completeRatio > 0.9, detail: `${runs.length} recent validation runs` },
        ],
        evidence: [{ source_kind: 'resilience_validation_runs', source_id: '*', detail: `recent_count=${runs.length}` }],
      };
    }
    case 'audit_readiness': {
      const [complianceExports, consentRecords] = await Promise.all([
        tableCount('compliance_evidence_exports', organizationId),
        tableCount('consent_records', organizationId),
      ]);
      const exportScore = clamp01(complianceExports / 5);
      const consentScore = clamp01(consentRecords / 10);
      return {
        components: [
          { component_kind: 'compliance_exports_coverage', weight: 0.5, observed_score: Number(exportScore.toFixed(3)), passed: exportScore >= 1, detail: `${complianceExports} exports (target 5)` },
          { component_kind: 'consent_records_present', weight: 0.5, observed_score: Number(consentScore.toFixed(3)), passed: consentScore > 0, detail: `${consentRecords} consent records` },
        ],
        evidence: [
          { source_kind: 'compliance_evidence_exports', source_id: '*', detail: `count=${complianceExports}` },
          { source_kind: 'consent_records', source_id: '*', detail: `count=${consentRecords}` },
        ],
      };
    }
  }
}

export type GenerateCertificationInput = {
  organizationId: string;
  certificationKind: ProductionCertificationKind;
  generatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateCertification(input: GenerateCertificationInput): Promise<ProductionCertificationReport> {
  const { components, evidence } = await scoreFor(input.certificationKind, input.organizationId);
  const weightSum = components.reduce((acc, c) => acc + c.weight, 0) || 1;
  const score = clamp01(components.reduce((acc, c) => acc + c.weight * c.observed_score, 0) / weightSum);
  const allPassed = components.every((c) => c.passed);
  const status: ProductionCertificationStatus = allPassed ? 'complete' : (score > 0.5 ? 'partial' : 'failed');
  const derivation = `cert=${input.certificationKind}; components=${components.length}; weighted_score=${score.toFixed(3)}; all_passed=${allPassed}; deterministic=true`;

  const ins = await ownedDbTable('production_certification_reports')
    .insert({
      organization_id: input.organizationId,
      certification_kind: input.certificationKind,
      certification_score: score,
      components,
      evidence_refs: evidence,
      derivation_explanation: derivation,
      status,
      generated_by: input.generatedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`certification_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as ProductionCertificationReport;

  try {
    await publishCertificationGenerated({
      organizationId: input.organizationId,
      certificationKind: row.certification_kind,
      certificationScore: row.certification_score,
      status: row.status,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'production_certification',
      eventName: 'certification.generated',
      payload: { certification_kind: row.certification_kind, score: row.certification_score, status: row.status },
    });
  } catch { /* best effort */ }
  return row;
}

export async function listCertifications(
  organizationId: string,
  options?: { certificationKind?: ProductionCertificationKind; limit?: number },
): Promise<ProductionCertificationReport[]> {
  let q = ownedDbTable('production_certification_reports')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.certificationKind) q = q.eq('certification_kind', options.certificationKind);
  const { data } = await q;
  return (data as ProductionCertificationReport[]) ?? [];
}
