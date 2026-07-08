/** Part 1/2 of performanceReportMapper.ts — verbatim split (barrel preserved; importers unchanged). */
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

import { mapPerformanceReportData } from './performanceReportMapperAssembly';

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

export function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

export function recommendationImpactWeight(item: BehaviorRecommendation): number {
  return Math.max(
    Number(item.context?.entry_sessions ?? 0),
    Number(item.context?.sessions ?? 0),
    Number(item.context?.visits ?? 0),
    Number(item.context?.users ?? 0),
  );
}

export function rankRecommendations(items: BehaviorRecommendation[]): BehaviorRecommendation[] {
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
export function tierForBehavior(item: BehaviorRecommendation): ConfidenceTier {
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
export function rankConsolidatedRecommendations(
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

export function impactEstimateRank(value: string): number {
  const normalized = value.replace(/–/g, '-');
  const numbers = normalized.match(/\d+/g)?.map((item) => Number(item)) ?? [];
  return Math.max(...numbers, 0);
}

export function effortRank(value: BehaviorRecommendation['effort_level']): number {
  if (value === 'low') return 1;
  if (value === 'medium') return 2;
  return 3;
}

export function bestChannelLabel(data: BehaviorReportData): string {
  if (data.traffic_sources.length === 0) return 'No channel data available';
  const ranked = [...data.traffic_sources]
    .map((item) => ({
      label: item.source_medium !== 'unknown' ? `${item.traffic_source} / ${item.source_medium}` : item.traffic_source,
      score: item.conversions * 1000 + item.sessions,
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.label ?? 'No channel data available';
}

export function sectionSourceLabel(recommendation: BehaviorRecommendation): string {
  if (recommendation.linked_insight === 'drop_off') return 'Lead Leakage';
  if (recommendation.linked_insight === 'funnel') return 'Conversion Diagnosis';
  if (recommendation.linked_insight === 'traffic_quality') return 'Lead Sources';
  return 'Content Intelligence';
}

export function recommendationExpectedImpact(recommendation: BehaviorRecommendation): string {
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

export function pageUrlFromRecommendation(recommendation: BehaviorRecommendation): string | null {
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

export function buildRecommendationTrigger(recommendation: BehaviorRecommendation): string {
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

export function buildRecommendationWhyItMatters(recommendation: BehaviorRecommendation): string {
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

export function specificActionForRecommendation(recommendation: BehaviorRecommendation): string {
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

export function rankSearchOpportunity(item: PerformanceSearchIntelligence['opportunities'][number]): number {
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

export function rankKeywordOpportunity(item: PerformanceSearchIntelligence['keyword_opportunities'][number]): number {
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

export function buildOpportunityThemes(
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

