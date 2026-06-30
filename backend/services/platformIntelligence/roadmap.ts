/**
 * Platform Roadmap Engine (Phase 21B, Phase E).
 * The ONE roadmap format for every domain: 30/60/90-day horizons composed from the
 * categorised recommendation collection. No domain builds its own roadmap. Pure.
 */
import type { PlatformRecommendation } from './recommendations';

export interface RoadmapHorizon {
  horizon: '30_day' | '60_day' | '90_day';
  items: string[];
}

export function buildRoadmap<D extends string>(recommendations: PlatformRecommendation<D>[]): RoadmapHorizon[] {
  const quickWins = recommendations.filter((r) => r.category === 'quick_win');
  const criticalIssues = recommendations.filter((r) => r.category === 'critical');
  return [
    { horizon: '30_day', items: [...criticalIssues, ...quickWins].slice(0, 6).map((r) => r.recommendation) },
    { horizon: '60_day', items: recommendations.filter((r) => r.category === 'high' || r.category === 'medium').slice(0, 6).map((r) => r.recommendation) },
    { horizon: '90_day', items: recommendations.filter((r) => r.category === 'strategic' || r.category === 'low').slice(0, 6).map((r) => r.recommendation) },
  ];
}
