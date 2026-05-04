// AUTH EXEMPT: non-route API helper module without default handler
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import {
  buildExpectedUpside,
  classifyPriorityType,
  describePriorityType,
} from '../../../backend/services/actionPriorityService';
import { buildBusinessImpact } from '../../../backend/services/businessImpactFormatter';
import {
  buildComposedMetrics,
  buildCompetitorStanding,
  buildPriorityImpactLabel,
  buildPriorityTimeToImpact,
  flattenComposedSections,
  normalizeImpact,
  sortReportActions,
} from './reportViewUtils';
import {
  buildCompetitorIntelligenceSummary,
  buildCompetitorVisuals,
  buildGeoAeoExecutiveSummary,
  buildGeoAeoVisuals,
  buildSeoExecutiveSummary,
  buildSeoVisuals,
  buildUnifiedIntelligenceSummary,
} from './reportViewSectionBuilders';
import type { ReportViewPayload } from './reportViewPayloadTypes';
import type { ReportViewInsight, ReportViewNextStep, ReportViewOpportunity, ReportViewTopPriority } from './reportViewTypes';
import type { ComposedReportData } from './reportComposedTypes';
import { hasPassedFinalCompetitorGate } from '../../../backend/services/competitorEngineService';

export function mapComposedReport(
  report: ComposedReportData,
  reportType: 'snapshot' | 'performance' | 'growth',
  reportId: string,
  companyId: string,
  domain: string,
  generatedDate: string,
  generated_at: string,
  is_stale: boolean,
  engine_version: string,
): ReportViewPayload | null {
  const sections = Array.isArray(report.sections) ? report.sections : [];
  if (sections.length === 0) return null;

  const flattened = flattenComposedSections(report);
  const insightCount = flattened.insights.length;
  const opportunityCount = flattened.opportunities.length;
  const actionCount = flattened.actions.length;

  const overallScore =
    typeof report.score?.value === 'number'
      ? Math.max(0, Math.min(100, report.score.value))
      : Math.min(100, 35 + sections.length * 10 + Math.min(insightCount, 6) * 4 + Math.min(opportunityCount, 5) * 5);

  const insights: ReportViewInsight[] = flattened.insights.slice(0, 6).map((insight: any) => ({
    text: insight.title || insight.recommendation || 'Key insight identified',
    icon: normalizeImpact(insight.impact_score) === 'high' ? 'alert' : 'trend',
    whyItMatters: insight.why_it_matters || insight.description || insight.recommendation || 'This signal should influence prioritization in the next execution cycle.',
    businessImpact: insight.business_impact || buildBusinessImpact({
      issueType: insight.issue_type,
      actionType: insight.action_type,
      title: insight.title,
      impactTraffic: insight.impact_score,
      impactConversion: insight.impact_score,
      impactRevenue: insight.impact_score,
    }),
  }));

  const opportunities: ReportViewOpportunity[] = flattened.opportunities.slice(0, 6).map((opportunity: any) => ({
    title: opportunity.title || 'Opportunity identified',
    description: opportunity.recommendation || 'A prioritized improvement opportunity is available in this section.',
    impact: normalizeImpact((opportunity.confidence_score ?? 0) * 100),
    priority:
      Number(opportunity.confidence_score ?? 0) >= 0.75
        ? 'Act now'
        : Number(opportunity.confidence_score ?? 0) >= 0.4
          ? 'Plan next'
          : 'Monitor',
  }));

  const nextSteps: ReportViewNextStep[] = sortReportActions(flattened.actions.slice(0, 6).map((action: any) => {
    const effortLevel = action.effort_level || 'medium';
    const impactScore = Number(action.impact_score ?? 0);
    const priorityType = action.priority_type || classifyPriorityType({ impactScore, effortLevel });
    return {
      action: action.title || action.action_type || '',
      description: action.recommendation || '',
      steps: Array.isArray(action.steps) ? action.steps.slice(0, 4) : [],
      reasoning: action.reasoning || '',
      tactics: Array.isArray(action.tactics) ? action.tactics.filter((step) => typeof step === 'string' && step.trim().length > 0).slice(0, 3) : [],
      focusPage: action.focus_page || '',
      timeline: {
        short: action.timeline?.short || '',
        mid: action.timeline?.mid || '',
        long: action.timeline?.long || '',
      },
      priority: action.priority || (impactScore >= 72 ? 'high' : impactScore >= 48 ? 'medium' : 'low'),
      impact: action.impact || normalizeImpact(impactScore),
      effort: action.effort || effortLevel,
      confidence: typeof action.confidence === 'number' ? action.confidence : Math.round(Number(action.confidence_score ?? 0) * 100),
      expectedOutcome: action.expected_outcome || '',
      expectedUpside: action.expected_upside || buildExpectedUpside({
        priorityType,
        impactScore,
        actionType: action.action_type,
        expectedOutcome: action.expected_outcome,
      }),
      impactScore,
      effortLevel,
      priorityType,
      priorityWhy: describePriorityType(priorityType),
    };
  }));

  const topPriorities: ReportViewTopPriority[] = Array.isArray(report.top_priorities)
    ? sortReportActions(report.top_priorities.slice(0, 3).map((item) => {
        const effortLevel = item.effort_level || 'medium';
        const impactScore = Number(item.impact_score ?? 0);
        const priorityType = item.priority_type || classifyPriorityType({ impactScore, effortLevel });
        return {
          title: item.title || 'Priority action',
          whyNow: item.why_now || 'This deserves attention before lower-signal improvements.',
          expectedOutcome: item.expected_outcome || 'This should improve visibility, trust, or conversion readiness.',
          expectedUpside: item.expected_upside || buildExpectedUpside({ priorityType, impactScore, expectedOutcome: item.expected_outcome }),
          effortLevel,
          priorityType,
          priorityWhy: describePriorityType(priorityType),
          impactScore,
          confidenceScore: Number(item.confidence_score ?? 0),
          impactLabel: buildPriorityImpactLabel(item.impact_score, item.confidence_score),
          timeToImpact: buildPriorityTimeToImpact(effortLevel, item.confidence_score),
        };
      })).slice(0, 3)
    : [];

  const finalDetectedCompetitors = Array.isArray(report.competitor_intelligence?.detected_competitors)
    ? report.competitor_intelligence.detected_competitors
        .filter((item) => item?.source !== 'market_substitute')
        .filter((item) => hasPassedFinalCompetitorGate(item as any))
    : [];
  const finalMarketAlternatives = Array.isArray(report.competitor_intelligence?.market_alternatives)
    ? report.competitor_intelligence.market_alternatives
        .filter((item) => item?.source === 'market_substitute')
        .filter((item) => hasPassedFinalCompetitorGate(item as any))
        .slice(0, 3)
    : [];

  const finalCompetitorKeys = new Set(finalDetectedCompetitors.flatMap((item) => [
    String(item.name ?? '').trim().toLowerCase(),
    String(item.domain ?? '').trim().toLowerCase(),
  ]).filter(Boolean));

  const competitorContext = report.competitor_intelligence
    ? {
        summary: finalDetectedCompetitors.length > 0
          ? (report.competitor_intelligence.summary || 'Competitor benchmarking is shaping this snapshot.')
          : 'No final-gated competitor data is available for this report.',
        competitors: finalDetectedCompetitors.length > 0
          ? finalDetectedCompetitors.slice(0, 3).map((item) => ({
              name: item.name || item.domain || 'Market peer',
              domain: item.domain ?? null,
              classification: item.classification || 'direct_competitor',
              source: item.source,
              relevanceScore: Number(item.relevance_score ?? 0),
              category: item.category || null,
              tags: Array.isArray(item.tags) ? item.tags : [],
              problemOverlap: Number(item.problem_overlap ?? 0),
              icpOverlap: Number(item.icp_overlap ?? 0),
              marketOverlap: Number(item.market_overlap ?? 0),
              revenueTier: item.revenue_tier || null,
              productDepth: Number(item.product_depth ?? 0),
              authorityScore: Number(item.authority_score ?? 0),
              authoritySignals: item.authority_signals ?? null,
              finalScore: Number(item.final_score ?? 0),
              tier: item.tier || null,
              positioning: item.positioning
                ? {
                    strengths_vs_company: Array.isArray(item.positioning.strengths_vs_company)
                      ? item.positioning.strengths_vs_company
                      : [],
                    weaknesses_vs_company: Array.isArray(item.positioning.weaknesses_vs_company)
                      ? item.positioning.weaknesses_vs_company
                      : [],
                    differentiation: item.positioning.differentiation || item.rationale || 'Competitive positioning is available from the final engine output.',
                    threat_level: item.positioning.threat_level || 'low',
                  }
                : null,
              enrichmentConfidenceScore: Number(item.enrichment_confidence_score ?? item.enrichment?.confidence_score ?? 0.15),
              enrichment: item.enrichment ?? null,
              rationale: item.rationale || 'Included as part of the competitor benchmark set.',
              standing: buildCompetitorStanding(
                (Array.isArray(report.competitor_intelligence.comparison?.competitors)
                  ? report.competitor_intelligence.comparison?.competitors.find(
                      (entry) =>
                        `${entry.competitor?.domain || entry.competitor?.name || ''}`.toLowerCase() ===
                        `${item.domain || item.name || ''}`.toLowerCase(),
                    )?.deltas_vs_company
                  : undefined),
              ),
            }))
          : [],
        marketAlternatives: finalMarketAlternatives.map((item) => ({
          name: item.name || 'Market alternative',
          category: item.category || null,
          tier: item.tier || null,
          relevanceScore: Number(item.relevance_score ?? 0),
          finalScore: Number(item.final_score ?? 0),
          authorityScore: Number(item.authority_score ?? 0),
          rationale: item.rationale || item.positioning?.differentiation || 'Included as a non-competitor market alternative.',
          useCase: item.enrichment?.icp?.use_case ?? null,
          businessModel: item.enrichment?.business_model ?? null,
        })),
        competitiveSummary: report.competitor_intelligence.competitive_summary
          ? {
              topThreats: Array.isArray(report.competitor_intelligence.competitive_summary.top_threats)
                ? report.competitor_intelligence.competitive_summary.top_threats
                : [],
              keyAdvantage: report.competitor_intelligence.competitive_summary.key_advantage || '',
              keyRisk: report.competitor_intelligence.competitive_summary.key_risk || '',
              positioningStatement: report.competitor_intelligence.competitive_summary.positioning_statement || '',
            }
          : null,
        strongestGaps: Array.isArray(report.competitor_intelligence.generated_gaps)
          ? report.competitor_intelligence.generated_gaps
              .map((gap) => ({
                ...gap,
                leading_competitors: Array.isArray(gap.leading_competitors)
                  ? gap.leading_competitors.filter((item) => finalCompetitorKeys.has(String(item).trim().toLowerCase()))
                  : [],
              }))
              .filter((gap) => gap.leading_competitors.length > 0)
              .slice(0, 3)
              .map((gap) => ({
              gapType: gap.gap_type || 'competitor_gap',
              title: gap.title || 'Competitor gap detected',
              whyItMatters: gap.why_it_matters || 'This gap is affecting how the business compares to competitors.',
              confidenceScore: Number(gap.confidence_score ?? 0),
              impactScore: Number(gap.impact_score ?? 0),
              leadingCompetitors: gap.leading_competitors,
            }))
          : [],
      }
    : undefined;

  const sanitizedReport = report.competitor_intelligence
    ? {
        ...report,
        competitor_intelligence: {
          ...report.competitor_intelligence,
          detected_competitors: finalDetectedCompetitors,
          market_alternatives: finalMarketAlternatives,
          comparison: {
            ...report.competitor_intelligence.comparison,
            competitors: Array.isArray(report.competitor_intelligence.comparison?.competitors)
              ? report.competitor_intelligence.comparison.competitors.filter((entry) =>
                  finalCompetitorKeys.has(String(entry.competitor?.name ?? '').trim().toLowerCase()) ||
                  finalCompetitorKeys.has(String(entry.competitor?.domain ?? '').trim().toLowerCase()),
                )
              : [],
          },
          generated_gaps: Array.isArray(report.competitor_intelligence.generated_gaps)
            ? report.competitor_intelligence.generated_gaps
                .map((gap) => ({
                  ...gap,
                  leading_competitors: Array.isArray(gap.leading_competitors)
                    ? gap.leading_competitors.filter((item) => finalCompetitorKeys.has(String(item).trim().toLowerCase()))
                    : [],
                }))
                .filter((gap) => gap.leading_competitors.length > 0)
            : [],
        },
        competitor_visuals: report.competitor_visuals
          ? {
              ...report.competitor_visuals,
              competitor_positioning_radar: {
                ...report.competitor_visuals.competitor_positioning_radar,
                competitors: Array.isArray(report.competitor_visuals.competitor_positioning_radar?.competitors)
                  ? report.competitor_visuals.competitor_positioning_radar.competitors.filter((item) =>
                      finalCompetitorKeys.has(String(item.name ?? '').trim().toLowerCase()) ||
                      finalCompetitorKeys.has(String(item.domain ?? '').trim().toLowerCase()),
                    )
                  : [],
              },
            }
          : report.competitor_visuals,
      }
    : report;

  const sectionNames = sections.map((section) => section.section_name).filter((value): value is string => Boolean(value));
  const title = reportType === 'performance'
    ? 'Performance Intelligence Report'
    : reportType === 'growth'
      ? 'Market & Growth Intelligence Report'
      : 'Digital Authority Snapshot';

  const companyContext = reportType === 'snapshot'
    ? {
        companyName: report.company_context?.company_name || null,
        domain: report.company_context?.domain || domain || null,
        homepageHeadline: report.company_context?.homepage_headline || null,
        tagline: report.company_context?.tagline || null,
        primaryOffering: report.company_context?.primary_offering || null,
        positioning: report.company_context?.positioning || null,
        marketContext: report.company_context?.market_context || null,
        logoUrl: report.company_context?.logo_url || null,
        faviconUrl: report.company_context?.favicon_url || null,
        positioningStrength: report.company_context?.positioning_strength || undefined,
        positioningNarrative: report.company_context?.positioning_narrative || undefined,
        positioningGap: report.company_context?.positioning_gap || null,
        marketType: report.company_context?.market_type || undefined,
        marketNarrative: report.company_context?.market_narrative || undefined,
        strategyAlignment: report.company_context?.strategy_alignment || undefined,
        marketPosition: report.company_context?.market_position || undefined,
        marketPositionStatement: report.company_context?.market_position_statement || undefined,
        positionImplication: report.company_context?.position_implication || undefined,
        executionRisk: report.company_context?.execution_risk || undefined,
        resilienceGuidance: report.company_context?.resilience_guidance || undefined,
      }
    : undefined;

  const diagnosis = report.diagnosis || (
    reportType === 'performance'
      ? `Performance review surfaced ${opportunityCount} priority opportunities across ${sectionNames.length} sections.`
      : reportType === 'growth'
        ? `Growth analysis identified ${opportunityCount} expansion opportunities across ${sectionNames.length} strategic areas.`
        : `Snapshot analysis surfaced ${insightCount} signals across ${sectionNames.length} core readiness areas.`
  );
  const summary = report.summary || (
    sectionNames.length > 0
      ? `This ${reportType} report covers ${sectionNames.join(', ')} with ${insightCount} insights, ${opportunityCount} opportunities, and ${actionCount} recommended actions.`
      : `This ${reportType} report contains ${insightCount} insights, ${opportunityCount} opportunities, and ${actionCount} actions.`
  );

  const decisionSnapshot = reportType === 'snapshot'
    ? {
        primaryFocusArea: report.decision_snapshot?.primary_focus_area || report.unified_intelligence_summary?.primary_constraint?.title || 'Primary growth constraint',
        whatsBroken: report.decision_snapshot?.whats_broken || diagnosis,
        whatToFixFirst: report.decision_snapshot?.what_to_fix_first || topPriorities[0]?.title || 'Execute the highest-impact action first',
        whatToDelay: report.decision_snapshot?.what_to_delay || 'Delay lower-impact expansion until the primary constraint is reduced.',
        ifIgnored: report.decision_snapshot?.if_ignored || 'If ignored, visibility and conversion constraints will continue to compound.',
        executionSequence:
          Array.isArray(report.decision_snapshot?.execution_sequence) && report.decision_snapshot.execution_sequence.length > 0
            ? report.decision_snapshot.execution_sequence.slice(0, 3)
            : topPriorities.slice(0, 3).map((item, index) => `Step ${index + 1}: ${item.title}`),
        ifExecutedWell: report.decision_snapshot?.if_executed_well || 'If executed well, visibility quality, authority signals, and conversion readiness should improve in sequence.',
        whenToExpectImpact: {
          shortTerm: report.decision_snapshot?.when_to_expect_impact?.short_term || '2-4 weeks: early movement in key visibility constraints.',
          midTerm: report.decision_snapshot?.when_to_expect_impact?.mid_term || '1-3 months: stronger authority and content-depth lift query capture.',
          longTerm: report.decision_snapshot?.when_to_expect_impact?.long_term || '3-6 months: stronger market position and channel resilience.',
        },
        impactScale: report.decision_snapshot?.impact_scale || 'medium_impact',
        currentState: report.decision_snapshot?.current_state || 'Constrained visibility and authority performance in core queries',
        expectedState: report.decision_snapshot?.expected_state || 'Competitive visibility and stronger authority presence in core queries',
        outcomeConfidence: report.decision_snapshot?.outcome_confidence || 'medium',
      }
    : undefined;
  const rawCompetitiveSnapshot = report.competitive_snapshot;
  const competitiveSnapshot = rawCompetitiveSnapshot
    ? {
        competitors: Array.isArray(rawCompetitiveSnapshot.competitors)
          ? rawCompetitiveSnapshot.competitors.slice(0, 3).map((item) => ({
              name: item.name || 'Competitor',
              tier: item.tier || 'Tier 3',
              threatLevel: item.threat_level || 'low',
              differentiation: item.differentiation || 'Differentiation is still being established.',
            }))
          : [],
        summary: {
          topThreat: rawCompetitiveSnapshot.competitive_snapshot_summary?.top_threat || 'No final-gated competitor',
          immediatePositioningAngle: rawCompetitiveSnapshot.competitive_snapshot_summary?.immediate_positioning_angle || 'Position around the highest-fit customer problem.',
          action: rawCompetitiveSnapshot.competitive_snapshot_summary?.action || 'Use competitor differentiation in executive messaging.',
        },
      }
    : null;
  const rawPressure = report.competitive_pressure_analysis ?? (report as any).mapped_data?.competitive_pressure_analysis ?? null;
  const competitivePressureAnalysis = rawPressure
    ? {
        competitors: Array.isArray(rawPressure.competitors)
          ? rawPressure.competitors.map((item: any) => ({
              name: item.name || 'Competitor',
              tier: item.tier || 'Tier 3',
              threatLevel: item.threat_level || 'low',
              authorityScore: Number(item.authority_score ?? 0),
              pressureOn: Array.isArray(item.pressure_on) ? item.pressure_on : [],
              action: item.action || 'Prioritize higher-confidence competitor actions first.',
            }))
          : [],
        summary: {
          highestPressure: rawPressure.summary?.highest_pressure || 'No final-gated competitor',
          primaryRisk: rawPressure.summary?.primary_risk || 'Competitor pressure is still being established.',
          nextAction: rawPressure.summary?.next_action || 'Run competitor discovery again after more market data is available.',
        },
      }
    : null;
  const rawStrategy = report.competitive_strategy_map ?? null;
  const competitiveStrategyMap = rawStrategy
    ? {
        tierBreakdown: {
          tier1: Array.isArray(rawStrategy.tier_breakdown?.tier_1)
            ? rawStrategy.tier_breakdown.tier_1.map((item) => ({
                name: item.name || 'Competitor',
                tier: 'Tier 1' as const,
                threatLevel: item.threat_level || 'low',
                differentiation: item.differentiation || 'Differentiation is still being established.',
              }))
            : [],
          tier2: Array.isArray(rawStrategy.tier_breakdown?.tier_2)
            ? rawStrategy.tier_breakdown.tier_2.map((item) => ({
                name: item.name || 'Competitor',
                tier: 'Tier 2' as const,
                threatLevel: item.threat_level || 'low',
                differentiation: item.differentiation || 'Differentiation is still being established.',
              }))
            : [],
          tier3: Array.isArray(rawStrategy.tier_breakdown?.tier_3)
            ? rawStrategy.tier_breakdown.tier_3.map((item) => ({
                name: item.name || 'Competitor',
                tier: 'Tier 3' as const,
                threatLevel: item.threat_level || 'low',
                differentiation: item.differentiation || 'Differentiation is still being established.',
              }))
            : [],
        },
        opportunityMap: {
          whitespaceOpportunities: Array.isArray(rawStrategy.opportunity_map?.whitespace_opportunities)
            ? rawStrategy.opportunity_map.whitespace_opportunities
            : [],
          underexploitedIcpSegments: Array.isArray(rawStrategy.opportunity_map?.underexploited_icp_segments)
            ? rawStrategy.opportunity_map.underexploited_icp_segments
            : [],
          weakCompetitorAreas: Array.isArray(rawStrategy.opportunity_map?.weak_competitor_areas)
            ? rawStrategy.opportunity_map.weak_competitor_areas
            : [],
        },
        strategicActions: {
          howToBeatTier1: rawStrategy.strategic_actions?.how_to_beat_tier_1 || '',
          howToDifferentiateFromTier2: rawStrategy.strategic_actions?.how_to_differentiate_from_tier_2 || '',
          howToIgnoreTier3: rawStrategy.strategic_actions?.how_to_ignore_tier_3 || '',
        },
      }
    : null;
  const strategicPosition = report.strategic_position
    ? {
        positioningStatement: report.strategic_position.positioning_statement || '',
        primaryBattlefield: report.strategic_position.primary_battlefield || '',
        avoidanceZone: report.strategic_position.avoidance_zone || '',
        messagingAngle: report.strategic_position.messaging_angle || '',
      }
    : null;

  return {
    reportId,
    companyId,
    domain,
    reportType,
    generatedDate,
    generated_at,
    is_stale,
    engine_version,
    status: 'completed',
    title,
    companyContext,
    diagnosis,
    summary,
    overallScore,
    scoreExplanation: report.score ? {
      dimensions: Array.isArray(report.score.dimensions)
        ? report.score.dimensions.map((item) => ({
            key: item.key || 'dimension',
            label: item.label || 'Dimension',
            value: Number(item.value ?? 0),
            explanation: item.explanation || 'This dimension influences the overall score.',
          }))
        : [],
      weakestDimensions: Array.isArray(report.score.weakest_dimensions)
        ? report.score.weakest_dimensions.map((item) => ({
            key: item.key || 'dimension',
            label: item.label || 'Dimension',
            value: Number(item.value ?? 0),
          }))
        : [],
      limitingFactors: Array.isArray(report.score.limiting_factors) ? report.score.limiting_factors : [],
      growthPath: {
        currentLevel: report.score.growth_path?.current_level || report.score.label || 'Current level',
        nextLevel: report.score.growth_path?.next_level ?? null,
        focus: Array.isArray(report.score.growth_path?.focus) ? report.score.growth_path?.focus : [],
        projectedScoreImprovements: Array.isArray(report.score.growth_path?.projected_score_improvements)
          ? report.score.growth_path?.projected_score_improvements.map((item) => ({
              dimension: item.dimension || 'dimension',
              currentValue: Number(item.current_value ?? 0),
              projectedValue: Number(item.projected_value ?? 0),
              projectedTotalScore: Number(item.projected_total_score ?? 0),
            }))
          : [],
      },
    } : undefined,
    confidenceSource: `Composed from ${sectionNames.length} report sections`,
    insights,
    metrics: buildComposedMetrics(reportType, sections),
    opportunities,
    competitorContext,
    seoExecutiveSummary: reportType === 'snapshot' ? buildSeoExecutiveSummary(report) : undefined,
    seoVisuals: reportType === 'snapshot' ? buildSeoVisuals(report) : undefined,
    geoAeoVisuals: reportType === 'snapshot' ? buildGeoAeoVisuals(report) : undefined,
    geoAeoExecutiveSummary: reportType === 'snapshot' ? buildGeoAeoExecutiveSummary(report) : undefined,
    unifiedIntelligenceSummary: reportType === 'snapshot' ? buildUnifiedIntelligenceSummary(report) : undefined,
    competitorVisuals: reportType === 'snapshot' ? buildCompetitorVisuals(sanitizedReport) : undefined,
    competitorIntelligenceSummary: reportType === 'snapshot' ? buildCompetitorIntelligenceSummary(sanitizedReport) : undefined,
    competitiveSnapshot,
    competitivePressureAnalysis,
    competitiveStrategyMap,
    strategicPosition,
    decisionSnapshot,
    topPriorities,
    nextSteps,
  };
}

