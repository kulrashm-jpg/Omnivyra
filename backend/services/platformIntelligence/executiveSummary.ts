/**
 * Platform Executive Engine (Phase 21B, Phase C).
 * The ONE executive-summary builder for every domain. Pure projection of modules +
 * recommendations + health + business-impact aggregate + confidence + freshness. Every
 * intelligence domain uses this; no domain writes its own. Website is Consumer #1.
 */
import type { PlatformRecommendation } from './recommendations';

export type HealthState = 'healthy' | 'warning' | 'disconnected';

export interface BusinessImpactAggregate<D extends string = string> {
  dimensions: Partial<Record<D, number>>;
  topDimensions: D[];
  summary: string;
}

export interface ExecutiveSummary<D extends string = string> {
  overallStatus: HealthState;
  overallScore: number;
  headline: string;
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  priorityFocus: string[];
  businessImpact: BusinessImpactAggregate<D>;
  confidence: number;
  freshness: { lastIntelligenceUpdate: string | null; stale: boolean };
}

export interface ExecutiveSummaryInput<D extends string> {
  /** Domain entity label for the headline (e.g. 'Website', 'Lead pipeline'). */
  entityLabel: string;
  score: number;
  overallStatus: HealthState;
  modules: Array<{ label: string; status: string; available: boolean }>;
  recommendations: PlatformRecommendation<D>[];
  businessImpact: BusinessImpactAggregate<D>;
  confidence: number;
  lastIntelligenceUpdate: string | null;
}

export function buildExecutiveSummary<D extends string>(input: ExecutiveSummaryInput<D>): ExecutiveSummary<D> {
  const strengths = input.modules.filter((m) => m.status === 'ready').map((m) => m.label).slice(0, 5);
  const weaknesses = input.modules.filter((m) => m.available && m.status !== 'ready').map((m) => m.label).slice(0, 5);
  const opportunities = input.recommendations.filter((r) => r.category === 'quick_win').slice(0, 5).map((r) => r.recommendation);
  const priorityFocus = input.recommendations.filter((r) => r.category === 'critical' || r.category === 'high').slice(0, 3).map((r) => r.recommendation);
  return {
    overallStatus: input.overallStatus,
    overallScore: input.score,
    headline: `${input.entityLabel} scores ${Math.round(input.score)}/100 (${input.overallStatus}). ${input.businessImpact.summary}`,
    strengths, weaknesses, opportunities,
    priorityFocus: priorityFocus.length ? priorityFocus : input.recommendations.slice(0, 3).map((r) => r.recommendation),
    businessImpact: input.businessImpact,
    confidence: input.confidence,
    freshness: { lastIntelligenceUpdate: input.lastIntelligenceUpdate, stale: !input.lastIntelligenceUpdate },
  };
}
