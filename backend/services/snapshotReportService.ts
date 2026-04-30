import {
  composeDecisionIntelligence,
  type ComposedDecisionInsight,
} from './decisionComposerService';
import type { PersistedDecisionObject } from './decisionObjectService';
import { classifyDecisionType } from './decisionTypeRegistry';
import type { ReportReadinessResult } from './reportReadinessService';
import type { ResolvedReportInput } from './reportInputResolver';
import { impactScore, rankByImpactConfidence } from './reportDecisionUtils';
import {
  buildCompetitorIntelligence,
  buildCompetitorIntelligenceActive,
  competitorGapsToDecisions,
  enforceFinalCompetitorIntelligenceSync,
  type CompetitorIntelligenceResult,
} from './reportCompetitorIntelligenceService';
import { buildPublicDomainAuditDecisions, type PublicAuditResult } from './publicDomainAuditService';
import {
  synthesizePrimaryNarrative,
  type PrimaryNarrative,
} from './primaryNarrativeService';
import { buildDecisionBusinessImpact } from './businessImpactFormatter';
import {
  buildExpectedUpside,
  classifyPriorityType,
  type PriorityType,
} from './actionPriorityService';
import { buildReportScoreModel } from './reportScoreModelService';
import {
  average,
  clamp,
  getTone,
  hasConcreteSignal,
  nowIso,
  toneImpactWord,
} from './snapshotReportNarrativeHelpers';
import {
  buildActionPlan,
  toAction,
} from './snapshotReport/actionPlanBuilder';
import {
  assessPositioningAndMarket,
  evidenceSignalFromDecision,
  inferEffortLevel,
  isCompetitorDecision,
  resolverInputsPresent,
  signalKeyFromIssueType,
  toInsight,
  toOpportunity,
  uniqueById,
} from './snapshotReport/actionHelpers';
import {
  inferStructuredActionTrack,
  isContentDecision,
  isOpportunityCandidate,
} from './snapshotReport/actionTacticHelpers';
import {
  createNarrativeContext,
  extractCompanyNarrativeContext,
} from './snapshotReport/narrativeHelpers';
import {
  buildDecisionSnapshot,
  buildDiagnosis,
  buildSummary,
  buildTopPriorities,
  normalizeCoreProblem,
  sortSectionActions,
} from './snapshotReport/summaryDecisionHelpers';
import {
  capActionMentionsAcrossSections,
  capSignalReuseAcrossSections,
  ensureSectionFloor,
  SNAPSHOT_SECTION_DEFINITIONS,
} from './snapshotReport/sectionAssemblyHelpers';
import {
  ensureSnapshotDecisionFloor as ensureSnapshotDecisionFloorInternal,
  signalAvailabilityFromDecisions,
} from './snapshotReport/floorHelpers';
export { ensureSnapshotDecisionFloor } from './snapshotReport/floorHelpers';
import {
  buildGeoAeoExecutiveSummary,
  buildGeoAeoVisuals,
} from './snapshotReport/geoAeoSummaryHelpers';
import { buildSeoExecutiveSummary } from './snapshotReport/seoExecutiveSummaryHelpers';
import {
  buildCompetitorIntelligenceSummary,
  buildCompetitorVisuals,
} from './snapshotReport/competitorSummaryHelpers';
import { buildUnifiedIntelligenceSummary } from './snapshotReport/unifiedSummaryHelpers';
import { buildSnapshotVisualIntelligence } from './snapshotReport/visualIntelligenceHelpers';
import {
  SIGNAL_BUCKETS,
  type CompanyNarrativeContext,
  type MarketType,
  type NarrativeContext,
  type NarrativeSection,
  type PositioningStrength,
  type SnapshotAction,
  type SnapshotInsight,
  type SnapshotOpportunity,
  type SnapshotReport,
  type SnapshotReportOptions,
  type SnapshotReportSection,
  type SnapshotSectionDefinition,
  type StrategicContext,
} from './snapshotReportTypes';

const SNAPSHOT_MIN_INSIGHTS = 3;
const SNAPSHOT_MIN_ACTIONS = 2;

function mapIssueToExecutiveArea(issueType: string): 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility' {
  if (/(backlink|authority)/.test(issueType)) return 'backlinks';
  if (/(keyword|ranking|impression_click_gap)/.test(issueType)) return 'keywords';
  if (/(content|topic|cluster|weak_content_depth)/.test(issueType)) return 'content';
  if (/(geo|distribution|search|seo_gap)/.test(issueType)) return 'visibility';
  return 'technical_seo';
}

function severityLabel(score: number): 'critical' | 'moderate' | 'low' {
  if (score >= 75) return 'critical';
  if (score >= 45) return 'moderate';
  return 'low';
}

function impactBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function executivePriorityBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 72) return 'high';
  if (score >= 48) return 'medium';
  return 'low';
}

export function composeSnapshotReportFromDecisions(params: {
  companyId: string;
  snapshotDecisions: PersistedDecisionObject[];
  supplementalGrowthDecisions?: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
  readiness?: ReportReadinessResult | null;
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
  competitorIntelligenceOverride?: CompetitorIntelligenceResult | null;
}): SnapshotReport {
  const supplementalGrowthDecisions = params.supplementalGrowthDecisions ?? [];
  const baseCombined = uniqueById([...params.snapshotDecisions, ...supplementalGrowthDecisions]);
  const competitorIntelligence = enforceFinalCompetitorIntelligenceSync({
    result: params.competitorIntelligenceOverride ?? buildCompetitorIntelligence({
      decisions: baseCombined,
      resolvedInput: params.resolvedInput,
    }),
    resolvedInput: params.resolvedInput,
  });
  const competitorDecisions = competitorGapsToDecisions({
    companyId: params.companyId,
    gaps: competitorIntelligence.generated_gaps,
    reportTier: 'snapshot',
  });
  const combined = uniqueById([...baseCombined, ...competitorDecisions]);
  const floor = ensureSnapshotDecisionFloorInternal({
    companyId: params.companyId,
    decisions: combined,
    resolvedInput: params.resolvedInput,
    minInsights: SNAPSHOT_MIN_INSIGHTS,
  });
  const finalDecisions = floor.decisions;
  const signalAvailability = signalAvailabilityFromDecisions({
    decisions: finalDecisions,
    resolvedInput: params.resolvedInput,
  });
  const companyContext = extractCompanyNarrativeContext({
    resolvedInput: params.resolvedInput,
  });
  const strategicContext = assessPositioningAndMarket({
    companyContext,
    competitorIntelligence,
    decisions: finalDecisions,
    publicAudit: params.publicAudit ?? null,
  });
  const narrative = synthesizePrimaryNarrative(finalDecisions);
  const coreProblem = normalizeCoreProblem(narrative.primary_problem);
  const diagnosis = buildDiagnosis({
    narrative,
    companyContext,
    strategicContext,
  });
  const score = buildReportScoreModel({
    decisions: finalDecisions,
    resolvedInput: params.resolvedInput,
    competitorIntelligence,
  });
  const narrativeContext = createNarrativeContext();
  const visualIntelligence = buildSnapshotVisualIntelligence({
    decisions: finalDecisions,
    score,
    competitorIntelligence,
    publicAudit: params.publicAudit ?? null,
    narrativeContext,
  });
  const geoAeoVisuals = buildGeoAeoVisuals({
    publicAudit: params.publicAudit ?? null,
  });
  const geoAeoExecutiveSummary = buildGeoAeoExecutiveSummary({
    geoAeoVisuals,
  });
  const recommendationContext = {
    publicAudit: params.publicAudit ?? null,
    competitorIntelligence,
    authorityScore: visualIntelligence.seo_capability_radar.backlinks_score,
    contentQualityScore: visualIntelligence.seo_capability_radar.content_quality_score,
    aiVisibilityScore: geoAeoExecutiveSummary.overall_ai_visibility_score,
  };

  let sections = SNAPSHOT_SECTION_DEFINITIONS.map((definition) => {
    const sectionDecisions = finalDecisions
      .filter(definition.matches)
      .sort(rankByImpactConfidence);

    return {
      section_name: definition.section_name,
      IU_ids: definition.IU_ids,
      insights: sectionDecisions.slice(0, 4).map((decision) => toInsight(decision, companyContext)),
      opportunities: sectionDecisions.filter(isOpportunityCandidate).slice(0, 2).map(toOpportunity),
      actions: sortSectionActions(sectionDecisions.slice(0, 3).map((decision) => toAction(decision, companyContext, strategicContext, recommendationContext))),
    } satisfies SnapshotReportSection;
  });

  sections = sections.map((section, index) => {
    const ensured = ensureSectionFloor({
      section,
      fallbackPool: finalDecisions,
      sectionDefinition: SNAPSHOT_SECTION_DEFINITIONS[index],
      companyContext,
      strategicContext,
      recommendationContext,
      toInsight,
      toAction,
      toOpportunity,
      isOpportunityCandidate,
    });
    return {
      ...ensured,
      actions: sortSectionActions(ensured.actions),
    };
  });

  let totalInsights = sections.reduce((sum, section) => sum + section.insights.length, 0);
  let totalActions = sections.reduce((sum, section) => sum + section.actions.length, 0);

  if (totalInsights < SNAPSHOT_MIN_INSIGHTS && sections.length > 0) {
    const existingIds = new Set(sections.flatMap((section) => section.insights.map((item) => item.decision_id)));
    const signalCounts = new Map<string, number>();
    for (const section of sections) {
      for (const insight of section.insights) {
        const key = signalKeyFromIssueType(insight.issue_type);
        signalCounts.set(key, (signalCounts.get(key) ?? 0) + 1);
      }
    }
    for (const decision of finalDecisions) {
      if (existingIds.has(decision.id)) continue;
      const signalKey = signalKeyFromIssueType(decision.issue_type);
      if ((signalCounts.get(signalKey) ?? 0) >= 2) continue;
      sections[0].insights.push(toInsight(decision, companyContext));
      existingIds.add(decision.id);
      signalCounts.set(signalKey, (signalCounts.get(signalKey) ?? 0) + 1);
      totalInsights += 1;
      if (totalInsights >= SNAPSHOT_MIN_INSIGHTS) break;
    }
  }

  if (totalActions < SNAPSHOT_MIN_ACTIONS && sections.length > 0) {
    const existingIds = new Set(sections.flatMap((section) => section.actions.map((item) => item.decision_id)));
    for (const decision of finalDecisions) {
      if (existingIds.has(decision.id)) continue;
      sections[0].actions.push(toAction(decision, companyContext, strategicContext, recommendationContext));
      existingIds.add(decision.id);
      totalActions += 1;
      if (totalActions >= SNAPSHOT_MIN_ACTIONS) break;
    }
    sections[0].actions = sortSectionActions(sections[0].actions);
  }

  sections = capSignalReuseAcrossSections(sections, signalKeyFromIssueType, 2);
  sections = capActionMentionsAcrossSections(sections, 1);
  totalInsights = sections.reduce((sum, section) => sum + section.insights.length, 0);
  totalActions = sections.reduce((sum, section) => sum + section.actions.length, 0);

  if (totalInsights < SNAPSHOT_MIN_INSIGHTS && sections.length > 0) {
    const existingIds = new Set(sections.flatMap((section) => section.insights.map((item) => item.decision_id)));
    for (const decision of finalDecisions) {
      if (existingIds.has(decision.id)) continue;
      sections[0].insights.push(toInsight(decision, companyContext));
      existingIds.add(decision.id);
      totalInsights += 1;
      if (totalInsights >= SNAPSHOT_MIN_INSIGHTS) break;
    }
  }

  if (totalActions < SNAPSHOT_MIN_ACTIONS && sections.length > 0) {
    const existingIds = new Set(sections.flatMap((section) => section.actions.map((item) => item.decision_id)));
    for (const decision of finalDecisions) {
      if (existingIds.has(decision.id)) continue;
      sections[0].actions.push(toAction(decision, companyContext, strategicContext, recommendationContext));
      existingIds.add(decision.id);
      totalActions += 1;
      if (totalActions >= SNAPSHOT_MIN_ACTIONS) break;
    }
    sections[0].actions = sortSectionActions(sections[0].actions);
  }

  const topPriorities = buildTopPriorities(sections);
  const summary = buildSummary({
    sections,
    signalAvailability,
    competitorIntelligence,
    narrative,
    readiness: params.readiness,
    topPriorityTitle: topPriorities[0]?.title ?? null,
    coreProblem,
    companyContext,
  });
  const seoExecutiveSummary = buildSeoExecutiveSummary({
    decisions: finalDecisions,
    score,
    visualIntelligence,
    topPriorities,
    companyContext,
    strategicContext,
    publicAudit: params.publicAudit ?? null,
    competitorIntelligence,
    geoAeoSummary: geoAeoExecutiveSummary,
    mapIssueToExecutiveArea,
    severityLabel,
    impactBand,
    executivePriorityBand,
    evidenceSignalFromDecision,
    inferEffortLevel,
    inferStructuredActionTrack,
    buildActionPlan,
  });
  const unifiedIntelligenceSummary = buildUnifiedIntelligenceSummary({
    coreProblem,
    seoSummary: seoExecutiveSummary,
    geoAeoSummary: geoAeoExecutiveSummary,
    narrativeContext,
  });
  const competitorVisuals = buildCompetitorVisuals({
    competitorIntelligence,
    visualIntelligence,
    geoAeoVisuals,
    decisions: finalDecisions,
  });
  const competitorIntelligenceSummary = buildCompetitorIntelligenceSummary({
    competitorIntelligence,
    competitorVisuals,
    narrativeContext,
  });
  const decisionSnapshot = buildDecisionSnapshot({
    diagnosis,
    coreProblem,
    companyContext,
    strategicContext,
    signalAvailability,
    unifiedSummary: unifiedIntelligenceSummary,
    seoSummary: seoExecutiveSummary,
    geoAeoSummary: geoAeoExecutiveSummary,
    competitorSummary: competitorIntelligenceSummary,
    competitorIntelligence,
    topPriorities,
  });

  return {
    report_type: 'snapshot',
    score,
    diagnosis,
    summary,
    primary_problem: coreProblem,
    secondary_problems: narrative.secondary_problems.slice(0, 2),
    seo_executive_summary: seoExecutiveSummary,
    geo_aeo_visuals: geoAeoVisuals,
    geo_aeo_executive_summary: geoAeoExecutiveSummary,
    unified_intelligence_summary: unifiedIntelligenceSummary,
    competitor_visuals: competitorVisuals,
    competitor_intelligence_summary: competitorIntelligenceSummary,
    visual_intelligence: visualIntelligence,
    signal_availability: signalAvailability,
    company_context: {
      company_name: companyContext.companyName,
      domain: companyContext.domain,
      homepage_headline: companyContext.homepageHeadline,
      tagline: companyContext.tagline,
      primary_offering: companyContext.primaryOffering,
      positioning: companyContext.positioning,
      market_context: companyContext.marketContext,
      logo_url: companyContext.logoUrl,
      favicon_url: companyContext.faviconUrl,
      positioning_strength: strategicContext.positioningStrength,
      positioning_narrative: strategicContext.positioningNarrative,
      positioning_gap: strategicContext.positioningGap,
      market_type: strategicContext.marketType,
      market_narrative: strategicContext.marketNarrative,
      strategy_alignment: strategicContext.strategyAlignment,
      market_position: strategicContext.marketPosition,
      market_position_statement: strategicContext.marketPositionStatement,
      position_implication: strategicContext.positionImplication,
      execution_risk: strategicContext.executionRisk,
      resilience_guidance: strategicContext.resilienceGuidance,
    },
    competitor_intelligence: competitorIntelligence,
    decision_snapshot: decisionSnapshot,
    top_priorities: topPriorities,
    pipeline_audit: {
      resolver_inputs_present: resolverInputsPresent(params.resolvedInput),
      snapshot_decisions: params.snapshotDecisions.length,
      supplemental_growth_decisions: supplementalGrowthDecisions.length,
      competitor_gap_decisions_added: competitorDecisions.length,
      fallback_decisions_added: floor.fallbackAdded,
      final_decisions: finalDecisions.length,
      final_insights: sections.reduce((sum, section) => sum + section.insights.length, 0),
      final_actions: sections.reduce((sum, section) => sum + section.actions.length, 0),
    },
    sections,
  };
}

export async function composeSnapshotReport(
  companyId: string,
  options?: SnapshotReportOptions,
): Promise<SnapshotReport> {
  const [snapshotComposition, growthComposition] = await Promise.all([
    composeDecisionIntelligence({
      companyId,
      reportTier: 'snapshot',
      status: ['open'],
    }),
    composeDecisionIntelligence({
      companyId,
      reportTier: 'growth',
      status: ['open'],
    }),
  ]);

  const growthSupplement = growthComposition.decisions.filter((decision) => {
    const category = classifyDecisionType(decision.issue_type);
    return category === 'authority' || category === 'trust' || category === 'geo' || isContentDecision(decision) || isCompetitorDecision(decision);
  });
  const publicAudit = await buildPublicDomainAuditDecisions({
    companyId,
    reportTier: 'snapshot',
    resolvedInput: options?.resolvedInput ?? null,
  });
  const activeCompetitorIntelligence = await buildCompetitorIntelligenceActive({
    companyId,
    decisions: uniqueById([...snapshotComposition.decisions, ...growthSupplement, ...publicAudit.decisions]),
    resolvedInput: options?.resolvedInput ?? null,
  });

  return composeSnapshotReportFromDecisions({
    companyId,
    snapshotDecisions: [...snapshotComposition.decisions, ...publicAudit.decisions],
    supplementalGrowthDecisions: growthSupplement,
    resolvedInput: options?.resolvedInput ?? null,
    readiness: options?.readiness ?? null,
    publicAudit,
    competitorIntelligenceOverride: activeCompetitorIntelligence,
  });
}

export function createSnapshotInsightsFromComposition(insights: ComposedDecisionInsight[]): SnapshotInsight[] {
  return insights.map((insight) => ({
    decision_id: insight.decision_id,
    title: insight.title,
    description: insight.description,
    why_it_matters: '',
    issue_type: insight.issue_type,
    confidence_score: insight.confidence_score,
    impact_score: insight.impact_score,
    recommendation: insight.recommendation,
    action_type: insight.action_type,
    business_impact: insight.business_impact || '',
  }));
}
