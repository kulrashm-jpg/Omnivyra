import { classifyDecisionType } from '../decisionTypeRegistry';
import type { PersistedDecisionObject } from '../decisionObjectService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import type { PublicAuditResult } from '../publicDomainAuditService';
import type {
  CompanyNarrativeContext,
  SnapshotAction,
  SnapshotOpportunity,
  SnapshotReportSection,
  SnapshotSectionDefinition,
  StrategicContext,
} from '../snapshotReportTypes';

export const SNAPSHOT_SECTION_DEFINITIONS: SnapshotSectionDefinition[] = [
  {
    key: 'visibility',
    section_name: 'Visibility',
    IU_ids: ['SNAPSHOT-VISIBILITY'],
    matches: (decision) => /seo_gap|ranking_gap|ranking_opportunity|keyword_decay|keyword_opportunity|impression_click_gap/.test(decision.issue_type) || /geo_gap|geo_mismatch|geo_opportunity|regional_mismatch|wrong_geo_traffic|localized_content_gap/.test(decision.issue_type) || classifyDecisionType(decision.issue_type) === 'distribution',
  },
  {
    key: 'content_strength',
    section_name: 'Content Strength',
    IU_ids: ['SNAPSHOT-CONTENT'],
    matches: (decision) => /content_gap|topic_gap|weak_content_depth|weak_cluster_depth|missing_cluster_support|missing_supporting_content|competitor_content_gap|competitor_dominance/.test(decision.issue_type) || /competitor_gap|competitor_dominance|competitor_content_gap|competitor_backlink_advantage/.test(decision.issue_type) || classifyDecisionType(decision.issue_type) === 'market',
  },
  {
    key: 'authority',
    section_name: 'Authority',
    IU_ids: ['SNAPSHOT-AUTHORITY'],
    matches: (decision) => /authority_deficit|authority_gap|backlink_gap|weak_backlink_profile|trust_gap|credibility_gap|brand_trust_gap|weak_brand_presence|competitor_backlink_advantage/.test(decision.issue_type) || ['authority', 'trust'].includes(classifyDecisionType(decision.issue_type)),
  },
];

function sectionSeedDecision(
  sectionKey: SnapshotSectionDefinition['key'],
  decisions: PersistedDecisionObject[],
): PersistedDecisionObject[] {
  if (decisions.length > 0) return decisions;
  if (sectionKey === 'visibility') return decisions;
  return decisions;
}

export function ensureSectionFloor(params: {
  section: SnapshotReportSection;
  fallbackPool: PersistedDecisionObject[];
  sectionDefinition: SnapshotSectionDefinition;
  companyContext?: CompanyNarrativeContext;
  strategicContext?: StrategicContext;
  recommendationContext?: {
    publicAudit?: PublicAuditResult | null;
    competitorIntelligence?: CompetitorIntelligenceResult | null;
    authorityScore?: number | null;
    contentQualityScore?: number | null;
    aiVisibilityScore?: number | null;
  };
  toInsight: (decision: PersistedDecisionObject, companyContext?: CompanyNarrativeContext) => SnapshotReportSection['insights'][number];
  toAction: (
    decision: PersistedDecisionObject,
    companyContext?: CompanyNarrativeContext,
    strategicContext?: StrategicContext,
    recommendationContext?: {
      publicAudit?: PublicAuditResult | null;
      competitorIntelligence?: CompetitorIntelligenceResult | null;
      authorityScore?: number | null;
      contentQualityScore?: number | null;
      aiVisibilityScore?: number | null;
    },
  ) => SnapshotAction;
  toOpportunity: (decision: PersistedDecisionObject) => SnapshotOpportunity;
  isOpportunityCandidate: (decision: PersistedDecisionObject) => boolean;
}): SnapshotReportSection {
  const seeded = sectionSeedDecision(
    params.sectionDefinition.key,
    params.fallbackPool.filter(params.sectionDefinition.matches),
  );

  if (seeded.length === 0) return params.section;

  const existingIds = new Set(params.section.insights.map((item) => item.decision_id));
  const nextInsights = [...params.section.insights];
  const nextOpportunities = [...params.section.opportunities];
  const nextActions = [...params.section.actions];

  for (const decision of seeded) {
    if (!existingIds.has(decision.id)) {
      nextInsights.push(params.toInsight(decision, params.companyContext));
      existingIds.add(decision.id);
    }
    if (nextActions.length < 2) {
      nextActions.push(params.toAction(decision, params.companyContext, params.strategicContext, params.recommendationContext));
    }
    if (nextOpportunities.length < 1 && params.isOpportunityCandidate(decision)) {
      nextOpportunities.push(params.toOpportunity(decision));
    }
  }

  return {
    ...params.section,
    insights: nextInsights.slice(0, 4),
    opportunities: nextOpportunities.slice(0, 2),
    actions: nextActions.slice(0, 3),
  };
}

export function capSignalReuseAcrossSections(
  sections: SnapshotReportSection[],
  signalKeyFromIssueType: (issueType: string) => string,
  maxPerSignal = 2,
): SnapshotReportSection[] {
  const signalCounts = new Map<string, number>();
  const canUseSignal = (signal: string): boolean => {
    const current = signalCounts.get(signal) ?? 0;
    if (current >= maxPerSignal) return false;
    signalCounts.set(signal, current + 1);
    return true;
  };

  return sections.map((section) => {
    const nextInsights = section.insights.filter((insight) => canUseSignal(signalKeyFromIssueType(insight.issue_type)));
    const nextActions = section.actions.filter((action) => canUseSignal(`${action.action_type || 'generic_action_signal'}_action`));
    const nextOpportunities = section.opportunities.filter((opportunity) => canUseSignal(`${opportunity.action_type || 'generic_opportunity_signal'}_opportunity`));
    return {
      ...section,
      insights: nextInsights,
      opportunities: nextOpportunities,
      actions: nextActions,
    };
  });
}

export function capActionMentionsAcrossSections(
  sections: SnapshotReportSection[],
  maxMentionsPerActionTitle = 1,
): SnapshotReportSection[] {
  const titleCounts = new Map<string, number>();
  return sections.map((section) => {
    const nextActions = section.actions.filter((action) => {
      const key = action.title.toLowerCase().trim();
      const current = titleCounts.get(key) ?? 0;
      if (current >= maxMentionsPerActionTitle) return false;
      titleCounts.set(key, current + 1);
      return true;
    });
    return {
      ...section,
      actions: nextActions,
    };
  });
}
