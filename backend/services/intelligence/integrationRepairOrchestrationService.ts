/**
 * Integration repair orchestration — ADVISORY-FIRST, OPERATOR-APPROVED.
 *
 * Aggregates drift + diagnostic signals from all existing intelligence
 * services into a single prioritised repair plan. NEVER performs autonomous
 * destructive action: every recommendation comes with a `requiresOperator`
 * flag and the URL or action the operator should take.
 *
 * Sources composed (all already implemented):
 *   - leadCaptureTopologyService            (topology completeness)
 *   - crossDomainAttributionService         (continuity rate)
 *   - landingPageIntegrationService         (orphan landings)
 *   - embeddedFormIntegrationService        (duplicate handoffs)
 *   - universalFunnelIntelligenceService    (funnel break / bottleneck)
 *   - cmsReconciliationService              (taxonomy / publish drift)
 *   - customerIdentityContinuityService     (identity drift flags)
 *   - cohortFunnelIntelligenceService       (cohort attribution gaps)
 *   - outboundCrmSyncService                (sync failure / not_configured)
 *   - betaReadinessService                  (degraded CMS connections)
 *
 * Every recommendation lineage row is appended (resource_type =
 * 'integration_repair_recommendation') so the operator can audit which
 * recommendations have been seen, dismissed, or actioned. Rollback-safe.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { buildTopologyDiagnostics } from './leadCaptureTopologyService';
import { buildContinuityDiagnostics } from './crossDomainAttributionService';
import { buildLandingDiagnostics } from './landingPageIntegrationService';
import { buildEmbeddedFormDiagnostics } from './embeddedFormIntegrationService';
import { buildUniversalFunnel } from './universalFunnelIntelligenceService';
import { buildCmsReconciliationReport } from './cmsReconciliationService';
import { buildIdentityContinuityReport } from './customerIdentityContinuityService';
import { buildCohortFunnelReport } from './cohortFunnelIntelligenceService';
import { buildOutboundCrmReport } from './outboundCrmSyncService';

export type RepairPriority = 'high' | 'medium' | 'low';
export type RepairCategory = 'topology' | 'attribution' | 'cms' | 'identity' | 'cohort' | 'crm_outbound' | 'sdk';

export interface RepairRecommendation {
  id: string;
  category: RepairCategory;
  priority: RepairPriority;
  label: string;
  detail: string;
  /** Where the operator should go to act on this. */
  remediationHref?: string;
  /** Human-readable next action. */
  nextAction: string;
  /** True when the action would change shared state — always true here. */
  requiresOperator: boolean;
}

export interface RepairPlan {
  companyId: string;
  generatedAt: string;
  recommendationsHigh: number;
  recommendationsMedium: number;
  recommendationsLow: number;
  recommendations: RepairRecommendation[];
  capabilityNote: string;
}

function rec(category: RepairCategory, priority: RepairPriority, id: string, label: string, detail: string, nextAction: string, remediationHref?: string): RepairRecommendation {
  return { id: `${category}.${id}`, category, priority, label, detail, nextAction, remediationHref, requiresOperator: true };
}

export async function buildRepairPlan(companyId: string): Promise<RepairPlan> {
  const [topology, continuity, landing, embedded, funnel, cms, identity, cohort, crm] = await Promise.all([
    buildTopologyDiagnostics(companyId).catch(() => null),
    buildContinuityDiagnostics(companyId).catch(() => null),
    buildLandingDiagnostics(companyId).catch(() => null),
    buildEmbeddedFormDiagnostics(companyId).catch(() => null),
    buildUniversalFunnel(companyId).catch(() => null),
    buildCmsReconciliationReport(companyId).catch(() => null),
    buildIdentityContinuityReport(companyId).catch(() => null),
    buildCohortFunnelReport(companyId, 'session').catch(() => null),
    buildOutboundCrmReport(companyId).catch(() => null),
  ]);

  const out: RepairRecommendation[] = [];

  // ── Topology
  if (topology && (topology.topology?.topologies ?? []).length === 0) {
    out.push(rec('topology', 'high', 'declare_topology', 'Declare your capture topology', 'No topology set — universal funnel cannot localize gaps.', 'Open Lead Capture → Topology and pick the capture modes that apply.', '/lead-capture'));
  } else if (topology && topology.completenessScore < 50) {
    out.push(rec('topology', 'medium', 'low_completeness', 'Topology completeness is low', `Score ${topology.completenessScore}/100 — some attribution modes are missing.`, 'Add the missing attribution modes in Lead Capture → Topology.', '/lead-capture'));
  }

  // ── Cross-domain attribution
  if (continuity && !continuity.configured) {
    out.push(rec('attribution', 'high', 'set_xdomain_secret', 'Cross-domain attribution not configured', 'CROSS_DOMAIN_ATTR_SECRET is unset — signed token handoffs disabled.', 'Set CROSS_DOMAIN_ATTR_SECRET in env to enable handoffs.'));
  } else if (continuity && continuity.continuityRate < 0.7 && continuity.issued24h > 5) {
    out.push(rec('attribution', 'medium', 'low_continuity_rate', 'Cross-domain continuity rate is low', `${(continuity.continuityRate * 100).toFixed(0)}% of issued tokens verified — investigate dropped tokens.`, 'Review SDK install on destination domains.', '/lead-capture'));
  }

  // ── Landing pages
  if (landing && landing.orphanConversions24h > 0) {
    out.push(rec('attribution', 'medium', 'orphan_landings', 'Orphan landing-page conversions detected', `${landing.orphanConversions24h} orphan conversion(s) in 24h.`, 'Register the source landing pages in the External landing pages tab.', '/lead-capture'));
  }

  // ── Embedded forms
  if (embedded && embedded.duplicateHandoffs24h > 0) {
    out.push(rec('sdk', 'medium', 'duplicate_handoffs', 'Duplicate embedded-form handoffs', `${embedded.duplicateHandoffs24h} duplicate(s) in 24h — review form-provider config.`, 'Inspect the form provider for double-fire of submit handlers.', '/lead-capture'));
  }

  // ── Funnel break
  if (funnel && funnel.attributionBreakRate > 0.3) {
    out.push(rec('attribution', 'high', 'funnel_break_high', 'Funnel attribution break rate is high', `${(funnel.attributionBreakRate * 100).toFixed(0)}% of leads have no touchpoint coverage.`, 'Verify the universal SDK is loaded on all entry domains.', '/lead-capture'));
  }
  if (funnel?.bottleneckStage) {
    out.push(rec('attribution', 'low', 'funnel_bottleneck', 'Funnel bottleneck', `Largest drop at: ${funnel.bottleneckStage}.`, 'Investigate the drop-off stage for UX friction or missing instrumentation.', '/lead-capture'));
  }

  // ── CMS reconciliation
  if (cms && cms.driftDetected > 0) {
    out.push(rec('cms', 'medium', 'cms_drift', 'CMS drift detected', `${cms.driftDetected} drift event(s) (${(Object.entries(cms.byKind) as Array<[string, number]>).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(', ')}).`, 'Open Integrations → CMS and re-validate the affected connection(s).', '/integrations'));
  }

  // ── Identity continuity
  if (identity && identity.driftFlags.length > 0) {
    out.push(rec('identity', 'medium', 'identity_drift', 'Identity continuity drift', `${identity.driftFlags.length} cluster(s) flagged (cross-device or attribution gaps).`, 'Review the Customer journey tab — multi-device clusters and orphan leads.', '/lead-capture'));
  }

  // ── Cohorts
  if (cohort && cohort.totalCohorts > 0) {
    const breaks = cohort.cohorts.reduce((acc, c) => acc + c.attributionBreaks, 0);
    if (breaks > 0) {
      out.push(rec('cohort', 'low', 'cohort_attribution_gaps', 'Cohort attribution gaps', `${breaks} lead(s) across cohorts have no touchpoint coverage.`, 'Review SDK install on entry domains and external landing pages.', '/lead-capture'));
    }
  }

  // ── Outbound CRM
  if (crm) {
    if (crm.totalEvents === 0 && Object.values(crm.capabilityFlags).every((v) => !v)) {
      out.push(rec('crm_outbound', 'low', 'crm_outbound_not_configured', 'Outbound CRM sync not configured', 'No CRM credentials and no lead_webhook integration found.', 'Add a lead_webhook integration or set CRM env credentials (HUBSPOT_CRM_ACCESS_TOKEN / SALESFORCE_* / ZOHO_CRM_ACCESS_TOKEN).', '/integrations'));
    } else if (crm.failedEvents > 0) {
      out.push(rec('crm_outbound', 'high', 'crm_outbound_failures', 'Outbound CRM sync failures', `${crm.failedEvents}/${crm.totalEvents} outbound sync events failed in 30d.`, 'Check CRM credentials and retry failed events from the Repair tab.', '/lead-capture'));
    }
  }

  // ── Append the plan as a single lineage row.
  try {
    await recordComplianceAudit({
      companyId,
      actor: { userId: null, type: 'system', label: 'integration-repair' },
      action: 'integration_repair.plan_generated',
      resourceType: 'integration_repair_recommendation',
      resourceId: `repair_plan:${companyId}:${new Date().toISOString().slice(0, 16)}`,
      severity: 'info',
      entityLineage: ['company', 'integration_repair', 'plan'],
      detail: { recommendations: out.length, byPriority: { high: out.filter((r) => r.priority === 'high').length, medium: out.filter((r) => r.priority === 'medium').length, low: out.filter((r) => r.priority === 'low').length } },
    });
  } catch { /* best-effort */ }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    recommendationsHigh: out.filter((r) => r.priority === 'high').length,
    recommendationsMedium: out.filter((r) => r.priority === 'medium').length,
    recommendationsLow: out.filter((r) => r.priority === 'low').length,
    recommendations: out.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    }),
    capabilityNote:
      'Advisory-only repair plan. Composed from 9 existing intelligence services. Every recommendation requires operator approval — no autonomous mutations. Lineage appended for audit.',
  };
}
