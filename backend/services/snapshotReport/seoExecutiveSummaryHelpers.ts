import type { PersistedDecisionObject } from '../decisionObjectService';
import { impactScore } from '../reportDecisionUtils';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import type { PublicAuditResult } from '../publicDomainAuditService';
import type { buildReportScoreModel } from '../reportScoreModelService';
import type {
  CompanyNarrativeContext,
  SnapshotReport,
  SnapshotTopPriority,
  StrategicContext,
} from '../snapshotReportTypes';

type StructuredActionTrack = 'authority' | 'positioning' | 'comparison' | 'generic';

export function buildSeoExecutiveSummary(params: {
  decisions: PersistedDecisionObject[];
  score: ReturnType<typeof buildReportScoreModel>;
  visualIntelligence: SnapshotReport['visual_intelligence'];
  topPriorities: SnapshotTopPriority[];
  companyContext?: CompanyNarrativeContext;
  strategicContext?: StrategicContext;
  publicAudit?: PublicAuditResult | null;
  competitorIntelligence: CompetitorIntelligenceResult;
  geoAeoSummary: SnapshotReport['geo_aeo_executive_summary'];
  mapIssueToExecutiveArea: (issueType: string) => 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
  severityLabel: (score: number) => 'critical' | 'moderate' | 'low';
  impactBand: (score: number) => 'high' | 'medium' | 'low';
  executivePriorityBand: (score: number) => 'high' | 'medium' | 'low';
  evidenceSignalFromDecision: (decision: PersistedDecisionObject) => string;
  inferEffortLevel: (decision: PersistedDecisionObject) => 'low' | 'medium' | 'high';
  inferStructuredActionTrack: (params: {
    issueType?: string;
    actionType?: string;
    title?: string;
    recommendation?: string;
    optimizationFocus?: string;
    tactics?: string[];
  }) => StructuredActionTrack;
  buildActionPlan: (
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
  ) => {
    title: string;
    reasoning: string;
    tactics: string[];
    focusPage: string;
    timeline: { short: string; mid: string; long: string };
    impact: 'high' | 'medium' | 'low';
    confidence: number;
  };
}): SnapshotReport['seo_executive_summary'] {
  const technicalScore = params.visualIntelligence.seo_capability_radar.technical_seo_score;
  const visibilityScore = params.visualIntelligence.seo_capability_radar.rank_tracking_score;
  const contentScore = params.visualIntelligence.seo_capability_radar.content_quality_score;
  const authorityScore = params.visualIntelligence.seo_capability_radar.backlinks_score;

  const healthComponents = [technicalScore, visibilityScore, contentScore, authorityScore]
    .filter((value): value is number => typeof value === 'number');
  const overallHealthScore = healthComponents.length > 0
    ? Math.round(
        healthComponents.reduce((sum, value, index) => {
          const weight = [0.28, 0.3, 0.24, 0.18][index] ?? 0.25;
          return sum + value * weight;
        }, 0) / ([0.28, 0.3, 0.24, 0.18].slice(0, healthComponents.length).reduce((sum, value) => sum + value, 0))
      )
    : params.score.value;

  const sortedDecisions = [...params.decisions].sort((left, right) => impactScore(right) - impactScore(left));
  const topDecision = sortedDecisions[0];
  const bestOpportunity = [...params.visualIntelligence.opportunity_coverage_matrix.opportunities]
    .sort((left, right) => Number(right.opportunity_value_score ?? right.opportunity_score) - Number(left.opportunity_value_score ?? left.opportunity_score))[0];
  const funnelLostClicks = params.visualIntelligence.search_visibility_funnel.estimated_lost_clicks;

  const primaryProblem = topDecision
    ? {
        title: topDecision.title,
        impacted_area: params.mapIssueToExecutiveArea(topDecision.issue_type),
        severity: params.severityLabel(impactScore(topDecision)),
        reasoning: `${topDecision.description} Backlink, crawl, and intent signals indicate ${params.evidenceSignalFromDecision(topDecision)}.`,
        if_not_addressed: 'If not addressed, visibility gains from new pages will remain constrained and conversion efficiency will continue to underperform.',
      }
    : bestOpportunity
      ? {
          title: `Search opportunity around ${bestOpportunity.keyword} is being under-captured`,
          impacted_area: 'keywords' as const,
          severity: params.severityLabel(bestOpportunity.opportunity_score),
          reasoning: `Coverage is currently ${bestOpportunity.coverage_score}/100 while the opportunity score is ${bestOpportunity.opportunity_score}/100, which indicates upside is visible but not yet captured.`,
          if_not_addressed: 'If not addressed, high-intent demand will continue leaking to competitors and qualified traffic growth will stall.',
        }
      : {
          title: 'SEO performance needs stronger signal coverage before a sharper diagnosis is possible',
          impacted_area: 'visibility' as const,
          severity: 'low' as const,
          reasoning: 'The current snapshot is relying on limited evidence, so the first priority is improving crawl, search, and content signal coverage.',
          if_not_addressed: 'If not addressed, execution will stay reactive and each optimization cycle will produce inconsistent results.',
        };

  const usedTracks = new Set<StructuredActionTrack>();
  const trackPriority: Record<StructuredActionTrack, number> = {
    authority: 0,
    positioning: 1,
    comparison: 2,
    generic: 3,
  };
  const linkedVisualForDecision = (decision: PersistedDecisionObject): 'radar' | 'matrix' | 'funnel' | 'crawl' => {
    if (/backlink|authority/.test(decision.issue_type)) return 'radar';
    if (/keyword|ranking/.test(decision.issue_type)) return 'matrix';
    if (/impression_click_gap|visibility|search/.test(decision.issue_type)) return 'funnel';
    if (/seo_gap|weak_content_depth|localized_content_gap/.test(decision.issue_type)) return 'crawl';
    return 'radar';
  };

  const topActionsWithTrack = sortedDecisions
    .map((decision) => {
      const plan = params.buildActionPlan(
        decision,
        params.companyContext,
        params.strategicContext,
        {
          publicAudit: params.publicAudit ?? null,
          competitorIntelligence: params.competitorIntelligence,
          authorityScore,
          contentQualityScore: contentScore,
          aiVisibilityScore: params.geoAeoSummary.overall_ai_visibility_score,
        },
      );
      const track = params.inferStructuredActionTrack({
        issueType: decision.issue_type,
        actionType: decision.action_type,
        title: plan.title,
        recommendation: `${decision.recommendation} ${plan.reasoning}`,
        optimizationFocus: String((decision.action_payload as Record<string, unknown> | undefined)?.optimization_focus ?? ''),
        tactics: plan.tactics,
      });
      if (usedTracks.has(track)) return null;
      usedTracks.add(track);
      return {
        track,
        action: {
          action_title: plan.title,
          title: plan.title,
          priority: params.executivePriorityBand(Number(decision.priority_score ?? impactScore(decision))),
          expected_impact: params.impactBand(impactScore(decision)),
          effort: params.inferEffortLevel(decision),
          linked_visual: linkedVisualForDecision(decision),
          reasoning: plan.reasoning,
          tactics: plan.tactics,
          focus_page: plan.focusPage,
          timeline: plan.timeline,
          impact: plan.impact,
          confidence: plan.confidence,
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  let fallbackIndex = 0;
  while (topActionsWithTrack.length < 3 && params.topPriorities[fallbackIndex]) {
    const item = params.topPriorities[fallbackIndex];
    fallbackIndex += 1;
    const track = params.inferStructuredActionTrack({
      title: item.title,
      recommendation: item.reasoning,
      tactics: item.tactics,
    });
    if (usedTracks.has(track) && track !== 'generic') continue;
    usedTracks.add(track);
    topActionsWithTrack.push({
      track,
      action: {
        action_title: item.title,
        title: item.title,
        priority: params.executivePriorityBand(item.impact_score),
        expected_impact: params.impactBand(item.impact_score),
        effort: item.effort_level,
        linked_visual: topActionsWithTrack.length === 0 ? 'crawl' : topActionsWithTrack.length === 1 ? 'radar' : 'matrix',
        reasoning: item.reasoning,
        tactics: item.tactics,
        focus_page: item.focus_page,
        timeline: item.timeline,
        impact: item.impact,
        confidence: item.confidence,
      },
    });
  }

  fallbackIndex = 0;
  while (topActionsWithTrack.length < 3 && params.topPriorities[fallbackIndex]) {
    const item = params.topPriorities[fallbackIndex];
    fallbackIndex += 1;
    if (topActionsWithTrack.some((entry) => entry.action.title === item.title)) continue;
    topActionsWithTrack.push({
      track: 'generic',
      action: {
        action_title: item.title,
        title: item.title,
        priority: params.executivePriorityBand(item.impact_score),
        expected_impact: params.impactBand(item.impact_score),
        effort: item.effort_level,
        linked_visual: topActionsWithTrack.length === 0 ? 'crawl' : topActionsWithTrack.length === 1 ? 'radar' : 'matrix',
        reasoning: item.reasoning,
        tactics: item.tactics,
        focus_page: item.focus_page,
        timeline: item.timeline,
        impact: item.impact,
        confidence: item.confidence,
      },
    });
  }

  const topActions = topActionsWithTrack
    .sort((left, right) => trackPriority[left.track] - trackPriority[right.track])
    .map((item) => item.action)
    .slice(0, 3);

  const growthOpportunity = bestOpportunity || typeof funnelLostClicks === 'number'
    ? {
        title: bestOpportunity ? `Win more traffic from ${bestOpportunity.keyword}` : 'Recover more search clicks from existing visibility',
        estimated_upside:
          bestOpportunity && typeof bestOpportunity.opportunity_value_score === 'number'
            ? `A higher-coverage push here could unlock a value score of ${bestOpportunity.opportunity_value_score}/100.`
            : typeof funnelLostClicks === 'number'
              ? `The current search funnel suggests roughly ${funnelLostClicks.toLocaleString()} additional clicks may be recoverable.`
              : 'Upside is visible but not yet quantifiable.',
        based_on: bestOpportunity && typeof funnelLostClicks === 'number'
          ? `Based on keyword opportunity coverage and an estimated ${funnelLostClicks.toLocaleString()} lost clicks in the search funnel.`
          : bestOpportunity
            ? 'Based on the highest-value gap in the opportunity coverage matrix.'
            : 'Based on lost-click pressure in the search visibility funnel.',
      }
    : null;

  let confidence: 'high' | 'medium' | 'low' =
    params.visualIntelligence.search_visibility_funnel.confidence === 'high' ||
    params.visualIntelligence.crawl_health_breakdown.confidence === 'high'
      ? 'high'
      : params.visualIntelligence.seo_capability_radar.confidence === 'medium'
        ? 'medium'
        : 'low';
  const missingCoreEvidence = [technicalScore, visibilityScore, contentScore].filter((value) => value == null).length;
  if (missingCoreEvidence >= 2) confidence = 'low';
  else if (missingCoreEvidence === 1 && confidence === 'high') confidence = 'medium';

  const causalReasons: string[] = [];
  if (typeof technicalScore === 'number' && technicalScore < 55) causalReasons.push(`technical score at ${technicalScore}/100 is constraining crawl reliability`);
  if (typeof visibilityScore === 'number' && visibilityScore < 55) causalReasons.push(`visibility score at ${visibilityScore}/100 is suppressing qualified discovery`);
  if (typeof contentScore === 'number' && contentScore < 55) causalReasons.push(`content quality score at ${contentScore}/100 is weakening intent match`);
  if (causalReasons.length > 0) {
    primaryProblem.reasoning = `Primary issue exists because ${causalReasons.slice(0, 2).join(' and ')}. Backlink and content-depth signals currently read technical ${technicalScore ?? 'n/a'}, visibility ${visibilityScore ?? 'n/a'}, content ${contentScore ?? 'n/a'}, authority ${authorityScore ?? 'n/a'}.`;
  }

  return {
    overall_health_score: overallHealthScore,
    primary_problem: primaryProblem,
    top_3_actions: topActions,
    growth_opportunity: growthOpportunity,
    confidence,
  };
}
