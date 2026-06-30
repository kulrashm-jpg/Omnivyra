/**
 * Canonical Platform Intelligence Contract (Phase 21B, Phase B).
 *
 * The single, domain-agnostic contract every intelligence domain converges on — no
 * Website-specific or Lead-specific names. Website Intelligence is Consumer #1; Lead,
 * Growth, Marketing, Analytics, CRM, MarketPulse, Community and future engines follow.
 */
export type { StyleToken } from './styles';
export type { Freshness } from './freshness';
export type { IntelHealth, Readiness, Provenance, CheckResult } from './confidence';
export type { ImpactDimension, BusinessImpact, ImpactGraphConfig } from './businessImpact';
export type { RecommendationCategory, PlatformRecommendation, RawRecommendationInput } from './recommendations';
export type { ExecutiveSummary, BusinessImpactAggregate, HealthState } from './executiveSummary';
export type { RoadmapHorizon } from './roadmap';

export type ModuleStatus = 'ready' | 'partial' | 'unavailable';

/** A single intelligence module in any domain's snapshot. */
export interface IntelligenceModule {
  key: string;
  label: string;
  status: ModuleStatus;
  available: boolean;
  source: string;
  lastUpdated: string | null;
  detail?: string;
}
