import type { PersistedDecisionObject } from '../decisionObjectService';
import type { ResolvedReportInput } from '../reportInputResolver';
import type { PublicAuditResult } from '../publicDomainAuditService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import { classifyDecisionType } from '../decisionTypeRegistry';
import { impactScore } from '../reportDecisionUtils';
import { buildDecisionBusinessImpact } from '../businessImpactFormatter';
import { average, clamp } from '../snapshotReportNarrativeHelpers';
import type {
  CompanyNarrativeContext,
  SnapshotInsight,
  SnapshotOpportunity,
  StrategicContext,
} from './types';
import {
  aiVisibilityTactics,
  authorityActionTactics,
  backlinkTactics,
  comparisonPageTactics,
  competitorGapTactics,
  contentDepthTactics,
  guessFocusPage,
  inferStructuredActionTrack,
  isAuthorityDecision,
  isContentDecision,
  isOpportunityCandidate,
  lowestDepthPageTargets,
  positioningProofTactics,
  replaceLegacyOmnivyraReferences,
  scrubActionCompanyReferences,
  structuredReasoning,
  topTrafficPotentialPages,
} from './actionTacticHelpers';
import {
  splitCandidates,
  firstNonEmpty,
  normalizePageLabel,
  personalizeEntityReferences,
  recommendationTimeline,
  confidencePercent,
} from './narrativeHelpers';

export { confidencePercent };

export function uniqueById(decisions: PersistedDecisionObject[]): PersistedDecisionObject[] {
  const byId = new Map<string, PersistedDecisionObject>();
  for (const decision of decisions) {
    byId.set(decision.id, decision);
  }
  return [...byId.values()];
}

export function toInsight(
  decision: PersistedDecisionObject,
  companyContext?: CompanyNarrativeContext,
): SnapshotInsight {
  return {
    decision_id: decision.id,
    title: personalizeEntityReferences(decision.title, companyContext),
    description: personalizeEntityReferences(decision.description, companyContext),
    why_it_matters: personalizeEntityReferences(buildWhyItMatters(decision), companyContext),
    business_impact: personalizeEntityReferences(buildDecisionBusinessImpact(decision), companyContext),
    issue_type: decision.issue_type,
    confidence_score: Number(decision.confidence_score ?? 0),
    impact_score: impactScore(decision),
    recommendation: decision.recommendation,
    action_type: decision.action_type,
  };
}

export function toOpportunity(decision: PersistedDecisionObject): SnapshotOpportunity {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    confidence_score: Number(decision.confidence_score ?? 0),
    action_type: decision.action_type,
  };
}

export function assessPositioningAndMarket(params: {
  companyContext: CompanyNarrativeContext;
  competitorIntelligence: CompetitorIntelligenceResult;
  decisions: PersistedDecisionObject[];
  publicAudit?: Awaited<ReturnType<typeof import('../publicDomainAuditService').buildPublicDomainAuditDecisions>> | null;
}): StrategicContext {
  const companyName = params.companyContext.companyName || params.companyContext.domain || 'this business';
  const positioningLabel = params.companyContext.positioning || params.companyContext.tagline || params.companyContext.homepageHeadline || 'its core market promise';
  const claritySignals = [
    params.companyContext.positioning,
    params.companyContext.tagline,
    params.companyContext.homepageHeadline,
    params.companyContext.primaryOffering,
  ].filter(Boolean).length;
  const consistencyPenalties = params.decisions.filter((decision) =>
    /(content_gap|weak_content_depth|missing_supporting_content|trust_gap|weak_brand_presence|competitor_dominance)/.test(decision.issue_type),
  ).length;
  const competitorPressure = average(
    (params.competitorIntelligence.generated_gaps ?? []).slice(0, 3).map((gap) => Number(gap.impact_score ?? 0)),
  );
  const fallbackUsed =
    params.competitorIntelligence.discovery_metadata?.is_fallback_used === true ||
    params.competitorIntelligence.discovery_metadata?.serp_status === 'fallback';
  const differentiationPenalty = fallbackUsed ? 8 : competitorPressure >= 70 ? 22 : competitorPressure >= 50 ? 14 : 6;
  const rawStrengthScore = clamp((claritySignals * 22) + (40 - Math.min(consistencyPenalties * 5, 25)) - differentiationPenalty, 0, 100);
  const positioningStrength: import('./types').PositioningStrength =
    rawStrengthScore >= 70 ? 'strong' : rawStrengthScore >= 45 ? 'moderate' : 'weak';

  const positioningNarrative =
    `${companyName}'s positioning as ${positioningLabel} is currently ${positioningStrength}, because clarity signals ${claritySignals >= 3 ? 'are visible' : 'are limited'} and cross-page reinforcement is ${consistencyPenalties <= 2 ? 'mostly consistent' : 'fragmented'}.`;
  const positioningGap = positioningStrength === 'weak'
    ? 'This positioning is not consistently reinforced in buyer-stage content and proof-led decision pages.'
    : positioningStrength === 'moderate'
      ? 'Positioning exists but is inconsistently reinforced in comparison and decision-stage content.'
      : null;

  const competitorCount = params.competitorIntelligence.detected_competitors.length;
  const marketType: import('./types').MarketType =
    competitorCount >= 3 && competitorPressure >= 68
      ? 'saturated'
      : competitorCount >= 2
        ? 'competitive'
        : params.publicAudit?.site_structure.blog_pages.length
          ? 'niche'
          : 'emerging';

  const keySuccessFactor =
    marketType === 'saturated'
      ? 'differentiated proof and authority depth'
      : marketType === 'competitive'
        ? 'consistent positioning plus stronger comparison-page coverage'
        : marketType === 'niche'
          ? 'focused relevance in core intent clusters'
          : 'early category ownership through clear positioning and coverage';
  const marketNarrative = `This market is ${marketType}, where ${keySuccessFactor} determines visibility.`;

  const strategyAlignment =
    positioningStrength === 'weak' && (marketType === 'saturated' || marketType === 'competitive')
      ? `Prioritize positioning clarity and proof architecture for ${companyName} before broad expansion.`
      : positioningStrength === 'strong' && (marketType === 'emerging' || marketType === 'niche')
        ? `Leverage ${companyName}'s clear positioning to expand coverage faster in core demand clusters.`
        : `Sequence positioning reinforcement with demand-capture execution so ${companyName} improves visibility without diluting differentiation.`;

  const competitorDeltas = (params.competitorIntelligence.comparison?.competitors ?? [])
    .map((item) => item.deltas_vs_company)
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((delta) => average([
      Number(delta.authority_score ?? 0),
      Number(delta.seo_coverage ?? 0),
      Number(delta.content_depth ?? 0),
    ]));
  const avgDelta = competitorDeltas.length > 0 ? average(competitorDeltas) : competitorPressure - 50;
  const marketPosition: 'below market' | 'at parity' | 'ahead' =
    avgDelta >= 6 ? 'below market' : avgDelta <= -4 ? 'ahead' : 'at parity';
  const marketPositionStatement = `${companyName} is currently ${marketPosition} relative to competitors in this market.`;
  const positionImplication =
    marketPosition === 'below market'
      ? 'If unchanged, this position will limit ability to compete for high-intent queries and reduce qualified demand capture.'
      : marketPosition === 'at parity'
        ? 'If unchanged, this position will maintain baseline visibility but make it hard to outpace stronger competitors in decision-stage queries.'
        : 'If unchanged, this position can hold near-term advantage, but weak reinforcement could erode lead as competitors increase depth.';
  const executionRisk =
    positioningStrength === 'weak'
      ? 'If content depth is not expanded alongside authority work, improvements may remain limited.'
      : marketType === 'saturated'
        ? 'If execution is fragmented across channels, gains will dilute and competitor pressure will outpace progress.'
        : 'If sequencing is inconsistent, visibility gains may appear but conversion lift can remain constrained.';
  const resilienceGuidance =
    'What ensures success: consistent content, authority, and structure alignment executed in the same priority sequence.';

  return {
    positioningStrength,
    positioningNarrative,
    positioningGap,
    marketType,
    marketNarrative,
    keySuccessFactor,
    strategyAlignment,
    marketPosition,
    marketPositionStatement,
    positionImplication,
    executionRisk,
    resilienceGuidance,
  };
}

export function resolverInputsPresent(resolvedInput?: ResolvedReportInput | null): number {
  if (!resolvedInput) return 0;

  let count = 0;
  if (resolvedInput.resolved.websiteDomain) count += 1;
  if (resolvedInput.resolved.businessType) count += 1;
  if (resolvedInput.resolved.geography) count += 1;
  if (resolvedInput.resolved.socialLinks.length > 0) count += 1;
  if (resolvedInput.resolved.competitors.length > 0) count += 1;
  return count;
}

export function isSeoDecision(decision: PersistedDecisionObject): boolean {
  return [
    'seo_gap',
    'ranking_gap',
    'ranking_opportunity',
    'keyword_decay',
    'keyword_opportunity',
    'impression_click_gap',
  ].includes(decision.issue_type);
}

export function isGeoDecision(decision: PersistedDecisionObject): boolean {
  return [
    'geo_gap',
    'geo_mismatch',
    'geo_opportunity',
    'regional_mismatch',
    'wrong_geo_traffic',
    'localized_content_gap',
  ].includes(decision.issue_type) || classifyDecisionType(decision.issue_type) === 'geo';
}

export function isCompetitorDecision(decision: PersistedDecisionObject): boolean {
  return [
    'competitor_gap',
    'competitor_dominance',
    'competitor_content_gap',
    'competitor_backlink_advantage',
  ].includes(decision.issue_type);
}

export function describeBusinessContext(resolvedInput?: ResolvedReportInput | null): string {
  const businessType = resolvedInput?.resolved.businessType?.trim();
  const geography = resolvedInput?.resolved.geography?.trim();

  if (businessType && geography) return `${businessType} in ${geography}`;
  if (businessType) return businessType;
  if (geography) return `teams targeting ${geography}`;
  return 'the business';
}

export function inferPrimarySurface(decision: PersistedDecisionObject, resolvedInput?: ResolvedReportInput | null): string {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const keyword = typeof payload.keyword === 'string' ? payload.keyword : null;
  const theme = typeof payload.keyword_theme === 'string' ? payload.keyword_theme : null;
  const domain = resolvedInput?.resolved.websiteDomain || 'your site';

  if (keyword) return `"${keyword}"`;
  if (theme) return `"${theme}"`;
  if (isAuthorityDecision(decision)) return `${domain}'s trust surface`;
  if (isContentDecision(decision)) return `${domain}'s core content coverage`;
  return domain;
}

export function signalKeyFromIssueType(issueType: string): string {
  const category = classifyDecisionType(issueType);
  if (category === 'authority' || category === 'trust') return 'authority_signal';
  if (category === 'content_strategy' || category === 'market') return 'content_coverage_signal';
  if (category === 'geo' || category === 'distribution') return 'geo_relevance_signal';
  if (category === 'opportunity') return 'opportunity_gap_signal';
  if (/(keyword|ranking|impression_click_gap|visibility|search)/.test(issueType)) return 'visibility_signal';
  return 'technical_signal';
}

export function evidenceSignalFromDecision(decision: PersistedDecisionObject): string {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
  const keyword =
    (typeof payload.keyword === 'string' && payload.keyword.trim()) ||
    (typeof payload.keyword_theme === 'string' && payload.keyword_theme.trim()) ||
    null;
  const avgPosition = typeof evidence.avg_position === 'number' ? evidence.avg_position : null;
  const mentionCount = typeof evidence.mention_count === 'number' ? evidence.mention_count : null;
  const baseSignal = signalKeyFromIssueType(decision.issue_type).replace(/_/g, ' ');

  if (keyword && avgPosition != null) return `${baseSignal}; ${keyword} avg position ${avgPosition.toFixed(1)}`;
  if (keyword && mentionCount != null) return `${baseSignal}; ${keyword} mentions ${mentionCount}`;
  if (keyword) return `${baseSignal}; keyword theme ${keyword}`;
  if (avgPosition != null) return `${baseSignal}; avg position ${avgPosition.toFixed(1)}`;
  if (mentionCount != null) return `${baseSignal}; mention count ${mentionCount}`;
  return baseSignal;
}

export function withEvidence(text: string, signal: string): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  return `${compact} This is supported by ${signal}.`;
}

export function buildWhyItMatters(decision: PersistedDecisionObject): string {
  const category = classifyDecisionType(decision.issue_type);
  const evidenceSignal = evidenceSignalFromDecision(decision);
  if (category === 'authority' || category === 'trust') {
    return withEvidence(
      'This directly affects whether buyers trust the brand enough to continue toward action.',
      evidenceSignal,
    );
  }
  if (category === 'content_strategy' || category === 'market') {
    return withEvidence(
      'This limits how often the business shows up for high-intent questions and comparison moments.',
      evidenceSignal,
    );
  }
  if (category === 'geo' || category === 'distribution') {
    return withEvidence(
      'This can cause the right audience to miss the offer or see it in the wrong context.',
      evidenceSignal,
    );
  }
  if (category === 'opportunity') {
    return withEvidence(
      'This is one of the clearest near-term gains available without requiring a full strategy reset.',
      evidenceSignal,
    );
  }
  return withEvidence(
    'This is shaping discoverability, buyer confidence, or conversion quality in the near term.',
    evidenceSignal,
  );
}

export function inferEffortLevel(decision: PersistedDecisionObject): 'low' | 'medium' | 'high' {
  const effort = Number(decision.effort_score ?? 0);
  if (effort <= 25) return 'low';
  if (effort <= 55) return 'medium';
  return 'high';
}
