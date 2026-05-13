import type { BehaviorReportData } from './performanceReportService';
import type { BehaviorRecommendation } from './behaviorRecommendationService';
import type { CompetitivePressureAnalysis } from './reportCompetitorStrategyService';
import type { PerformanceSearchIntelligence } from './performanceSearchIntelligenceService';
import type { PerformanceBehaviorIntelligence } from './performanceBehaviorIntelligenceService';
import {
  buildConvergedNextMoves,
  consolidateBehaviorRecommendations,
  consolidateSearchOpportunities,
  type ConsolidatedBehaviorRecommendation,
  type ConsolidatedSearchOpportunity,
  type ConvergedNextMove,
} from './performance/recommendationConsolidator';
import {
  classifyConfidenceTier,
  dampenPriorityWeight,
  softenLanguage,
  tierLabel,
  type ConfidenceTier,
} from './performance/confidenceCalibrationService';
import {
  buildWhatMattersMost,
  type WhatMattersMost,
} from './performance/whatMattersMostService';

export interface PerformanceCampaignItem {
  id: string;
  name: string;
  status: string;
  updated_at: string | null;
}

export interface PerformanceEngagementContext {
  marketpulse_usage_summary: string;
  recommendations_pending: number;
  recommendations_implemented: number;
  recommendations_ignored: number;
}

export interface PerformanceMapperContext {
  campaigns?: PerformanceCampaignItem[];
  engagement?: PerformanceEngagementContext | null;
  competitivePressureAnalysis?: CompetitivePressureAnalysis | null;
  searchIntelligence?: PerformanceSearchIntelligence | null;
  behaviorIntelligence?: PerformanceBehaviorIntelligence | null;
  snapshotFoundation?: PerformanceSnapshotFoundation | null;
}

export interface PerformanceSnapshotFoundation {
  authority_score: number | null;
  authority_band: string;
  maturity_label: string;
  headline: string;
  primary_constraint: string;
  market_position: string | null;
  positioning: string | null;
  top_priorities: Array<{
    title: string;
    why_now: string;
    impact: string;
    confidence: number;
  }>;
  pillar_scores: Array<{
    label: string;
    value: number | null;
    band: string;
    primary_signal: string | null;
  }>;
}

export interface PerformanceReportMappedData {
  lead_summary: {
    total_leads: number;
    conversion_rate: number;
    best_channel: string;
    biggest_drop_off: string;
    diagnosis: string;
    decision_summary: string;
    why_this_matters: string;
  };
  leakage: {
    funnel_steps: BehaviorReportData['funnel']['steps'];
    top_drop_off_pages: Array<{
      page_url: string;
      drop_off_rate: number;
      entry_sessions: number;
      exit_sessions: number;
    }>;
    decision_summary: string;
    why_this_matters: string;
  };
  sources: Array<{
    channel: string;
    sessions: number;
    events: number;
    leads: number;
    conversion_rate: number;
    engagement_rate: number;
  }>;
  platform_fit: {
    best_platform: string;
    underutilized: string;
    waste_channel: string;
    decision_summary: string;
    why_this_matters: string;
    platforms: Array<{
      platform: string;
      decision: 'scale' | 'fix' | 'reduce';
      reason: string;
      sessions: number;
      leads: number;
      conversion_rate: number;
      engagement_rate: number;
    }>;
  };
  content: {
    top_converting_pages: Array<{
      page_url: string;
      conversions: number;
      visits: number;
      conversion_rate: number;
    }>;
    high_traffic_low_conversion_pages: Array<{
      page_url: string;
      visits: number;
      conversions: number;
      conversion_rate: number;
    }>;
    decision_summary: string;
    why_this_matters: string;
  };
  organic_search: {
    data_confidence: PerformanceSearchIntelligence['data_confidence'];
    insight_confidence: PerformanceSearchIntelligence['insight_confidence'];
    recommendation_confidence: PerformanceSearchIntelligence['recommendation_confidence'];
    readiness_status: string;
    organic_visibility_summary: string;
    demand_quality_summary: string;
    landing_page_weakness_summary: string;
    joined_pages: PerformanceSearchIntelligence['joined_pages'];
    opportunities: PerformanceSearchIntelligence['opportunities'];
    keyword_opportunities: PerformanceSearchIntelligence['keyword_opportunities'];
    opportunity_themes: Array<{
      theme: string;
      summary: string;
      severity: 'high' | 'medium' | 'low';
      confidence: 'none' | 'low' | 'medium' | 'high';
      pages: string[];
      evidence_summary: string;
    }>;
    decision_summary: string;
    why_this_matters: string;
  };
  behavior_quality: {
    engagement_confidence: PerformanceBehaviorIntelligence['engagement_confidence'];
    traffic_quality_confidence: PerformanceBehaviorIntelligence['traffic_quality_confidence'];
    conversion_confidence: PerformanceBehaviorIntelligence['conversion_confidence'];
    engagement_summary: string;
    traffic_summary: string;
    conversion_summary: string;
    current: PerformanceBehaviorIntelligence['current'] | null;
    deltas: PerformanceBehaviorIntelligence['deltas'] | null;
    device_insights: PerformanceBehaviorIntelligence['device_insights'];
    source_insights: PerformanceBehaviorIntelligence['source_insights'];
    landing_page_insights: PerformanceBehaviorIntelligence['landing_page_insights'];
    decision_summary: string;
    why_this_matters: string;
  };
  diagnosis: {
    friction_points: string[];
    messaging_issues: string[];
    cta_gaps: string[];
    decision_summary: string;
    why_this_matters: string;
  };
  actions: {
    quick_wins: BehaviorRecommendation[];
    growth_levers: BehaviorRecommendation[];
    strategic_bets: BehaviorRecommendation[];
    decision_summary: string;
    why_this_matters: string;
  };
  campaigns: {
    total_campaigns: number;
    effectiveness_summary: string;
    decision_summary: string;
    why_this_matters: string;
    items: Array<PerformanceCampaignItem & {
      classification: 'effective' | 'engaging_but_not_converting' | 'inactive_or_missing';
      reason: string;
    }>;
  };
  engagement: {
    marketpulse_usage: string;
    insights_consumed: number;
    insights_acted: number;
    stage: 'observing' | 'experimenting' | 'executing' | 'scaling';
    decision_summary: string;
    why_this_matters: string;
  };
  lead_activation: {
    leads_captured: number;
    leads_acted_upon: number;
    follow_up_gap: number;
    follow_up_rate: number;
    engagement_capture_gap: number;
    decision_summary: string;
    why_this_matters: string;
  };
  maturity: {
    stage: 'observing' | 'measuring' | 'optimizing' | 'scaling';
    readiness_signals: string[];
    decision_summary: string;
    why_this_matters: string;
  };
  next_moves: Array<{
    action: string;
    impact: string;
    effort: BehaviorRecommendation['effort_level'];
    source: string;
    priority: BehaviorRecommendation['priority'];
    confidence_tier: ConfidenceTier;
    trigger: string;
    why_it_matters: string;
    page_url: string | null;
  }>;
  focus_this_week: Array<{
    action: string;
    impact: string;
    effort: BehaviorRecommendation['effort_level'];
    source: string;
    confidence_tier: ConfidenceTier;
    trigger: string;
    page_url: string | null;
  }>;
  competitive_pressure_analysis: CompetitivePressureAnalysis | null;
  snapshot_foundation: PerformanceSnapshotFoundation | null;
  /**
   * Pre-drill calibration fields (additive). Populated by mapPerformanceReportData.
   * Renderers / evaluators that don't know about these can ignore them safely.
   */
  what_matters_most?: WhatMattersMost;
  consolidation?: {
    behavior_consolidated_count: number;
    behavior_raw_count: number;
    search_consolidated_count: number;
    search_raw_count: number;
    /** Decoded next-move list with converging GA+GSC signals fused. */
    next_moves_converged: ConvergedNextMove[];
  };
  confidence_breakdown?: {
    /** Distribution of recommendations across calibrated tiers (post-consolidation). */
    distribution: { confirmed: number; directional: number; hypothesis: number; weak_data: number };
    /** Per-recommendation tier the renderer can use for ribbons. */
    next_move_tiers: Array<{ action: string; tier: ConfidenceTier; tier_label: string }>;
  };
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function recommendationImpactWeight(item: BehaviorRecommendation): number {
  return Math.max(
    Number(item.context?.entry_sessions ?? 0),
    Number(item.context?.sessions ?? 0),
    Number(item.context?.visits ?? 0),
    Number(item.context?.users ?? 0),
  );
}

function rankRecommendations(items: BehaviorRecommendation[]): BehaviorRecommendation[] {
  const priorityRank = { high: 3, medium: 2, low: 1 };
  return [...items].sort((a, b) => {
    const priorityDelta = priorityRank[b.priority] - priorityRank[a.priority];
    if (priorityDelta !== 0) return priorityDelta;
    return recommendationImpactWeight(b) - recommendationImpactWeight(a);
  });
}

/**
 * Pre-drill calibration: classify a behavior recommendation's confidence tier
 * from its context.sample and priority. Consumed by ranking + softening below.
 */
function tierForBehavior(item: BehaviorRecommendation): ConfidenceTier {
  const sample = Math.max(
    Number(item.context?.entry_sessions ?? 0),
    Number(item.context?.sessions ?? 0),
    Number(item.context?.visits ?? 0),
    Number(item.context?.users ?? 0),
  );
  return classifyConfidenceTier({
    upstreamConfidence: item.priority === 'high' ? 'high' : item.priority === 'medium' ? 'medium' : 'low',
    sampleSize: sample,
    severity: item.priority,
  });
}

/**
 * Pre-drill calibration: rank by composite priority × tier-damping × impact.
 * Confirmed/high beats weak-data/high — high-priority weak items can still
 * surface but will never outrank a medium-priority confirmed item.
 */
function rankConsolidatedRecommendations(
  items: ConsolidatedBehaviorRecommendation[],
): ConsolidatedBehaviorRecommendation[] {
  const priorityRank = { high: 3, medium: 2, low: 1 };
  return [...items].sort((a, b) => {
    const tierA = tierForBehavior(a.representative);
    const tierB = tierForBehavior(b.representative);
    const weightedA = dampenPriorityWeight(
      priorityRank[a.representative.priority] ?? 1,
      tierA,
      recommendationImpactWeight(a.representative),
    );
    const weightedB = dampenPriorityWeight(
      priorityRank[b.representative.priority] ?? 1,
      tierB,
      recommendationImpactWeight(b.representative),
    );
    if (weightedB !== weightedA) return weightedB - weightedA;
    return recommendationImpactWeight(b.representative) - recommendationImpactWeight(a.representative);
  });
}

function impactEstimateRank(value: string): number {
  const normalized = value.replace(/–/g, '-');
  const numbers = normalized.match(/\d+/g)?.map((item) => Number(item)) ?? [];
  return Math.max(...numbers, 0);
}

function effortRank(value: BehaviorRecommendation['effort_level']): number {
  if (value === 'low') return 1;
  if (value === 'medium') return 2;
  return 3;
}

function bestChannelLabel(data: BehaviorReportData): string {
  if (data.traffic_sources.length === 0) return 'No channel data available';
  const ranked = [...data.traffic_sources]
    .map((item) => ({
      label: item.source_medium !== 'unknown' ? `${item.traffic_source} / ${item.source_medium}` : item.traffic_source,
      score: item.conversions * 1000 + item.sessions,
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.label ?? 'No channel data available';
}

function sectionSourceLabel(recommendation: BehaviorRecommendation): string {
  if (recommendation.linked_insight === 'drop_off') return 'Lead Leakage';
  if (recommendation.linked_insight === 'funnel') return 'Conversion Diagnosis';
  if (recommendation.linked_insight === 'traffic_quality') return 'Lead Sources';
  return 'Content Intelligence';
}

function recommendationExpectedImpact(recommendation: BehaviorRecommendation): string {
  if (recommendation.type === 'ux_fix' || recommendation.type === 'messaging_fix') {
    return 'increase early-stage engagement';
  }
  if (recommendation.type === 'conversion_optimization' || recommendation.type === 'cta_optimization') {
    return 'increase conversion rate';
  }
  if (recommendation.type === 'traffic_alignment') {
    return 'improve lead quality from existing channels';
  }
  return 'increase page engagement and intent';
}

function pageUrlFromRecommendation(recommendation: BehaviorRecommendation): string | null {
  const value = recommendation.context?.page_url;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sampleSizeFromRecommendation(recommendation: BehaviorRecommendation): number {
  return Math.max(
    Number(recommendation.context?.entry_sessions ?? 0),
    Number(recommendation.context?.sessions ?? 0),
    Number(recommendation.context?.visits ?? 0),
    Number(recommendation.context?.users ?? 0),
  );
}

function buildRecommendationTrigger(recommendation: BehaviorRecommendation): string {
  const sample = sampleSizeFromRecommendation(recommendation);
  const page = pageUrlFromRecommendation(recommendation);
  const metric = recommendation.context?.baseline_metric;
  const metricText = typeof metric === 'number'
    ? `${Math.round(metric * 100)}% signal`
    : typeof metric === 'string' && metric.trim()
      ? metric.trim()
      : null;
  const pageText = page ? ` on ${page}` : '';
  const sampleText = sample > 0 ? ` across ${sample.toLocaleString('en-US')} sessions/visits` : '';
  return metricText
    ? `Triggered by ${metricText}${pageText}${sampleText}.`
    : `Triggered by measured behavior${pageText}${sampleText}.`;
}

function buildRecommendationWhyItMatters(recommendation: BehaviorRecommendation): string {
  if (recommendation.type === 'traffic_alignment') {
    return 'This protects acquisition spend and effort from being sent to traffic that is unlikely to become pipeline.';
  }
  if (recommendation.type === 'cta_optimization' || recommendation.type === 'conversion_optimization') {
    return 'This improves the conversion yield from demand that is already reaching the site.';
  }
  if (recommendation.type === 'messaging_fix') {
    return 'This improves the first impression so more visitors understand the offer before they leave.';
  }
  if (recommendation.type === 'content_optimization') {
    return 'This turns existing page attention into clearer intent, stronger next steps, and more qualified engagement.';
  }
  return 'This reduces journey friction before more traffic or campaign budget is added.';
}

function specificActionForRecommendation(recommendation: BehaviorRecommendation): string {
  const page = pageUrlFromRecommendation(recommendation);
  if (recommendation.type === 'cta_optimization') {
    return page
      ? `Clarify the primary CTA and next-step path on ${page}`
      : 'Clarify the primary CTA and next-step path on the highest-intent page';
  }
  if (recommendation.type === 'conversion_optimization') {
    return page
      ? `Reduce conversion friction on ${page}`
      : 'Reduce late-stage conversion friction in the lead journey';
  }
  if (recommendation.type === 'traffic_alignment') {
    const source = recommendation.context?.traffic_source;
    const label = typeof source === 'string' && source.trim() ? source.trim() : 'the weakest traffic source';
    return page
      ? `Match ${label} traffic to a more relevant landing promise on ${page}`
      : `Re-align ${label} traffic with a clearer landing-page promise`;
  }
  if (recommendation.type === 'messaging_fix') {
    return page
      ? `Rewrite the above-the-fold promise on ${page} around visitor intent`
      : 'Rewrite the landing-page promise around visitor intent';
  }
  if (recommendation.type === 'content_optimization') {
    return page
      ? `Restructure ${page} around the strongest reader problem and next step`
      : 'Restructure the weakest content page around the strongest reader problem and next step';
  }
  return recommendation.message;
}

function confidenceRank(value: 'none' | 'low' | 'medium' | 'high'): number {
  if (value === 'high') return 4;
  if (value === 'medium') return 3;
  if (value === 'low') return 2;
  return 1;
}

function severityRank(value: 'low' | 'medium' | 'high'): number {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function rankSearchOpportunity(item: PerformanceSearchIntelligence['opportunities'][number]): number {
  const evidence = item.evidence ?? {};
  const demand = Math.max(Number(evidence.impressions ?? 0), Number(evidence.sessions ?? 0));
  const conversionRate = Number(evidence.conversion_rate ?? 0);
  const trendBoost = item.type === 'organic_decline' || item.type === 'organic_rise' ? 18 : 0;
  const conversionBoost = item.type === 'traffic_conversion_gap' || item.type === 'landing_page_experience_gap'
    ? Math.max(0, 0.03 - conversionRate) * 500
    : 0;
  return (
    severityRank(item.severity) * 1000 +
    confidenceRank(item.confidence) * 220 +
    Math.min(220, Math.log10(demand + 1) * 70) +
    trendBoost +
    conversionBoost
  );
}

function rankKeywordOpportunity(item: PerformanceSearchIntelligence['keyword_opportunities'][number]): number {
  const intentBoost = item.intent_group === 'commercial' || item.intent_group === 'transactional' ? 80 : 0;
  const brandedPenalty = item.branded ? 90 : 0;
  const trendBoost = item.trend_direction === 'declining' || item.trend_direction === 'rising' ? 35 : 0;
  return (
    severityRank(item.severity) * 1000 +
    confidenceRank(item.confidence) * 220 +
    Math.min(280, Math.log10(item.impressions + 1) * 90) +
    intentBoost +
    trendBoost -
    brandedPenalty
  );
}

function buildOpportunityThemes(
  opportunities: PerformanceSearchIntelligence['opportunities'],
  keywords: PerformanceSearchIntelligence['keyword_opportunities'],
): PerformanceReportMappedData['organic_search']['opportunity_themes'] {
  const groups = new Map<string, {
    pages: Set<string>;
    severity: 'high' | 'medium' | 'low';
    confidence: 'none' | 'low' | 'medium' | 'high';
    evidence: number;
    count: number;
  }>();
  const add = (
    theme: string,
    page: string | null | undefined,
    severity: 'high' | 'medium' | 'low',
    confidence: 'none' | 'low' | 'medium' | 'high',
    evidence: number,
  ) => {
    const current = groups.get(theme) ?? {
      pages: new Set<string>(),
      severity,
      confidence,
      evidence: 0,
      count: 0,
    };
    if (page) current.pages.add(page);
    if (severityRank(severity) > severityRank(current.severity)) current.severity = severity;
    if (confidenceRank(confidence) > confidenceRank(current.confidence)) current.confidence = confidence;
    current.evidence += evidence;
    current.count += 1;
    groups.set(theme, current);
  };

  for (const item of opportunities) {
    const theme =
      item.type === 'ctr_opportunity' ? 'SERP click-through improvement'
        : item.type === 'ranking_opportunity' ? 'Rankable search demand'
          : item.type === 'organic_decline' ? 'Declining organic demand'
            : item.type === 'organic_rise' ? 'Rising organic demand'
              : 'Landing-page demand capture';
    add(theme, item.page_url, item.severity, item.confidence, Number(item.evidence.impressions ?? item.evidence.sessions ?? 0));
  }
  for (const item of keywords) {
    if (item.confidence === 'low' || item.branded) continue;
    add(
      item.opportunity_type === 'ctr' ? 'SERP click-through improvement' : 'Rankable search demand',
      item.page_url,
      item.severity,
      item.confidence,
      item.impressions,
    );
  }

  return Array.from(groups.entries())
    .map(([theme, group]) => ({
      theme,
      summary: `${group.count} signal${group.count === 1 ? '' : 's'} point to ${theme.toLowerCase()}.`,
      severity: group.severity,
      confidence: group.confidence,
      pages: Array.from(group.pages).slice(0, 4),
      evidence_summary: group.evidence > 0
        ? `${Math.round(group.evidence).toLocaleString('en-US')} impressions/sessions represented`
        : 'Evidence volume is still forming',
    }))
    .sort((a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      confidenceRank(b.confidence) - confidenceRank(a.confidence),
    )
    .slice(0, 4);
}

function biggestDropOffLabel(data: BehaviorReportData): string {
  const topDrop = data.drop_off_pages[0];
  if (!topDrop) return 'No major drop-off identified';
  return `${topDrop.page_url} (${Math.round(topDrop.drop_off_rate * 100)}%)`;
}

function oneLineDiagnosis(data: BehaviorReportData): string {
  const highDrop = data.drop_off_pages[0];
  const funnelEngagementDrop = data.funnel.steps.find((step) => step.step === 'engagement')?.drop_pct ?? 0;
  const funnelConversionDrop = data.funnel.steps.find((step) => step.step === 'conversion')?.drop_pct ?? 0;

  if (highDrop && highDrop.drop_off_rate > 0.6) {
    return `Lead leakage is concentrated on ${highDrop.page_url}, where users leave before progressing.`;
  }
  if (funnelEngagementDrop > 0.4) {
    return 'Visitors are arriving, but too few are engaging after the first landing step.';
  }
  if (funnelConversionDrop > 0.7) {
    return 'Users engage with the experience, but conversion friction is blocking lead capture.';
  }
  return 'Lead generation has measurable traction, but there is still room to improve conversion efficiency.';
}

function inferPlatformFit(data: PerformanceReportMappedData['sources']) {
  if (data.length === 0) {
    return {
      best_platform: 'No platform data available',
      underutilized: 'No platform data available',
      waste_channel: 'No platform data available',
      decision_summary: 'Channel efficiency cannot be ranked yet because platform-level analytics are still sparse.',
      why_this_matters: 'Platform fit shows where lead generation scales efficiently and where spend or effort is being wasted.',
      platforms: [],
    };
  }

  const avgConversionRate = safeDiv(
    data.reduce((sum, item) => sum + item.conversion_rate, 0),
    data.length,
  );
  const avgEngagementRate = safeDiv(
    data.reduce((sum, item) => sum + item.engagement_rate, 0),
    data.length,
  );

  const byRate = [...data].sort((a, b) => b.conversion_rate - a.conversion_rate || b.leads - a.leads);
  const byVolume = [...data].sort((a, b) => b.sessions - a.sessions);
  const platforms = data.map((item) => {
    const highVolume = item.sessions >= (byVolume[0]?.sessions ?? 0) * 0.6;
    const strongConversion = item.conversion_rate >= Math.max(avgConversionRate, 0.04);
    const strongEngagement = item.engagement_rate >= Math.max(avgEngagementRate, 1);

    let decision: 'scale' | 'fix' | 'reduce' = 'fix';
    let reason = 'This channel has mixed performance and needs message-to-offer refinement.';

    if (strongConversion && strongEngagement) {
      decision = 'scale';
      reason = 'This channel shows strong engagement and converts efficiently relative to the rest of the mix.';
    } else if (highVolume && !strongConversion) {
      decision = 'reduce';
      reason = 'This channel brings volume, but conversion efficiency is weak and is likely diluting lead quality.';
    } else {
      decision = 'fix';
      reason = 'This channel is generating signal, but conversion or engagement still needs tuning before scaling.';
    }

    return {
      platform: item.channel,
      decision,
      reason,
      sessions: item.sessions,
      leads: item.leads,
      conversion_rate: item.conversion_rate,
      engagement_rate: item.engagement_rate,
    };
  }).sort((a, b) => {
    const rank = { scale: 3, fix: 2, reduce: 1 };
    return rank[b.decision] - rank[a.decision] || b.leads - a.leads || b.sessions - a.sessions;
  });

  const bestPlatform = byRate[0];
  const underutilized = byRate.find((item) => item.sessions < (byVolume[0]?.sessions ?? 0) && item.leads > 0) ?? byRate[0];
  const wasteChannel = [...data].sort((a, b) => {
    const aWaste = a.sessions - a.leads * 10;
    const bWaste = b.sessions - b.leads * 10;
    return bWaste - aWaste;
  })[0];

  return {
    best_platform: bestPlatform?.channel ?? 'No platform data available',
    underutilized: underutilized?.channel ?? 'No platform data available',
    waste_channel: wasteChannel?.channel ?? 'No platform data available',
    decision_summary: platforms.some((item) => item.decision === 'scale')
      ? `${platforms.find((item) => item.decision === 'scale')?.platform ?? 'One channel'} should be scaled, while weaker channels need tighter lead-quality control.`
      : 'No channel is clearly earning more budget yet, so the current mix needs optimization before scaling.',
    why_this_matters: 'Platform fit helps redirect budget and effort toward channels that produce engaged, convertible demand.',
    platforms,
  };
}

function inferMaturity(data: BehaviorReportData): PerformanceReportMappedData['maturity'] {
  const readinessSignals: string[] = [];
  if (data.traffic_sources.length > 0) readinessSignals.push('Traffic sources are measurable');
  if (data.funnel.steps.some((step) => step.users > 0)) readinessSignals.push('Funnel steps are visible');
  if (data.conversions.total_conversions > 0) readinessSignals.push('Conversion events are tracked');
  if (data.recommendations.length > 0) readinessSignals.push('Actionable recommendations are generated');

  let stage: PerformanceReportMappedData['maturity']['stage'] = 'observing';
  if (data.traffic_sources.length > 0 && data.funnel.steps.length > 0) stage = 'measuring';
  if (data.conversions.total_conversions > 0 && data.insights.length > 0) stage = 'optimizing';
  if (data.recommendations.filter((item) => item.priority === 'high').length >= 3 && data.conversions.total_conversions > 5) stage = 'scaling';

  return {
    stage,
    readiness_signals: readinessSignals,
    decision_summary: stage === 'scaling'
      ? 'The growth system is moving beyond observation and has enough signal to scale proven motions.'
      : `The growth system is currently in the ${stage} stage and still needs stronger operating discipline before scale.`,
    why_this_matters: 'Maturity determines whether the next move should be instrumentation, optimization, or acceleration.',
  };
}

function buildLeakageSummary(data: BehaviorReportData): {
  decision_summary: string;
  why_this_matters: string;
} {
  const topDrop = data.drop_off_pages[0];
  const engagementStep = data.funnel.steps.find((step) => step.step === 'engagement');

  if (topDrop && topDrop.drop_off_rate > 0.6) {
    return {
      decision_summary: `Most users are leaving on ${topDrop.page_url} before they move deeper into the journey.`,
      why_this_matters: 'Reducing early leakage preserves the demand you already paid or worked to acquire.',
    };
  }

  if ((engagementStep?.drop_pct ?? 0) > 0.4) {
    return {
      decision_summary: 'Top-of-funnel messaging is not carrying enough visitors into active engagement.',
      why_this_matters: 'Better early-stage relevance improves the number of sessions that become qualified opportunities.',
    };
  }

  return {
    decision_summary: 'The funnel is holding reasonably well at the top, with only localized leakage to address.',
    why_this_matters: 'Stable leakage means conversion effort can shift from patching exits to improving downstream efficiency.',
  };
}

function buildContentSummary(
  topConvertingPages: PerformanceReportMappedData['content']['top_converting_pages'],
  highTrafficLowConversionPages: PerformanceReportMappedData['content']['high_traffic_low_conversion_pages'],
): { decision_summary: string; why_this_matters: string } {
  if (highTrafficLowConversionPages.length > 0) {
    return {
      decision_summary: `Traffic is reaching ${highTrafficLowConversionPages[0]?.page_url ?? 'key pages'}, but the page experience is not turning enough of that attention into leads.`,
      why_this_matters: 'Improving converting content compounds value from existing traffic before more spend is added.',
    };
  }

  if (topConvertingPages.length > 0) {
    return {
      decision_summary: `Pages like ${topConvertingPages[0]?.page_url ?? 'your strongest assets'} are already proving what content converts, so similar patterns should be extended.`,
      why_this_matters: 'Knowing which pages convert best helps replicate winning message and CTA patterns across the site.',
    };
  }

  return {
    decision_summary: 'Content performance signal is still limited, so page-level lead intelligence is early.',
    why_this_matters: 'Without page-level winners and losers, it is hard to prioritize which content should be improved first.',
  };
}

function buildOrganicSearchSummary(
  search: PerformanceSearchIntelligence | null | undefined,
): { decision_summary: string; why_this_matters: string } {
  if (!search || search.readiness.status === 'no_keyword_data') {
    return {
      decision_summary: 'Organic search intelligence is not deep enough yet because Search Console keyword/page data is still missing.',
      why_this_matters: 'Search Console explains demand before users arrive, which is required to separate visibility problems from landing-page problems.',
    };
  }

  const priority = search.opportunities[0];
  if (priority) {
    return {
      decision_summary: priority.title,
      why_this_matters: 'Blending Search Console visibility with Google Analytics behavior shows which organic opportunities are most likely to improve demand capture.',
    };
  }

  return {
    decision_summary: search.summaries.search_demand_vs_conversion_quality,
    why_this_matters: 'Organic search intelligence connects pre-click demand, landing-page quality, and conversion efficiency.',
  };
}

function buildBehaviorQualitySummary(
  behavior: PerformanceBehaviorIntelligence | null | undefined,
): { decision_summary: string; why_this_matters: string } {
  if (!behavior) {
    return {
      decision_summary: 'Behavior quality intelligence is not available yet.',
      why_this_matters: 'GA engagement and conversion confidence help separate low-volume noise from real performance problems.',
    };
  }
  const weakPage = behavior.landing_page_insights.find((item) => item.severity === 'high');
  if (weakPage) {
    return {
      decision_summary: weakPage.diagnosis,
      why_this_matters: 'Prioritizing weak pages by confidence prevents the team from reacting to noisy low-volume signals.',
    };
  }
  return {
    decision_summary: behavior.summaries.engagement_quality,
    why_this_matters: 'Behavior quality explains whether traffic is qualified enough to justify more content, campaigns, or page optimization.',
  };
}

function buildDiagnosisSummary(
  frictionPoints: string[],
  messagingIssues: string[],
  ctaGaps: string[],
): { decision_summary: string; why_this_matters: string } {
  if (ctaGaps.length > 0) {
    return {
      decision_summary: 'The strongest conversion blockers are appearing late in the journey, where users need a clearer or easier next step.',
      why_this_matters: 'Fixing CTA and form friction improves how many engaged visitors actually become leads.',
    };
  }

  if (messagingIssues.length > 0) {
    return {
      decision_summary: 'Message-to-intent alignment is weak, so visitors are not seeing enough relevance after they land.',
      why_this_matters: 'Sharper messaging reduces bounce risk and increases the share of traffic that becomes pipeline.',
    };
  }

  if (frictionPoints.length > 0) {
    return {
      decision_summary: 'Conversion friction is present, but concentrated enough that a few targeted fixes can move performance.',
      why_this_matters: 'Targeted diagnosis prevents teams from making broad changes when only a few points are actually leaking demand.',
    };
  }

  return {
    decision_summary: 'No major conversion blockers stand out yet, so improvement should focus on amplification rather than repair.',
    why_this_matters: 'When friction is low, the best gains usually come from scaling proven pages and channels.',
  };
}

function classifyCampaignItem(
  item: PerformanceCampaignItem,
  data: BehaviorReportData,
): PerformanceReportMappedData['campaigns']['items'][number] {
  const normalizedStatus = item.status.trim().toLowerCase();
  const updatedAt = item.updated_at ? new Date(item.updated_at).getTime() : 0;
  const daysSinceUpdate = updatedAt > 0 ? (Date.now() - updatedAt) / 86400000 : Number.POSITIVE_INFINITY;

  if (!item.name || normalizedStatus === 'draft' || normalizedStatus === 'paused' || daysSinceUpdate > 45) {
    return {
      ...item,
      classification: 'inactive_or_missing',
      reason: 'This campaign is inactive or stale, so it is unlikely to be contributing meaningfully to current lead flow.',
    };
  }

  if (data.conversions.total_conversions > 0 && data.session_metrics.conversion_rate >= 0.05) {
    return {
      ...item,
      classification: 'effective',
      reason: 'Campaign activity is present while the overall lead system is converting, so this campaign is likely supporting demand capture.',
    };
  }

  return {
    ...item,
    classification: 'engaging_but_not_converting',
    reason: 'Campaign activity exists, but conversion yield is weak, so traffic and landing experience are likely misaligned.',
  };
}

function buildCampaignSummary(
  items: PerformanceReportMappedData['campaigns']['items'],
): { decision_summary: string; why_this_matters: string; effectiveness_summary: string } {
  if (items.length === 0) {
    return {
      decision_summary: 'Campaign activity is missing or disconnected, so lead-generation performance cannot yet be tied back to active growth programs.',
      why_this_matters: 'Without campaign-to-outcome visibility, budget decisions stay reactive and hard to defend.',
      effectiveness_summary: 'Campaign effectiveness data is not connected yet.',
    };
  }

  const effective = items.filter((item) => item.classification === 'effective').length;
  const weak = items.filter((item) => item.classification === 'engaging_but_not_converting').length;

  if (weak > 0 && effective === 0) {
    return {
      decision_summary: 'Campaign activity exists but is not aligned with the pages and flows that convert.',
      why_this_matters: 'Campaign dollars create growth only when they reach traffic that progresses into lead capture.',
      effectiveness_summary: `${weak} active campaign${weak === 1 ? '' : 's'} need tighter conversion alignment.`,
    };
  }

  if (effective > 0) {
    return {
      decision_summary: 'Some campaign activity is supporting lead generation, but only a subset appears strong enough to scale confidently.',
      why_this_matters: 'Finding which campaigns truly support conversions helps reallocate effort toward productive demand creation.',
      effectiveness_summary: `${effective} campaign${effective === 1 ? '' : 's'} appear effective, with the rest needing refinement or reactivation.`,
    };
  }

  return {
    decision_summary: 'Campaign coverage exists, but most records are inactive or too stale to influence current lead growth.',
    why_this_matters: 'An inactive campaign layer leaves the business dependent on passive acquisition instead of directed demand generation.',
    effectiveness_summary: `${items.length} campaign record${items.length === 1 ? '' : 's'} found, but recent performance signal is limited.`,
  };
}

function classifyEngagement(
  consumed: number,
  acted: number,
  pending: number,
  marketpulseUsage: string,
): PerformanceReportMappedData['engagement'] {
  const followThroughRate = safeDiv(acted, consumed || 0);
  let stage: PerformanceReportMappedData['engagement']['stage'] = 'observing';

  if (acted >= 5 && followThroughRate >= 0.6) {
    stage = 'scaling';
  } else if (acted >= 2) {
    stage = 'executing';
  } else if (pending > 0 || consumed > 0) {
    stage = 'experimenting';
  }

  let decisionSummary = 'Insight consumption is limited, so the system is still mostly observing rather than improving behavior.';
  if (consumed > 0 && acted === 0) {
    decisionSummary = 'You are consuming insights but not acting on them yet.';
  } else if (acted > 0 && acted < consumed) {
    decisionSummary = 'You are starting to act on insights, but follow-through is not strong enough to compound results.';
  } else if (acted >= consumed && acted > 0) {
    decisionSummary = 'The team is consistently acting on intelligence, which strengthens the feedback loop from insight to execution.';
  }

  return {
    marketpulse_usage: marketpulseUsage,
    insights_consumed: consumed,
    insights_acted: acted,
    stage,
    decision_summary: decisionSummary,
    why_this_matters: 'Engagement intelligence only improves growth when insights turn into real changes in campaigns, pages, or follow-up.',
  };
}

function buildLeadActivation(
  leadsCaptured: number,
  leadsActedUpon: number,
): PerformanceReportMappedData['lead_activation'] {
  const followUpGap = Math.max(0, leadsCaptured - leadsActedUpon);
  const followUpRate = Number(safeDiv(leadsActedUpon, leadsCaptured).toFixed(4));

  let decisionSummary = 'Lead capture is modest, and follow-up activity is still too limited to validate activation efficiency.';
  if (leadsCaptured > 0 && leadsActedUpon === 0) {
    decisionSummary = 'Leads are being generated but not actively pursued after capture.';
  } else if (followUpGap > 0) {
    decisionSummary = 'Lead generation is outpacing follow-up, so captured demand is at risk of going cold.';
  } else if (leadsCaptured > 0) {
    decisionSummary = 'Lead capture and follow-up are moving in step, which supports faster conversion learning.';
  }

  return {
    leads_captured: leadsCaptured,
    leads_acted_upon: leadsActedUpon,
    follow_up_gap: followUpGap,
    follow_up_rate: followUpRate,
    engagement_capture_gap: followUpGap,
    decision_summary: decisionSummary,
    why_this_matters: 'Lead activation determines whether captured demand becomes pipeline or simply sits unworked.',
  };
}

export function mapPerformanceReportData(
  data: BehaviorReportData,
  context?: PerformanceMapperContext,
): PerformanceReportMappedData {
  // rankRecommendations is preserved for callers that need the raw ordering;
  // the consolidator below produces the calibrated list used by the renderer.
  void rankRecommendations;
  const sourceRows = data.traffic_sources.map((item) => ({
    channel: item.source_medium !== 'unknown' ? `${item.traffic_source} / ${item.source_medium}` : item.traffic_source,
    sessions: item.sessions,
    events: item.events,
    leads: item.conversions,
    conversion_rate: Number(safeDiv(item.conversions, item.sessions).toFixed(4)),
    engagement_rate: Number(safeDiv(item.events, item.sessions).toFixed(2)),
  })).sort((a, b) => b.leads - a.leads || b.sessions - a.sessions);

  const topConvertingPages = [...data.top_pages]
    .map((item) => ({
      page_url: item.page_url,
      conversions: item.conversions,
      visits: item.visits,
      conversion_rate: Number(safeDiv(item.conversions, item.visits).toFixed(4)),
    }))
    .sort((a, b) => b.conversions - a.conversions || b.conversion_rate - a.conversion_rate)
    .slice(0, 5);

  const highTrafficLowConversionPages = [...data.top_pages]
    .map((item) => ({
      page_url: item.page_url,
      visits: item.visits,
      conversions: item.conversions,
      conversion_rate: Number(safeDiv(item.conversions, item.visits).toFixed(4)),
    }))
    .filter((item) => item.visits >= 10)
    .sort((a, b) => (b.visits - a.visits) || (a.conversion_rate - b.conversion_rate))
    .slice(0, 5);

  const frictionPoints = data.insights
    .filter((item) => item.type === 'drop_off' || item.type === 'funnel')
    .map((item) => item.message);
  const messagingIssues = data.recommendations
    .filter((item) => item.type === 'messaging_fix' || item.type === 'content_optimization')
    .map((item) => item.reasoning);
  const ctaGaps = data.recommendations
    .filter((item) => item.type === 'cta_optimization' || item.type === 'conversion_optimization')
    .map((item) => item.reasoning);
  const leakageSummary = buildLeakageSummary(data);
  const contentSummary = buildContentSummary(topConvertingPages, highTrafficLowConversionPages);
  const organicSearchSummary = buildOrganicSearchSummary(context?.searchIntelligence);
  const behaviorQualitySummary = buildBehaviorQualitySummary(context?.behaviorIntelligence);
  const diagnosisSummary = buildDiagnosisSummary(frictionPoints, messagingIssues, ctaGaps);
  const platformFit = inferPlatformFit(sourceRows);
  const campaignItems = (context?.campaigns ?? []).map((item) => classifyCampaignItem(item, data));
  const campaignSummary = buildCampaignSummary(campaignItems);
  const engagement = classifyEngagement(
    data.insights.length,
    context?.engagement?.recommendations_implemented ?? 0,
    context?.engagement?.recommendations_pending ?? 0,
    context?.engagement?.marketpulse_usage_summary ?? 'MarketPulse usage data is not connected yet.',
  );
  const leadActivation = buildLeadActivation(
    data.conversions.total_conversions,
    context?.engagement?.recommendations_implemented ?? 0,
  );
  // ── Pre-drill calibration: consolidate + calibrate before slicing. ──────────
  // 1. Dedupe BehaviorRecommendations (groups items that say the same thing).
  // 2. Dedupe SearchOpportunities (kills SEO repeats on the same page).
  // 3. Re-rank using tier-damped weights (weak-data items can't outrank
  //    confirmed ones even when their nominal priority is high).
  // 4. Soften language for non-confirmed tiers (prefix/suffix tentativity).
  const behaviorConsolidated = consolidateBehaviorRecommendations(data.recommendations);
  const searchConsolidated = consolidateSearchOpportunities(context?.searchIntelligence?.opportunities ?? []);
  const consolidatedRanked = rankConsolidatedRecommendations(behaviorConsolidated);
  const converged = buildConvergedNextMoves(consolidatedRanked, searchConsolidated);
  const rankedSearchOpportunities = [...(context?.searchIntelligence?.opportunities ?? [])]
    .filter((item) => item.confidence !== 'none')
    .filter((item) => item.confidence !== 'low' || item.severity === 'high')
    .sort((a, b) => rankSearchOpportunity(b) - rankSearchOpportunity(a))
    .slice(0, 6);
  const rankedKeywordOpportunities = [...(context?.searchIntelligence?.keyword_opportunities ?? [])]
    .filter((item) => item.confidence !== 'low')
    .sort((a, b) => rankKeywordOpportunity(b) - rankKeywordOpportunity(a))
    .slice(0, 6);
  const opportunityThemes = buildOpportunityThemes(rankedSearchOpportunities, rankedKeywordOpportunities);

  const nextMoves = consolidatedRanked.slice(0, 5).map((c) => {
    const tier = tierForBehavior(c.representative);
    const { text } = softenLanguage(specificActionForRecommendation(c.representative), tier);
    return {
      action: text,
      impact: recommendationExpectedImpact(c.representative),
      effort: c.representative.effort_level,
      source: c.group_size > 1
        ? `${sectionSourceLabel(c.representative)} · ${c.group_size} similar`
        : sectionSourceLabel(c.representative),
      priority: c.representative.priority,
      confidence_tier: tier,
      trigger: buildRecommendationTrigger(c.representative),
      why_it_matters: buildRecommendationWhyItMatters(c.representative),
      page_url: pageUrlFromRecommendation(c.representative),
    };
  });
  const focusThisWeek = consolidatedRanked
    .filter((c) => c.representative.priority === 'high' && tierForBehavior(c.representative) !== 'weak_data')
    .sort((a, b) => {
      const impactDelta = impactEstimateRank(b.representative.impact_estimate) - impactEstimateRank(a.representative.impact_estimate);
      if (impactDelta !== 0) return impactDelta;
      const effortDelta = effortRank(a.representative.effort_level) - effortRank(b.representative.effort_level);
      if (effortDelta !== 0) return effortDelta;
      return recommendationImpactWeight(b.representative) - recommendationImpactWeight(a.representative);
    })
    .slice(0, 5)
    .map((c) => {
      const tier = tierForBehavior(c.representative);
      const { text } = softenLanguage(specificActionForRecommendation(c.representative), tier);
      return {
        action: text,
        impact: c.representative.impact_estimate,
        effort: c.representative.effort_level,
        source: c.group_size > 1
          ? `${sectionSourceLabel(c.representative)} · ${c.group_size} similar`
          : sectionSourceLabel(c.representative),
        confidence_tier: tier,
        trigger: buildRecommendationTrigger(c.representative),
        page_url: pageUrlFromRecommendation(c.representative),
      };
    });

  // Build the confidence tier distribution + per-next-move tier labels.
  const confidenceDistribution = { confirmed: 0, directional: 0, hypothesis: 0, weak_data: 0 };
  const nextMoveTiers: Array<{ action: string; tier: ConfidenceTier; tier_label: string }> = [];
  for (const c of consolidatedRanked) {
    const tier = tierForBehavior(c.representative);
    confidenceDistribution[tier]++;
    nextMoveTiers.push({ action: c.representative.message, tier, tier_label: tierLabel(tier) });
  }

  const mapped: PerformanceReportMappedData = {
    lead_summary: {
      total_leads: data.conversions.total_conversions,
      conversion_rate: data.session_metrics.conversion_rate,
      best_channel: bestChannelLabel(data),
      biggest_drop_off: biggestDropOffLabel(data),
      diagnosis: oneLineDiagnosis(data),
      decision_summary: oneLineDiagnosis(data),
      why_this_matters: 'This summary shows where lead generation is strongest and where the current journey is losing qualified demand.',
    },
    leakage: {
      funnel_steps: data.funnel.steps,
      top_drop_off_pages: data.drop_off_pages.slice(0, 5),
      ...leakageSummary,
    },
    sources: sourceRows,
    platform_fit: platformFit,
    content: {
      top_converting_pages: topConvertingPages,
      high_traffic_low_conversion_pages: highTrafficLowConversionPages,
      ...contentSummary,
    },
    organic_search: {
      data_confidence: context?.searchIntelligence?.data_confidence ?? 'none',
      insight_confidence: context?.searchIntelligence?.insight_confidence ?? 'none',
      recommendation_confidence: context?.searchIntelligence?.recommendation_confidence ?? 'none',
      readiness_status: context?.searchIntelligence?.readiness.status ?? 'no_keyword_data',
      organic_visibility_summary: context?.searchIntelligence?.summaries.organic_visibility ?? 'Organic search visibility is not measurable yet.',
      demand_quality_summary: context?.searchIntelligence?.summaries.search_demand_vs_conversion_quality ?? 'Search demand and conversion quality cannot be compared yet.',
      landing_page_weakness_summary: context?.searchIntelligence?.summaries.landing_page_weakness ?? 'Organic landing-page weakness cannot be diagnosed yet.',
      joined_pages: context?.searchIntelligence?.joined_pages.slice(0, 10) ?? [],
      opportunities: rankedSearchOpportunities,
      keyword_opportunities: rankedKeywordOpportunities,
      opportunity_themes: opportunityThemes,
      ...organicSearchSummary,
    },
    behavior_quality: {
      engagement_confidence: context?.behaviorIntelligence?.engagement_confidence ?? 'none',
      traffic_quality_confidence: context?.behaviorIntelligence?.traffic_quality_confidence ?? 'none',
      conversion_confidence: context?.behaviorIntelligence?.conversion_confidence ?? 'none',
      engagement_summary: context?.behaviorIntelligence?.summaries.engagement_quality ?? 'GA engagement quality is not measurable yet.',
      traffic_summary: context?.behaviorIntelligence?.summaries.traffic_quality ?? 'Traffic quality needs more volume before confident diagnosis.',
      conversion_summary: context?.behaviorIntelligence?.summaries.conversion_quality ?? 'Conversion quality needs more tracked conversions before confident diagnosis.',
      current: context?.behaviorIntelligence?.current ?? null,
      deltas: context?.behaviorIntelligence?.deltas ?? null,
      device_insights: context?.behaviorIntelligence?.device_insights.slice(0, 6) ?? [],
      source_insights: context?.behaviorIntelligence?.source_insights.slice(0, 6) ?? [],
      landing_page_insights: (context?.behaviorIntelligence?.landing_page_insights ?? [])
        .filter((item) => item.confidence !== 'low' || item.severity === 'high')
        .slice(0, 6),
      ...behaviorQualitySummary,
    },
    diagnosis: {
      friction_points: frictionPoints,
      messaging_issues: messagingIssues,
      cta_gaps: ctaGaps,
      ...diagnosisSummary,
    },
    actions: {
      // Pre-drill calibration: actions are now drawn from the consolidated +
      // tier-damped list so the rendered cards no longer repeat near-identical
      // recommendations. Each card's `message` is also softened by tier in
      // the renderer's pipeline (via confidence_breakdown.next_move_tiers).
      quick_wins: consolidatedRanked
        .filter((c) => c.representative.priority === 'high' && tierForBehavior(c.representative) !== 'weak_data')
        .slice(0, 3)
        .map((c) => c.representative),
      growth_levers: consolidatedRanked
        .filter((c) => c.representative.priority === 'medium')
        .slice(0, 3)
        .map((c) => c.representative),
      strategic_bets: consolidatedRanked
        .filter((c) => c.representative.priority === 'low')
        .slice(0, 3)
        .map((c) => c.representative),
      decision_summary: consolidatedRanked.length > 0
        ? 'The action plan is clear: fix immediate leakage first, then scale channels and pages that already show conversion signal.'
        : 'There are not enough prioritized actions yet to build a confident execution plan.',
      why_this_matters: 'A strong plan turns analytics into sequenced work instead of disconnected observations.',
    },
    campaigns: {
      total_campaigns: campaignItems.length,
      effectiveness_summary: campaignSummary.effectiveness_summary,
      decision_summary: campaignSummary.decision_summary,
      why_this_matters: campaignSummary.why_this_matters,
      items: campaignItems,
    },
    engagement,
    lead_activation: leadActivation,
    maturity: inferMaturity(data),
    next_moves: nextMoves,
    focus_this_week: focusThisWeek,
    competitive_pressure_analysis: context?.competitivePressureAnalysis ?? null,
    snapshot_foundation: context?.snapshotFoundation ?? null,
  };

  // ── "What matters most" + consolidation breakdown ──────────────────────────
  // Compute headline + top risks/opportunities/next steps from the consolidated
  // + calibrated outputs (not from rankedRecommendations) so this surface
  // inherits all dedup + confidence calibration done above.
  const whatMattersMost = buildWhatMattersMost({
    behaviorConsolidated: consolidatedRanked,
    searchConsolidated: searchConsolidated,
    converged,
    classifyConfidenceTier: ({ upstream, sample, severity }) =>
      classifyConfidenceTier({
        upstreamConfidence: upstream,
        sampleSize: sample,
        severity: severity ?? null,
      }),
    totalLeads: data.conversions.total_conversions,
    conversionRate: data.session_metrics.conversion_rate,
    topRiskAnchor: data.drop_off_pages[0]?.page_url ?? null,
  });

  mapped.what_matters_most = whatMattersMost;
  mapped.consolidation = {
    behavior_consolidated_count: consolidatedRanked.length,
    behavior_raw_count: data.recommendations.length,
    search_consolidated_count: searchConsolidated.length,
    search_raw_count: context?.searchIntelligence?.opportunities.length ?? 0,
    next_moves_converged: converged.slice(0, 8),
  };
  mapped.confidence_breakdown = {
    distribution: confidenceDistribution,
    next_move_tiers: nextMoveTiers,
  };

  return mapped;
}
