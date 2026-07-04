import { supabase } from '../db/supabaseClient';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { archiveDecisionSourceEntityType, createDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';
import { clamp } from './intelligenceEngineUtils';
// BETA-ENGINE-002: evidence-derived confidence from the canonical Confidence Engine.
import { deriveDecisionConfidence, decisionConfidenceExplainability } from './evidencePlatform';
// BETA-ENGINE-006: evidence-aware confidence — consume the entity provider's ACTUAL measured Evidence
// (schema completeness, sameAs links, KG presence) when supplied, not just provider availability.
import { hasMeasuredEvidence, evidenceValue, summarizeEvidence, type Evidence } from './evidencePlatform';
// BETA-ENGINE-009: cross-evidence correlations (entity+AI, backlinks+search, authority+rankings) fold a
// bounded, measured coverage adjustment into authority confidence — deterministic, no scoring redesign.
import { summarizeCorrelations, correlationCoverageDelta, type CorrelatedEvidence } from './evidencePlatform';
// BETA-ENGINE-010: root-cause diagnoses turn authority recommendations from symptom-driven to
// diagnosis-driven (e.g. "Authority Deficit" instead of "improve SEO"). Attached for traceability; the
// confidence effect already flows through the correlations these causes derive from (no double-count).
import { summarizeRootCauses, type RootCause } from './evidencePlatform';
// BETA-ENGINE-011: root causes become deterministic, prioritized, executable plans. Attached to the
// decision so the recommendation is an implementation-ready plan, not a static template string.
import { summarizeRecommendations, type ExecutionPlan } from './evidencePlatform';
// BETA-ENGINE-012: business-impact initiatives prioritise the plans by commercial value (deterministic,
// honest ROI). Attached so the executive surface leads with business opportunity, not technical urgency.
import { summarizeBusinessImpact, type BusinessImpact } from './evidencePlatform';
// BETA-ENGINE-013: compose the full reasoning chain into one auditable Explanation so the executive
// conclusion is reproducible + independently traceable (evidence → … → decision). No narrative generation.
import { buildExplanation, summarizeExplanation } from './evidencePlatform';
// BETA-PROVIDER-001: real backlink provider availability lifts authority confidence to MEASURED.
import { isBacklinkProviderAvailable, backlinkProviderReliability } from './backlinkAuthorityProviderBridge';
// BETA-ENGINE-005: entity / knowledge-graph presence is an authenticated authority signal (the report maps
// entity → the authority pillar). Adopt it as a second authority provider, blended with backlinks.
import { isEntityProviderAvailable, entityProviderReliability } from './entityGraphProviderBridge';
import { combinedProviderReliability } from './ga4ProviderBridge';

type BacklinkRow = {
  referring_domain: string;
  domain_authority: number | null;
  link_type: string | null;
};

function sinceDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** BETA-ENGINE-006: an orchestrator may supply the entity provider's already-fetched canonical Evidence
 *  (no duplicate fetch) so confidence is driven by ACTUAL entity measurements. Optional + backward-compatible. */
export interface AuthorityEvidenceContext {
  entityEvidence?: Evidence[] | null;
  /** BETA-ENGINE-009: correlations the authority engine consumes (authority+rankings, backlinks+search, entity+AI). */
  correlations?: CorrelatedEvidence[] | null;
  /** BETA-ENGINE-010: root-cause diagnoses (Authority Deficit, …) the recommendation targets. */
  rootCauses?: RootCause[] | null;
  /** BETA-ENGINE-011: executable, prioritized plans generated from the root causes. */
  recommendations?: ExecutionPlan[] | null;
  /** BETA-ENGINE-012: business-prioritized initiatives (impact + opportunity + honest ROI). */
  businessImpact?: BusinessImpact[] | null;
}

export async function generateAuthorityIntelligenceDecisions(
  companyId: string,
  context: AuthorityEvidenceContext = {},
): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('authorityIntelligenceService');

  const { data, error } = await supabase
    .from('canonical_backlink_signals')
    .select('referring_domain, domain_authority, link_type')
    .eq('company_id', companyId)
    .gte('last_seen_at', sinceDays(180))
    .limit(1400);

  if (error) throw new Error(`Failed to load backlink signals for authority engine: ${error.message}`);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'authorityIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (data ?? []) as BacklinkRow[];
  if (rows.length === 0) return [];

  const uniqueDomains = new Set(rows.map((row) => row.referring_domain).filter(Boolean)).size;
  const avgAuthority = rows.length > 0
    ? rows.reduce((sum, row) => sum + Number(row.domain_authority ?? 0), 0) / rows.length
    : 0;
  const dofollowCount = rows.filter((row) => String(row.link_type || '').toLowerCase() !== 'nofollow').length;
  const dofollowRate = dofollowCount / rows.length;

  // BETA-ENGINE-002: confidence is now evidence-derived (was hardcoded 0.82/0.8/0.76). Backlink
  // authority is INFERRED (no backlink API — BETA-AUDIT-004); confidence scales with the backlink
  // sample size and the fraction of signals that actually carry a domain_authority value.
  const authorityMeasuredRows = rows.filter((row) => row.domain_authority != null).length;
  // BETA-PROVIDER-001 / BETA-ENGINE-005: authority is backed by authenticated authority providers —
  // backlinks (inbound-link authority) and entity / knowledge-graph presence (verified-entity authority,
  // which the report already maps to the authority pillar). When either/both are connected, authority is
  // MEASURED and their reliabilities blend deterministically — confidence rises from evidence quality
  // alone, no scoring redesign. With no provider this is INFERRED, exactly as before (backward compat).
  const backlinkProviderLive = isBacklinkProviderAvailable();
  const entityProviderLive = isEntityProviderAvailable();
  const backlinkCompleteness = rows.length > 0 ? authorityMeasuredRows / rows.length : 0;

  // BETA-ENGINE-006: when the entity provider's ACTUAL measured Evidence is supplied, authority confidence
  // is driven by real entity strength (schema completeness, sameAs density, KG presence) — a strong entity
  // graph raises confidence, a weak/absent one lowers it — not merely by "the provider is connected".
  // Deterministic; blended with the measured backlink sample. Falls back to BETA-ENGINE-005 availability
  // behaviour when no measured entity Evidence is present (backward compatible).
  // BETA-ENGINE-009: fold correlated cross-evidence (bounded, measured) into the coverage factor.
  const correlationSummary = context.correlations ? summarizeCorrelations(context.correlations) : null;
  const correlationDelta = correlationSummary ? correlationCoverageDelta(correlationSummary) : 0;
  const correlationReasonCodes = correlationSummary?.reasonCodes ?? [];

  const entityMeasured = hasMeasuredEvidence(context.entityEvidence);
  let authorityConfidence;
  let measuredEvidenceKeys: string[] = [];
  if (entityMeasured) {
    const entitySummary = summarizeEvidence(context.entityEvidence);
    measuredEvidenceKeys = entitySummary.measuredKeys;
    const schemaCompleteness = evidenceValue(context.entityEvidence, 'schema_completeness'); // 0..1
    const sameAs = evidenceValue(context.entityEvidence, 'sameas_count') ?? 0;
    const presence = evidenceValue(context.entityEvidence, 'knowledge_graph_presence') ?? 0;
    const baseCoverage = presence > 0 ? clamp(sameAs / 8, 0, 1) : 0;
    authorityConfidence = deriveDecisionConfidence({
      maturity: 'MEASURED',
      sampleSize: rows.length,
      // blend the measured backlink authority-coverage with the measured entity schema completeness.
      completeness: schemaCompleteness != null ? (backlinkCompleteness + schemaCompleteness) / 2 : backlinkCompleteness,
      // real entity link density → coverage, adjusted by measured cross-evidence correlations (bounded).
      coverage: clamp(baseCoverage + correlationDelta, 0, 1),
      providerReliability: combinedProviderReliability(
        backlinkProviderLive ? backlinkProviderReliability() : null,
        entitySummary.meanReliability ?? entityProviderReliability(),
      ),
      dataPresent: rows.length > 0 || presence > 0,
    });
  } else {
    // BETA-ENGINE-005 fallback: provider-availability behaviour (unchanged, backward compatible).
    const authorityProviderLive = backlinkProviderLive || entityProviderLive;
    authorityConfidence = deriveDecisionConfidence({
      maturity: authorityProviderLive ? 'MEASURED' : 'INFERRED',
      providerReliability: combinedProviderReliability(
        backlinkProviderLive ? backlinkProviderReliability() : null,
        entityProviderLive ? entityProviderReliability() : null,
      ),
      sampleSize: rows.length,
      completeness: backlinkCompleteness,
      dataPresent: rows.length > 0,
    });
  }
  // BETA-ENGINE-010: attach the diagnosed root causes so the recommendation is diagnosis-driven + traceable.
  const rootCauseSummary = context.rootCauses ? summarizeRootCauses(context.rootCauses) : null;
  const recommendationSummary = context.recommendations ? summarizeRecommendations(context.recommendations) : null;
  const businessSummary = context.businessImpact ? summarizeBusinessImpact(context.businessImpact) : null;
  // BETA-ENGINE-013: one auditable Explanation composing the whole chain for this engine's conclusions.
  const authorityExplanation = summarizeExplanation(buildExplanation({
    decisionId: `authority:${companyId}`,
    evidence: context.entityEvidence,
    correlations: context.correlations,
    rootCauses: context.rootCauses,
    recommendations: context.recommendations,
    businessImpact: context.businessImpact,
    confidence: authorityConfidence,
  }));
  const authorityConfExplain = {
    ...decisionConfidenceExplainability(authorityConfidence),
    measured_evidence: measuredEvidenceKeys,
    correlations: correlationReasonCodes,
    root_causes: rootCauseSummary?.diagnoses ?? [],
    execution_plans: recommendationSummary?.plans ?? [],
    business_initiatives: businessSummary?.initiatives ?? [],
    decision_explanation: authorityExplanation,
  };

  const decisions = [];

  if (uniqueDomains < 25 || dofollowRate < 0.55) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'authorityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'backlink_gap',
      title: 'Backlink profile is below authority growth threshold',
      description: 'Referring domain breadth and follow-link ratio are insufficient for sustained ranking gains.',
      evidence: {
        unique_referring_domains: uniqueDomains,
        dofollow_rate: dofollowRate,
        confidence: authorityConfExplain,
      },
      impact_traffic: 48,
      impact_conversion: 20,
      impact_revenue: 36,
      priority_score: 66,
      effort_score: 30,
      confidence_score: authorityConfidence.confidenceScore,
      recommendation: 'Increase quality referring domains and focus on follow-link acquisition to core pages.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'backlink_gap' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (avgAuthority < 35) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'authorityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'authority_deficit',
      title: 'Average referring authority is below competitive baseline',
      description: 'Link sources are not strong enough to move high-value queries into durable rankings.',
      evidence: {
        average_domain_authority: avgAuthority,
        backlink_count: rows.length,
        confidence: authorityConfExplain,
      },
      impact_traffic: clamp(42 + Math.round((35 - Math.min(avgAuthority, 35)) * 1.1), 0, 100),
      impact_conversion: 24,
      impact_revenue: 44,
      priority_score: 64,
      effort_score: 28,
      confidence_score: authorityConfidence.confidenceScore,
      recommendation: 'Prioritize links from higher-authority publishers and expert networks.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'authority_deficit' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (uniqueDomains < 20 && avgAuthority < 30) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'authorityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'trust_gap',
      title: 'External authority and trust signals are too weak',
      description: 'Low-quality backlink profile is limiting both discoverability and external credibility.',
      evidence: {
        unique_referring_domains: uniqueDomains,
        average_domain_authority: avgAuthority,
        confidence: authorityConfExplain,
      },
      impact_traffic: 34,
      impact_conversion: 46,
      impact_revenue: 48,
      priority_score: 70,
      effort_score: 26,
      confidence_score: authorityConfidence.confidenceScore,
      recommendation: 'Build proof-oriented authority assets and earn links from trusted domains in your category.',
      action_type: 'improve_content',
      action_payload: { optimization_focus: 'authority_trust' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
