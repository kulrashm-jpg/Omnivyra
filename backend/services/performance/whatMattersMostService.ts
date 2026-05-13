/**
 * Performance Intelligence — "What Matters Most" Surfacing Service.
 *
 * Pre-drill calibration: builds the top-of-report panel that answers three
 * questions in 6 cards or less:
 *
 *   1. What are the biggest risks right now?       (top 2 risk items)
 *   2. What are the biggest opportunities?         (top 2 opportunity items)
 *   3. What's the most actionable next step?       (top 2 next-step items)
 *
 * Pulls from the consolidated + calibrated outputs (not raw recommendations)
 * so this surface inherits all dedup + confidence calibration upstream.
 *
 * No DB writes. Pure derivation.
 */

import type { BehaviorRecommendation } from '../behaviorRecommendationService';
import type { SearchOpportunity } from '../performanceSearchIntelligenceService';
import type {
  ConsolidatedBehaviorRecommendation,
  ConsolidatedSearchOpportunity,
  ConvergedNextMove,
} from './recommendationConsolidator';
import type { ConfidenceTier } from './confidenceCalibrationService';

export type WhatMattersItemKind = 'risk' | 'opportunity' | 'next_step';

export interface WhatMattersItem {
  kind: WhatMattersItemKind;
  title: string;
  rationale: string;
  source: string;
  /** Calibrated confidence tier for the underlying signal. */
  confidence_tier: ConfidenceTier;
  /** Optional anchor — a page URL or section the user should look at. */
  anchor?: string | null;
  /** Optional impact phrase — kept short for the card. */
  impact?: string | null;
}

export interface WhatMattersMost {
  risks: WhatMattersItem[];
  opportunities: WhatMattersItem[];
  next_steps: WhatMattersItem[];
  /** Hero summary line — one sentence describing the report's headline reality. */
  headline: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TIER_RANK: Record<ConfidenceTier, number> = {
  confirmed: 4, directional: 3, hypothesis: 2, weak_data: 1,
};

function numericImpact(value: string | null | undefined): number {
  const numbers = String(value ?? '').match(/\d+/g)?.map((item) => Number(item)) ?? [];
  return Math.max(...numbers, 0);
}

function similarityCount(source: string): number {
  const match = source.match(/(\d+)\s+similar/i);
  return match ? Number(match[1]) : 1;
}

function whatMattersScore(item: WhatMattersItem): number {
  const sourceBoost = item.source.includes('+') ? 30 : item.source.includes('Search Console') ? 12 : 8;
  return (
    TIER_RANK[item.confidence_tier] * 100 +
    Math.min(40, numericImpact(item.impact)) +
    Math.min(24, similarityCount(item.source) * 8) +
    sourceBoost
  );
}

function isRiskRecommendation(rec: BehaviorRecommendation): boolean {
  // Drop-off + funnel-tagged recommendations are risk-shaped (loss of demand).
  return rec.linked_insight === 'drop_off' || rec.linked_insight === 'funnel';
}

function isOpportunityRecommendation(rec: BehaviorRecommendation): boolean {
  // Conversion / cta / content optimization on already-trafficked pages
  // = capture demand we already paid for.
  return (
    rec.type === 'conversion_optimization' ||
    rec.type === 'cta_optimization' ||
    rec.type === 'content_optimization' ||
    rec.type === 'traffic_alignment'
  );
}

function isRiskSearchOpp(opp: SearchOpportunity): boolean {
  return opp.type === 'organic_decline' || opp.type === 'visibility_engagement_gap' ||
    opp.type === 'landing_page_experience_gap';
}

function isOpportunitySearchOpp(opp: SearchOpportunity): boolean {
  return opp.type === 'organic_rise' || opp.type === 'ctr_opportunity' ||
    opp.type === 'ranking_opportunity' || opp.type === 'traffic_conversion_gap';
}

// ─────────────────────────────────────────────────────────────────────────────
// Build helpers
// ─────────────────────────────────────────────────────────────────────────────

interface ScoredCandidate<T> {
  source: T;
  tier: ConfidenceTier;
  rank: number;
}

function buildRiskItems(
  behaviorConsolidated: ConsolidatedBehaviorRecommendation[],
  searchConsolidated: ConsolidatedSearchOpportunity[],
  tierOf: (input: { upstream?: string; sample?: number; severity?: 'high'|'medium'|'low' }) => ConfidenceTier,
): WhatMattersItem[] {
  const candidates: WhatMattersItem[] = [];

  for (const c of behaviorConsolidated) {
    const rep = c.representative;
    if (!isRiskRecommendation(rep)) continue;
    const sample = Number(rep.context?.entry_sessions ?? rep.context?.sessions ?? rep.context?.visits ?? 0);
    const tier = tierOf({
      upstream: c.composite_confidence,
      sample,
      severity: rep.priority,
    });
    if (tier === 'weak_data') continue; // never surface weak-data risks above the fold
    candidates.push({
      kind: 'risk',
      title: rep.message,
      rationale: rep.reasoning,
      source: c.group_size > 1
        ? `Behavior · ${c.group_size} similar findings`
        : 'Behavior',
      confidence_tier: tier,
      anchor: rep.context?.page_url ? String(rep.context.page_url) : null,
      impact: rep.impact_estimate,
    });
  }

  for (const c of searchConsolidated) {
    const rep = c.representative;
    if (!isRiskSearchOpp(rep)) continue;
    const sample = Number(rep.evidence?.impressions ?? rep.evidence?.clicks ?? 0);
    const tier = tierOf({
      upstream: rep.confidence,
      sample,
      severity: rep.severity,
    });
    if (tier === 'weak_data') continue;
    candidates.push({
      kind: 'risk',
      title: rep.title,
      rationale: rep.recommendation,
      source: c.group_size > 1 ? `Search Console · ${c.group_size} similar` : 'Search Console',
      confidence_tier: tier,
      anchor: rep.page_url,
      impact: null,
    });
  }

  // Rank by confidence first, then estimated impact and corroboration count.
  candidates.sort((a, b) => whatMattersScore(b) - whatMattersScore(a));
  return candidates.slice(0, 2);
}

function buildOpportunityItems(
  behaviorConsolidated: ConsolidatedBehaviorRecommendation[],
  searchConsolidated: ConsolidatedSearchOpportunity[],
  tierOf: (input: { upstream?: string; sample?: number; severity?: 'high'|'medium'|'low' }) => ConfidenceTier,
): WhatMattersItem[] {
  const candidates: WhatMattersItem[] = [];

  for (const c of behaviorConsolidated) {
    const rep = c.representative;
    if (!isOpportunityRecommendation(rep)) continue;
    const sample = Number(rep.context?.visits ?? rep.context?.sessions ?? rep.context?.users ?? 0);
    const tier = tierOf({
      upstream: c.composite_confidence,
      sample,
      severity: rep.priority,
    });
    if (tier === 'weak_data') continue;
    candidates.push({
      kind: 'opportunity',
      title: rep.message,
      rationale: rep.reasoning,
      source: c.group_size > 1 ? `Behavior · ${c.group_size} similar findings` : 'Behavior',
      confidence_tier: tier,
      anchor: rep.context?.page_url ? String(rep.context.page_url) : null,
      impact: rep.impact_estimate,
    });
  }

  for (const c of searchConsolidated) {
    const rep = c.representative;
    if (!isOpportunitySearchOpp(rep)) continue;
    const sample = Number(rep.evidence?.impressions ?? rep.evidence?.clicks ?? 0);
    const tier = tierOf({
      upstream: rep.confidence,
      sample,
      severity: rep.severity,
    });
    if (tier === 'weak_data') continue;
    candidates.push({
      kind: 'opportunity',
      title: rep.title,
      rationale: rep.recommendation,
      source: c.group_size > 1 ? `Search Console · ${c.group_size} similar` : 'Search Console',
      confidence_tier: tier,
      anchor: rep.page_url,
      impact: null,
    });
  }

  candidates.sort((a, b) => whatMattersScore(b) - whatMattersScore(a));
  return candidates.slice(0, 2);
}

function buildNextSteps(
  converged: ConvergedNextMove[],
  tierOf: (input: { upstream?: string; sample?: number; severity?: 'high'|'medium'|'low' }) => ConfidenceTier,
): WhatMattersItem[] {
  const candidates: WhatMattersItem[] = [];
  for (const c of converged) {
    const sample = Number(
      c.behavior?.context?.entry_sessions ??
      c.behavior?.context?.sessions ??
      c.behavior?.context?.visits ??
      c.search?.evidence?.impressions ??
      0,
    );
    const tier = tierOf({
      upstream: c.combined_confidence,
      sample,
      severity:
        c.behavior?.priority ??
        (c.search?.severity as 'high'|'medium'|'low' | undefined) ??
        'medium',
    });
    if (tier === 'weak_data') continue;
    const title = c.behavior?.message ?? c.search?.title ?? 'Improve a high-traffic page';
    const rationale = c.behavior?.reasoning ?? c.search?.recommendation ?? '';
    const impact = c.behavior?.impact_estimate ?? null;
    candidates.push({
      kind: 'next_step',
      title,
      rationale,
      source: c.source_label,
      confidence_tier: tier,
      anchor: c.page_url,
      impact,
    });
  }
  // Convergent (both sources) wins over single-source.
  candidates.sort((a, b) => {
    const aBoth = a.source.includes('+') ? 1 : 0;
    const bBoth = b.source.includes('+') ? 1 : 0;
    if (aBoth !== bBoth) return bBoth - aBoth;
    return TIER_RANK[b.confidence_tier] - TIER_RANK[a.confidence_tier];
  });
  return candidates.slice(0, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildWhatMattersInput {
  behaviorConsolidated: ConsolidatedBehaviorRecommendation[];
  searchConsolidated: ConsolidatedSearchOpportunity[];
  converged: ConvergedNextMove[];
  classifyConfidenceTier: (input: { upstream?: string; sample?: number; severity?: 'high'|'medium'|'low' }) => ConfidenceTier;
  /** From mapped data — used to draft the headline. */
  totalLeads: number;
  conversionRate: number;
  topRiskAnchor?: string | null;
  marketDirectionWord?: 'expanding' | 'contracting' | 'mixed' | 'stable' | null;
}

function buildHeadline(input: BuildWhatMattersInput, risks: WhatMattersItem[], opportunities: WhatMattersItem[]): string {
  const r = risks.length;
  const o = opportunities.length;
  const conv = input.conversionRate > 0 ? `${(input.conversionRate * 100).toFixed(1)}% conversion` : 'no measurable conversion yet';
  if (r === 0 && o === 0) {
    return `Performance is stable; ${conv} on ${input.totalLeads.toLocaleString('en-US')} leads — no urgent calls to action this cycle.`;
  }
  if (r > 0 && o === 0) {
    return `${r} risk${r === 1 ? '' : 's'} need attention; ${conv} on ${input.totalLeads.toLocaleString('en-US')} leads. Address risk first.`;
  }
  if (o > 0 && r === 0) {
    return `${o} opportunit${o === 1 ? 'y' : 'ies'} surfaced; ${conv} on ${input.totalLeads.toLocaleString('en-US')} leads. Capture posture suggested.`;
  }
  return `${r} risk${r === 1 ? '' : 's'} and ${o} opportunit${o === 1 ? 'y' : 'ies'} stand out; ${conv} on ${input.totalLeads.toLocaleString('en-US')} leads. Sequence risk fixes ahead of new bets.`;
}

export function buildWhatMattersMost(input: BuildWhatMattersInput): WhatMattersMost {
  const risks = buildRiskItems(input.behaviorConsolidated, input.searchConsolidated, input.classifyConfidenceTier);
  const opportunities = buildOpportunityItems(input.behaviorConsolidated, input.searchConsolidated, input.classifyConfidenceTier);
  const next_steps = buildNextSteps(input.converged, input.classifyConfidenceTier);
  const headline = buildHeadline(input, risks, opportunities);
  return { risks, opportunities, next_steps, headline };
}
