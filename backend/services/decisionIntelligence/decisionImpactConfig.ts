/**
 * Decision Intelligence business-impact configuration (Phase 24). Config only — the Platform
 * Business Impact Engine owns the machinery. The decision layer's own recommendations are
 * STRATEGIC/cross-cutting (sequence, focus, unblock) — domain recommendations stay owned by
 * their own plugins, so nothing is duplicated globally.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type DecisionDimension = Extract<ImpactDimension, 'revenue' | 'pipeline' | 'marketing' | 'conversion' | 'authority' | 'leads'>;

export const DECISION_IMPACT_CONFIG: ImpactGraphConfig<DecisionDimension> = {
  graph: {
    focus_weakest_domain: { dimensions: { marketing: 60, revenue: 50, conversion: 45 }, cascade: ['Weakest domain drags the whole', 'Compounding underperformance', 'Lower overall growth'] },
    unblock_prerequisite: { dimensions: { pipeline: 60, revenue: 55, marketing: 50 }, cascade: ['Prerequisite unhealthy', 'Downstream domain blocked', 'Stalled execution'] },
    pursue_quick_wins: { dimensions: { conversion: 55, marketing: 50, revenue: 40 }, cascade: ['Quick wins unaddressed', 'Easy value left on table', 'Slower momentum'] },
    advance_maturity: { dimensions: { marketing: 55, authority: 45, revenue: 40 }, cascade: ['Low overall maturity', 'Fragmented execution', 'Slower compounding growth'] },
  },
  moduleDimensions: {
    business_health: { marketing: 50, revenue: 50 }, digital_health: { marketing: 55, authority: 40 }, marketing_health: { marketing: 70 },
    sales_health: { revenue: 60, pipeline: 50 }, revenue_health: { revenue: 75 }, operational_health: { pipeline: 40, marketing: 30 },
    readiness: { pipeline: 50, leads: 50 }, execution: { marketing: 50, revenue: 45 }, growth: { marketing: 55, revenue: 45 }, maturity: { marketing: 50 },
  },
  dimensionTail: { revenue: 'revenue', pipeline: 'pipeline', marketing: 'marketing performance', conversion: 'conversion', authority: 'authority', leads: 'lead generation' },
};

export const DECISION_LOW_EFFORT = new Set(['pursue_quick_wins']);
export const DECISION_HIGH_EFFORT = new Set(['advance_maturity']);
