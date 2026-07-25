import type { EnterpriseOpportunity } from './analyticsEnterpriseSnapshotService';
import type { AuthorityMarketPosition } from './authorityMarketPositionService';
import type { PredictiveStrategicIntelligence } from './predictiveStrategicIntelligenceService';

export type StrategicRecommendation = {
  id: string;
  category: 'seo' | 'growth' | 'engagement' | 'discoverability' | 'conversion' | 'authority';
  title: string;
  priority_score: number;
  confidence: 'high' | 'medium' | 'low';
  business_impact: 'high' | 'medium' | 'low';
  implementation_difficulty: 'high' | 'medium' | 'low';
  estimated_seo_impact: number;
  estimated_discoverability_impact: number;
  strategic_urgency: 'immediate' | 'near_term' | 'monitor';
  expected_authority_gain: number;
  action: string;
  evidence_refs: string[];
};

/**
 * PRODUCT-RESTORE-001 · Phase 1 — TYPE COLLISION RESOLUTION.
 *
 * This module is the **SEO / growth analytics** recommendation domain: a status +
 * a list of scored `StrategicRecommendation`s, consumed by the enterprise analytics
 * snapshot and lead-generation authority services.
 *
 * It is NOT the *Strategic Recommendation Intelligence* narrative layer (the six
 * per-card fields `problem_being_solved` / `gap_being_filled` / `why_now` /
 * `authority_reason` / `expected_transformation` / `campaign_angle`). That is a
 * different domain and now lives in `strategicRecommendationIntelligenceService.ts`
 * as `StrategicRecommendationIntelligence`.
 *
 * Both concepts were previously exported under the single ambiguous name
 * `RecommendationIntelligence` (PRODUCT-ARCH-001 §5), which is why the narrative
 * layer's producer could be deleted without a compile error. Each domain now has an
 * explicit name. Type-only change — no runtime behavior is affected.
 */
export type SeoGrowthRecommendationIntelligence = {
  status: 'ready' | 'limited' | 'unavailable';
  recommendations: StrategicRecommendation[];
};

/**
 * @deprecated Ambiguous — prefer {@link SeoGrowthRecommendationIntelligence}. Retained
 * for backward compatibility with any importer not yet migrated. Do NOT use this name
 * for the narrative layer; see `strategicRecommendationIntelligenceService.ts`.
 */
export type RecommendationIntelligence = SeoGrowthRecommendationIntelligence;

export function buildRecommendationIntelligence(input: {
  opportunities: EnterpriseOpportunity[];
  authority: AuthorityMarketPosition;
  predictive: PredictiveStrategicIntelligence;
}): SeoGrowthRecommendationIntelligence {
  const enrich = (base: Omit<StrategicRecommendation,
    'business_impact' | 'implementation_difficulty' | 'estimated_seo_impact' | 'estimated_discoverability_impact' | 'strategic_urgency' | 'expected_authority_gain'
  >): StrategicRecommendation => ({
    ...base,
    business_impact: base.priority_score >= 75 ? 'high' : base.priority_score >= 55 ? 'medium' : 'low',
    implementation_difficulty: base.category === 'authority' ? 'medium' : base.category === 'conversion' ? 'low' : 'medium',
    estimated_seo_impact: base.category === 'seo' || base.category === 'authority' ? Math.min(100, base.priority_score) : Math.round(base.priority_score * 0.45),
    estimated_discoverability_impact: base.category === 'discoverability' || base.category === 'seo' ? Math.min(100, base.priority_score) : Math.round(base.priority_score * 0.5),
    strategic_urgency: base.priority_score >= 80 ? 'immediate' : base.priority_score >= 60 ? 'near_term' : 'monitor',
    expected_authority_gain: base.category === 'authority' ? Math.min(100, input.authority.domain_authority_trajectory_score + 15) : Math.round(base.priority_score * 0.35),
  });
  const recommendations: StrategicRecommendation[] = input.opportunities
    .filter((item) => item.score >= 50 && (item.confidence !== 'low' || item.score >= 75))
    .slice(0, 8)
    .map((item) => enrich({
      id: `opp:${item.id}`,
      category: item.category === 'attribution' ? 'conversion' : item.category,
      title: item.title,
      priority_score: item.score,
      confidence: item.confidence,
      action: item.category === 'seo'
        ? 'Prioritize SEO title, content-depth, and query-intent alignment work for this evidence-backed opportunity.'
        : item.category === 'conversion'
          ? 'Prioritize conversion clarity and CTA friction reduction before scaling traffic.'
          : 'Prioritize landing-page and discoverability improvements backed by observed analytics evidence.',
      evidence_refs: ['enterprise.opportunities', `opportunity.${item.id}`],
    }));

  for (const authority of input.authority.recommendations) {
    recommendations.push(enrich({
      id: `authority:${authority.title}`,
      category: 'authority',
      title: authority.title,
      priority_score: input.authority.domain_authority_trajectory_score,
      confidence: authority.confidence,
      action: 'Create or improve content assets around this topic only where canonical query evidence supports demand.',
      evidence_refs: authority.evidence_refs,
    }));
  }

  const growth = input.predictive.signals.find((signal) => signal.type === 'strategic_growth_likelihood');
  if (growth && growth.confidence !== 'none' && growth.score >= 60) {
    recommendations.push(enrich({
      id: 'predictive:growth-likelihood',
      category: 'growth',
      title: 'Use current analytics momentum to prioritize growth experiments',
      priority_score: growth.score,
      confidence: growth.confidence === 'high' ? 'high' : growth.confidence === 'medium' ? 'medium' : 'low',
      action: 'Prioritize experiments tied to the highest-confidence opportunity cluster and keep prediction confidence visible.',
      evidence_refs: growth.evidence_refs,
    }));
  }

  const ranked = recommendations
    .filter((item) => item.priority_score >= 40)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 10);

  return {
    status: ranked.some((item) => item.confidence === 'medium' || item.confidence === 'high') ? 'ready' : ranked.length ? 'limited' : 'unavailable',
    recommendations: ranked,
  };
}
