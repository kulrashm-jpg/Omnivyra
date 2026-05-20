/**
 * Orchestration diagnostics — composed completeness across all subsystems.
 *
 * Aggregates topology + CMS + cross-domain attribution + CRM + funnel signals
 * into one diagnostics-first report so the onboarding UX can guide setup with
 * one source of truth. Read-only, deterministic, tenant-safe.
 */
import { buildTopologyDiagnostics } from './leadCaptureTopologyService';
import { buildContinuityDiagnostics } from './crossDomainAttributionService';
import { buildLandingDiagnostics } from './landingPageIntegrationService';
import { buildEmbeddedFormDiagnostics } from './embeddedFormIntegrationService';
import { buildUniversalFunnel } from './universalFunnelIntelligenceService';
import { buildRevenueAttributionReport } from './crmReconciliationService';

export interface CheckResult {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'not_applicable';
  detail: string;
  repairGuidance?: string;
}

export interface OrchestrationDiagnosticsReport {
  companyId: string;
  generatedAt: string;
  overallScore: number; // 0..100 (avg of pass counters)
  checks: CheckResult[];
  driftDetected: boolean;
  capabilityNote: string;
}

function pass(id: string, label: string, detail: string): CheckResult {
  return { id, label, status: 'pass', detail };
}
function warn(id: string, label: string, detail: string, repair: string): CheckResult {
  return { id, label, status: 'warn', detail, repairGuidance: repair };
}
function fail(id: string, label: string, detail: string, repair: string): CheckResult {
  return { id, label, status: 'fail', detail, repairGuidance: repair };
}
function na(id: string, label: string, detail: string): CheckResult {
  return { id, label, status: 'not_applicable', detail };
}

export async function buildOrchestrationDiagnostics(companyId: string): Promise<OrchestrationDiagnosticsReport> {
  const [topology, continuity, landing, embedded, funnel, revenue] = await Promise.all([
    buildTopologyDiagnostics(companyId).catch(() => null),
    buildContinuityDiagnostics(companyId).catch(() => null),
    buildLandingDiagnostics(companyId).catch(() => null),
    buildEmbeddedFormDiagnostics(companyId).catch(() => null),
    buildUniversalFunnel(companyId).catch(() => null),
    buildRevenueAttributionReport(companyId).catch(() => null),
  ]);

  const checks: CheckResult[] = [];

  // Topology declared?
  if (topology?.topology) {
    checks.push(pass('topology_declared', 'Topology declared', `Topologies: ${topology.topology.topologies.join(', ')}`));
  } else {
    checks.push(fail('topology_declared', 'Topology declared', 'No topology set', 'Open Lead Capture → Topology and pick which capture modes apply.'));
  }

  // Topology completeness (attribution-mode coverage).
  if (topology) {
    const c = topology.completenessScore;
    checks.push(c >= 80 ? pass('topology_completeness', 'Topology completeness', `Score ${c}/100`)
      : c >= 50 ? warn('topology_completeness', 'Topology completeness', `Score ${c}/100`, 'Declare the attribution modes required by your topology.')
      : fail('topology_completeness', 'Topology completeness', `Score ${c}/100`, 'Several required attribution modes are missing for your declared topology.'));
  } else {
    checks.push(na('topology_completeness', 'Topology completeness', 'Set topology first'));
  }

  // Cross-domain attribution configured?
  if (continuity) {
    if (!continuity.configured) {
      checks.push(warn('xdomain_attr_configured', 'Cross-domain attribution', 'CROSS_DOMAIN_ATTR_SECRET unset', 'Set CROSS_DOMAIN_ATTR_SECRET in env to enable signed token handoffs.'));
    } else if (continuity.continuityRate < 0.7 && continuity.issued24h > 5) {
      checks.push(warn('xdomain_continuity_rate', 'Cross-domain continuity rate', `${(continuity.continuityRate * 100).toFixed(0)}% verified`, 'Investigate dropped/expired tokens — review SDK install on destination domains.'));
    } else {
      checks.push(pass('xdomain_attr_configured', 'Cross-domain attribution', `${continuity.verified24h}/${continuity.issued24h} verified (24h)`));
    }
  }

  // Landing page coverage.
  if (landing) {
    if (landing.orphanConversions24h > 0) {
      checks.push(warn('landing_orphans', 'External landing pages', `${landing.orphanConversions24h} orphan conversion(s)`, 'Register the source landing pages in the External landing pages tab.'));
    } else {
      checks.push(pass('landing_orphans', 'External landing pages', `${landing.registered} registered; no orphans (24h)`));
    }
  }

  // Embedded forms.
  if (embedded) {
    if (embedded.duplicateHandoffs24h > 0) {
      checks.push(warn('embedded_duplicates', 'Embedded form handoffs', `${embedded.duplicateHandoffs24h} duplicate handoff(s)`, 'Idempotent receiver should suppress duplicates — review form provider config.'));
    } else {
      checks.push(pass('embedded_duplicates', 'Embedded form handoffs', `${embedded.registered} registered; no duplicates (24h)`));
    }
  }

  // Funnel break rate.
  if (funnel) {
    if (funnel.attributionBreakRate > 0.3) {
      checks.push(warn('funnel_break_rate', 'Funnel attribution break rate', `${(funnel.attributionBreakRate * 100).toFixed(0)}%`, 'High break rate — review SDK install and destination-domain integration.'));
    } else {
      checks.push(pass('funnel_break_rate', 'Funnel attribution break rate', `${(funnel.attributionBreakRate * 100).toFixed(0)}%`));
    }
    if (funnel.bottleneckStage) {
      checks.push(warn('funnel_bottleneck', 'Funnel bottleneck', `Largest drop at: ${funnel.bottleneckStage}`, 'Investigate the drop-off stage — may indicate UX friction or missing instrumentation.'));
    }
  }

  // Revenue attribution.
  if (revenue) {
    if (revenue.revenueEvents === 0) {
      checks.push(na('revenue_attribution', 'Revenue attribution', 'No CRM revenue events recorded yet'));
    } else if (revenue.attributionRate < 0.5) {
      checks.push(warn('revenue_attribution', 'Revenue attribution', `${(revenue.attributionRate * 100).toFixed(0)}% attributed`, 'Many revenue events lack attribution tokens — verify CRM webhook is forwarding the captured token.'));
    } else {
      checks.push(pass('revenue_attribution', 'Revenue attribution', `${(revenue.attributionRate * 100).toFixed(0)}% attributed`));
    }
  }

  const total = checks.filter((c) => c.status !== 'not_applicable').length;
  const passed = checks.filter((c) => c.status === 'pass').length;
  const overallScore = total > 0 ? Math.round((passed / total) * 100) : 0;
  const driftDetected = checks.some((c) => c.status === 'fail' || c.status === 'warn');

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    overallScore,
    checks,
    driftDetected,
    capabilityNote:
      'Composed diagnostics across topology + cross-domain + landing + embedded + funnel + revenue. Deterministic, read-only.',
  };
}
