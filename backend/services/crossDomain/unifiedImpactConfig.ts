/**
 * Unified Business Intelligence business-impact configuration (Phase 30). Config only — the
 * Platform Business Impact Engine owns the machinery. The orchestrator's own recommendations
 * are cross-domain/strategic; domain recommendations stay owned by their plugins.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type UnifiedDimension = Extract<ImpactDimension, 'revenue' | 'pipeline' | 'conversion' | 'marketing' | 'retention' | 'authority'>;

export const UNIFIED_IMPACT_CONFIG: ImpactGraphConfig<UnifiedDimension> = {
  graph: {
    optimize_weakest_domain: { dimensions: { marketing: 55, revenue: 50, conversion: 45 }, cascade: ['Weakest domain caps the system', 'Compounding underperformance', 'Lower overall growth'] },
    resolve_bottleneck: { dimensions: { pipeline: 60, conversion: 55, revenue: 50 }, cascade: ['Cross-domain bottleneck', 'Downstream domains blocked', 'Stalled revenue'] },
    pursue_largest_opportunity: { dimensions: { revenue: 60, conversion: 50, marketing: 45 }, cascade: ['Largest opportunity unaddressed', 'Value left on table', 'Slower compounding'] },
    reduce_strategic_risk: { dimensions: { revenue: 55, retention: 50, authority: 45 }, cascade: ['Elevated strategic risk', 'Fragile growth', 'Exposure across domains'] },
  },
  moduleDimensions: {
    business_health: { revenue: 50, marketing: 50 }, digital_health: { marketing: 55, authority: 40 }, marketing_health: { marketing: 70 },
    commercial_health: { revenue: 60, pipeline: 50 }, customer_health: { retention: 65, revenue: 45 }, revenue_health: { revenue: 75 },
    operational_health: { pipeline: 55, conversion: 45 }, growth_health: { marketing: 55, revenue: 45 }, organizational_health: { pipeline: 45, marketing: 40 },
    strategic_risk: { revenue: 55, retention: 45 }, maturity: { marketing: 45, revenue: 45 }, optimizer_focus: { revenue: 50, conversion: 45 },
  },
  dimensionTail: { revenue: 'revenue', pipeline: 'pipeline', conversion: 'conversion', marketing: 'marketing performance', retention: 'retention', authority: 'authority' },
};

export const UNIFIED_LOW_EFFORT = new Set(['pursue_largest_opportunity']);
export const UNIFIED_HIGH_EFFORT = new Set(['optimize_weakest_domain', 'resolve_bottleneck']);
