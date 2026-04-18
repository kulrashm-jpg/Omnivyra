import type { PersistedDecisionObject } from '../decisionObjectService';
import { classifyDecisionType } from '../decisionTypeRegistry';
import type { ResolvedReportInput } from '../reportInputResolver';
import { rankByImpactConfidence } from '../reportDecisionUtils';
import { clamp, nowIso } from '../snapshotReportNarrativeHelpers';
import type { SignalAvailabilityLevel, SnapshotSignalKey } from '../snapshotReportTypes';

function isSeoDecision(decision: PersistedDecisionObject): boolean {
  return [
    'seo_gap',
    'ranking_gap',
    'ranking_opportunity',
    'keyword_decay',
    'keyword_opportunity',
    'impression_click_gap',
  ].includes(decision.issue_type);
}

function isContentDecision(decision: PersistedDecisionObject): boolean {
  return [
    'content_gap',
    'topic_gap',
    'weak_content_depth',
    'weak_cluster_depth',
    'missing_cluster_support',
    'missing_supporting_content',
    'competitor_content_gap',
    'competitor_dominance',
  ].includes(decision.issue_type) || classifyDecisionType(decision.issue_type) === 'content_strategy';
}

function isAuthorityDecision(decision: PersistedDecisionObject): boolean {
  return [
    'authority_deficit',
    'authority_gap',
    'backlink_gap',
    'weak_backlink_profile',
    'trust_gap',
    'credibility_gap',
    'brand_trust_gap',
    'weak_brand_presence',
    'competitor_backlink_advantage',
  ].includes(decision.issue_type) || ['authority', 'trust'].includes(classifyDecisionType(decision.issue_type));
}

function isGeoDecision(decision: PersistedDecisionObject): boolean {
  return [
    'geo_gap',
    'geo_mismatch',
    'geo_opportunity',
    'regional_mismatch',
    'wrong_geo_traffic',
    'localized_content_gap',
  ].includes(decision.issue_type) || classifyDecisionType(decision.issue_type) === 'geo';
}

function isCompetitorDecision(decision: PersistedDecisionObject): boolean {
  return [
    'competitor_gap',
    'competitor_dominance',
    'competitor_content_gap',
    'competitor_backlink_advantage',
  ].includes(decision.issue_type);
}

function describeBusinessContext(resolvedInput?: ResolvedReportInput | null): string {
  const businessType = resolvedInput?.resolved.businessType?.trim();
  const geography = resolvedInput?.resolved.geography?.trim();

  if (businessType && geography) return `${businessType} in ${geography}`;
  if (businessType) return businessType;
  if (geography) return `teams targeting ${geography}`;
  return 'the business';
}

export function signalAvailabilityFromDecisions(params: {
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): Record<SnapshotSignalKey, SignalAvailabilityLevel> {
  const { decisions, resolvedInput } = params;
  const seoCount = decisions.filter(isSeoDecision).length;
  const contentCount = decisions.filter(isContentDecision).length;
  const authorityCount = decisions.filter(isAuthorityDecision).length;
  const geoCount = decisions.filter(isGeoDecision).length;
  const competitorCount = decisions.filter(isCompetitorDecision).length;

  const domainPresent = Boolean(resolvedInput?.resolved.websiteDomain);
  const socialPresent = (resolvedInput?.resolved.socialLinks.length ?? 0) > 0;
  const geographyPresent = Boolean(resolvedInput?.resolved.geography);
  const competitorPresent = (resolvedInput?.resolved.competitors.length ?? 0) > 0;

  return {
    seo_structure: seoCount >= 2 ? 'NORMAL' : seoCount === 1 || domainPresent ? 'LOW_DATA' : 'NO_DATA',
    content_coverage:
      contentCount >= 2
        ? 'NORMAL'
        : contentCount === 1 || domainPresent || socialPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
    authority:
      authorityCount >= 1
        ? 'NORMAL'
        : socialPresent || domainPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
    competitor:
      competitorCount >= 1 || competitorPresent
        ? 'NORMAL'
        : domainPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
    geo_relevance:
      geoCount >= 1
        ? 'NORMAL'
        : geographyPresent || domainPresent
          ? 'LOW_DATA'
          : 'NO_DATA',
  };
}

function syntheticDecision(params: {
  companyId: string;
  issueType: PersistedDecisionObject['issue_type'];
  title: string;
  description: string;
  recommendation: string;
  actionType: PersistedDecisionObject['action_type'];
  actionPayload: Record<string, unknown>;
  impactTraffic: number;
  impactConversion: number;
  impactRevenue: number;
  priorityScore: number;
  confidenceScore: number;
}): PersistedDecisionObject {
  const now = nowIso();
  return {
    id: `synthetic_${params.issueType}_${Math.random().toString(36).slice(2, 10)}`,
    company_id: params.companyId,
    report_tier: 'snapshot',
    source_service: 'snapshotFallbackService',
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: params.description,
    evidence: {
      synthetic: true,
      generated_at: now,
    },
    impact_traffic: params.impactTraffic,
    impact_conversion: params.impactConversion,
    impact_revenue: params.impactRevenue,
    priority_score: params.priorityScore,
    effort_score: 24,
    execution_score: clamp(
      params.priorityScore * 0.62 + Math.max(params.impactTraffic, params.impactConversion, params.impactRevenue) * 0.38,
      0,
      100,
    ),
    confidence_score: params.confidenceScore,
    recommendation: params.recommendation,
    action_type: params.actionType,
    action_payload: params.actionPayload,
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  };
}

export function buildSnapshotBaselineDecisions(params: {
  companyId: string;
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
}): PersistedDecisionObject[] {
  const signalAvailability = signalAvailabilityFromDecisions(params);
  const fallbacks: PersistedDecisionObject[] = [];
  const domain = params.resolvedInput?.resolved.websiteDomain ?? 'your site';
  const contextLabel = describeBusinessContext(params.resolvedInput);
  const geography = params.resolvedInput?.resolved.geography ?? 'your highest-value market';

  if (!params.decisions.some(isSeoDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'seo_gap',
        title: `${domain} is not yet visible enough to generate dependable discovery`,
        description: `We do not yet have enough durable SEO signal around ${domain} for ${contextLabel}, which usually means discoverability is being left to chance rather than engineered through search coverage.`,
        recommendation: `Build a simple search foundation for ${domain}: one sharpened homepage promise, one core service page, and one high-intent educational page tied to ${geography}.`,
        actionType: 'improve_content',
        actionPayload: { optimization_focus: 'snapshot_seo_baseline', domain },
        impactTraffic: 62,
        impactConversion: 34,
        impactRevenue: 28,
        priorityScore: signalAvailability.seo_structure === 'NO_DATA' ? 68 : 58,
        confidenceScore: signalAvailability.seo_structure === 'NO_DATA' ? 0.74 : 0.68,
      }),
    );
  }

  if (!params.decisions.some(isContentDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'content_gap',
        title: `${domain} does not yet cover enough of the questions buyers ask before choosing`,
        description: `The current signal set suggests there is not enough topic coverage, depth, or supporting content for ${contextLabel} to turn interest into repeat discovery and trust.`,
        recommendation: `Prioritize a small content spine for ${domain}: one authority page, one comparison/problem page, and one proof-driven article tied to buyer intent in ${geography}.`,
        actionType: 'improve_content',
        actionPayload: { optimization_focus: 'snapshot_content_coverage' },
        impactTraffic: 54,
        impactConversion: 42,
        impactRevenue: 32,
        priorityScore: 63,
        confidenceScore: 0.76,
      }),
    );
  }

  if (!params.decisions.some(isAuthorityDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'authority_deficit',
        title: `${domain} lacks enough proof to reinforce buyer confidence`,
        description: `Even if people discover ${domain}, there are not enough visible proof signals, trust markers, or authority assets to consistently convert interest into action for ${contextLabel}.`,
        recommendation: `Add proof assets that compress trust quickly for ${domain}: case studies, testimonials, founder/expert credibility, and visible outcome claims.`,
        actionType: 'adjust_strategy',
        actionPayload: { optimization_focus: 'snapshot_authority_baseline' },
        impactTraffic: 34,
        impactConversion: 56,
        impactRevenue: 46,
        priorityScore: 61,
        confidenceScore: 0.73,
      }),
    );
  }

  if (signalAvailability.competitor !== 'NORMAL' && !params.decisions.some(isCompetitorDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'competitor_gap',
        title: `Competitive positioning for ${domain} is unclear because no baseline is being tracked`,
        description: `Without a visible competitor set for ${contextLabel}, it is difficult to tell whether weak performance is a market problem, a messaging problem, or simply a positioning gap.`,
        recommendation: `Track 3 direct competitors serving ${geography} and compare offers, messaging promises, and search topics so the next report can show concrete positioning gaps.`,
        actionType: 'adjust_strategy',
        actionPayload: { optimization_focus: 'snapshot_competitor_tracking' },
        impactTraffic: 28,
        impactConversion: 38,
        impactRevenue: 34,
        priorityScore: signalAvailability.competitor === 'NO_DATA' ? 57 : 49,
        confidenceScore: 0.66,
      }),
    );
  }

  if (signalAvailability.geo_relevance === 'NO_DATA' && !params.decisions.some(isGeoDecision)) {
    fallbacks.push(
      syntheticDecision({
        companyId: params.companyId,
        issueType: 'geo_gap',
        title: `Regional relevance for ${domain} is unclear, which can hide demand-quality problems`,
        description: `We do not yet have enough geographic signal to tell whether the current positioning for ${contextLabel} matches the market you most want to win.`,
        recommendation: `Define ${geography} as the first market to win and align messaging, examples, and proof so ${domain} reads as locally relevant there.`,
        actionType: 'fix_distribution',
        actionPayload: { optimization_focus: 'snapshot_geo_clarity' },
        impactTraffic: 31,
        impactConversion: 33,
        impactRevenue: 29,
        priorityScore: 46,
        confidenceScore: 0.61,
      }),
    );
  }

  return fallbacks;
}

export function ensureSnapshotDecisionFloor(params: {
  companyId: string;
  decisions: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
  minInsights: number;
}): { decisions: PersistedDecisionObject[]; fallbackAdded: number } {
  const uniqueDecisions = new Map(params.decisions.map((decision) => [decision.id, decision]));
  const baseline = buildSnapshotBaselineDecisions({
    companyId: params.companyId,
    decisions: [...uniqueDecisions.values()],
    resolvedInput: params.resolvedInput,
  });

  const needed = Math.max(0, params.minInsights - uniqueDecisions.size);
  const selectedBaseline = baseline.slice(0, Math.max(needed, Math.min(3, baseline.length)));
  const finalDecisions = new Map([...uniqueDecisions.values(), ...selectedBaseline].map((decision) => [decision.id, decision]));

  return {
    decisions: [...finalDecisions.values()].sort(rankByImpactConfidence),
    fallbackAdded: selectedBaseline.length,
  };
}
