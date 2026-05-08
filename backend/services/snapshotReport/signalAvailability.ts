import type { PersistedDecisionObject } from '../decisionObjectService';
import { classifyDecisionType } from '../decisionTypeRegistry';
import type { ResolvedReportInput } from '../reportInputResolver';
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
