/**
 * Beta Acceptance Verifier  (BETA-RELEASE-002, Phase 4/8)
 *
 * The executive-report acceptance audit as DETERMINISTIC, executable code — it inspects a composed
 * `ExecutiveIntelligenceReport` for the exact defects the spec forbids: placeholder sections, unexplained
 * numbers (a metric with no drill-down), duplicate recommendations, contradictory recommendations, missing
 * provenance, and dishonest provider status. It fixes nothing (presentation is generated deterministically
 * from the model, so there is nothing to "fix" — only to VERIFY); it produces a graded acceptance result.
 * NO fabrication: an honest-empty report (no evidence) passes — an empty section is `awaiting_evidence`,
 * which is a legitimate state, not a placeholder.
 */
import type { ExecutiveIntelligenceReport } from './executiveIntelligenceReport';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface AcceptanceIssue {
  code: string;
  severity: Severity;
  location: string;
  message: string;
}

export interface AcceptanceResult {
  accepted: boolean;
  issues: AcceptanceIssue[];
  checks: {
    everySectionRenders: boolean;
    everyNumberTraceable: boolean;
    everyRecommendationEvidenceBacked: boolean;
    noDuplicateRecommendations: boolean;
    noContradictoryRecommendations: boolean;
    everyProviderStatusHonest: boolean;
    noPlaceholders: boolean;
  };
  summary: { critical: number; high: number; medium: number; low: number };
}

const PLACEHOLDER = /\b(TODO|TBD|lorem ipsum|placeholder|coming soon|xxx|fixme|<insert)\b/i;
const HONEST_STATUSES = new Set(['connected', 'awaiting_credentials', 'disabled', 'not_implemented', 'active', 'awaiting_activation', 'partially_active']);

export function verifyBetaAcceptance(report: ExecutiveIntelligenceReport): AcceptanceResult {
  const issues: AcceptanceIssue[] = [];
  const add = (code: string, severity: Severity, location: string, message: string) => issues.push({ code, severity, location, message });

  // 1. Every section renders (an empty section is honest `awaiting_evidence`, not a missing render).
  for (const s of report.sections) {
    if (!s.title || !s.sectionId) add('MISSING_SECTION_ID', 'high', s.sectionId || '(unknown)', 'Section is missing an id/title.');
    if (PLACEHOLDER.test(s.title)) add('PLACEHOLDER_TITLE', 'critical', s.sectionId, `Section title contains placeholder text: "${s.title}".`);
  }
  const everySectionRenders = report.sections.every((s) => !!s.sectionId && !!s.title);

  // 2. Every displayed number is traceable — an evidence-backed section MUST carry a drill-down chain.
  let everyNumberTraceable = true;
  for (const s of report.sections) {
    if (s.conclusion === 'evidence_backed') {
      if (!s.drillDown || !s.drillDown.explanationId) { add('UNEXPLAINED_METRIC', 'critical', s.sectionId, 'Evidence-backed section has no drill-down explanation.'); everyNumberTraceable = false; }
      if (s.confidence.score != null && !s.drillDown?.fullyTraceable) { add('UNEXPLAINED_CONFIDENCE', 'high', s.sectionId, 'A confidence score is shown but the chain is not fully traceable.'); everyNumberTraceable = false; }
    }
  }

  // 3. Every recommendation/business initiative with a shown ROI/priority must trace to evidence.
  let everyRecommendationEvidenceBacked = true;
  for (const s of report.sections) {
    for (const b of s.businessImpact) {
      if (!s.reasonCodes.length && b.priority > 0 && s.conclusion === 'evidence_backed') { add('UNBACKED_RECOMMENDATION', 'high', `${s.sectionId}:${b.id}`, 'A prioritised initiative has no reason codes.'); everyRecommendationEvidenceBacked = false; }
    }
  }

  // 4. No duplicate recommendations in the roadmap.
  const roadmapIds = report.executionRoadmap.map((p) => p.id);
  const dupes = roadmapIds.filter((id, i) => roadmapIds.indexOf(id) !== i);
  const noDuplicateRecommendations = dupes.length === 0;
  if (!noDuplicateRecommendations) add('DUPLICATE_RECOMMENDATION', 'high', 'executionRoadmap', `Duplicate recommendation id(s): ${[...new Set(dupes)].join(', ')}.`);

  // 5. No contradictory recommendations — a "resolved/monitor" and a "corrective" plan for the SAME rule.
  const byRule = new Map<string, Set<string>>();
  for (const p of report.executionRoadmap) {
    const rule = p.id.split('::')[0];
    const set = byRule.get(rule) ?? new Set<string>();
    set.add(p.actionType); byRule.set(rule, set);
  }
  let noContradictoryRecommendations = true;
  for (const [rule, types] of byRule) {
    if (types.has('monitoring') && (types.has('corrective') || types.has('dependency'))) { add('CONTRADICTORY_RECOMMENDATION', 'medium', rule, `Rule ${rule} has both a monitoring and a corrective/dependency plan.`); noContradictoryRecommendations = false; }
  }

  // 6. Every provider status is one of the honest, canonical statuses (never a faked/unknown value).
  let everyProviderStatusHonest = true;
  for (const p of report.providerHealth.providers) {
    if (!HONEST_STATUSES.has(p.status)) { add('DISHONEST_PROVIDER_STATUS', 'critical', p.providerId, `Provider status "${p.status}" is not a canonical honest status.`); everyProviderStatusHonest = false; }
  }
  if (!HONEST_STATUSES.has(report.state)) { add('DISHONEST_REPORT_STATE', 'critical', 'report.state', `Report state "${report.state}" is not a canonical honest status.`); everyProviderStatusHonest = false; }

  // 7. No placeholders anywhere in section titles / outcomes.
  const noPlaceholders = !report.sections.some((s) => PLACEHOLDER.test(s.title) || s.expectedOutcomes.some((o) => PLACEHOLDER.test(o)));
  if (!noPlaceholders) add('PLACEHOLDER_CONTENT', 'critical', 'sections', 'Placeholder text detected in a section title or outcome.');

  const summary = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
  };
  return {
    accepted: summary.critical === 0 && summary.high === 0,
    issues,
    checks: { everySectionRenders, everyNumberTraceable, everyRecommendationEvidenceBacked, noDuplicateRecommendations, noContradictoryRecommendations, everyProviderStatusHonest, noPlaceholders },
    summary,
  };
}
