import type { EnterpriseOpportunity } from './analyticsEnterpriseSnapshotService';
import type { GscSeoIntelligence } from './gscSeoIntelligenceService';
import type { AnalyticsCompetitiveIntelligence } from './analyticsCompetitiveIntelligenceService';

export type PredictiveSignal = {
  type: 'ranking_trajectory' | 'growth_momentum' | 'seo_volatility' | 'conversion_opportunity' | 'engagement_risk' | 'strategic_growth_likelihood';
  label: string;
  prediction: 'positive' | 'negative' | 'stable' | 'insufficient_evidence';
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  confidence_interval: { low: number; high: number };
  evidence_refs: string[];
  explanation: string;
};

export type PredictiveStrategicIntelligence = {
  status: 'ready' | 'limited' | 'unavailable';
  signals: PredictiveSignal[];
};

function confidenceFromEvidence(count: number): PredictiveSignal['confidence'] {
  if (count >= 5) return 'high';
  if (count >= 2) return 'medium';
  if (count >= 1) return 'low';
  return 'none';
}

function interval(score: number, confidence: PredictiveSignal['confidence']): PredictiveSignal['confidence_interval'] {
  const width = confidence === 'high' ? 8 : confidence === 'medium' ? 15 : confidence === 'low' ? 25 : 50;
  return { low: Math.max(0, score - width), high: Math.min(100, score + width) };
}

export function buildPredictiveStrategicIntelligence(input: {
  opportunities: EnterpriseOpportunity[];
  gsc: GscSeoIntelligence | null;
  competitive: AnalyticsCompetitiveIntelligence;
}): PredictiveStrategicIntelligence {
  const signals: PredictiveSignal[] = [];
  const rising = input.gsc?.rising_keywords.length ?? 0;
  const declining = input.gsc?.declining_keywords.length ?? 0;
  const highOpportunity = input.opportunities.filter((item) => item.score >= 75).length;

  const rankingConfidence = confidenceFromEvidence(rising + declining);
  const rankingScore = Math.max(0, Math.min(100, 50 + (rising - declining) * 12));
  signals.push({
    type: 'ranking_trajectory',
    label: 'Organic ranking trajectory',
    prediction: rising > declining ? 'positive' : declining > rising ? 'negative' : rising + declining > 0 ? 'stable' : 'insufficient_evidence',
    score: rankingScore,
    confidence: rankingConfidence,
    confidence_interval: interval(rankingScore, rankingConfidence),
    evidence_refs: ['gsc.rising_keywords', 'gsc.declining_keywords'],
    explanation: 'Trajectory is calculated only from observed GSC keyword movement buckets.',
  });

  const volatility = (input.gsc?.top_queries ?? []).reduce((sum, query) => sum + query.volatility_score, 0) / Math.max(1, input.gsc?.top_queries.length ?? 0);
  const volatilityScore = Math.round(volatility);
  const volatilityConfidence = confidenceFromEvidence(input.gsc?.top_queries.length ?? 0);
  signals.push({
    type: 'seo_volatility',
    label: 'SEO volatility risk',
    prediction: volatility >= 55 ? 'negative' : volatility > 0 ? 'stable' : 'insufficient_evidence',
    score: volatilityScore,
    confidence: volatilityConfidence,
    confidence_interval: interval(volatilityScore, volatilityConfidence),
    evidence_refs: ['gsc.top_queries.volatility_score'],
    explanation: 'Volatility is derived from observed query movement, not inferred market noise.',
  });

  const growthScore = Math.min(100, 45 + highOpportunity * 18 + Math.max(0, input.competitive.signals.length - 1) * 4);
  const growthConfidence = confidenceFromEvidence(highOpportunity + input.competitive.signals.length);
  signals.push({
    type: 'strategic_growth_likelihood',
    label: 'Strategic growth likelihood',
    prediction: highOpportunity >= 2 ? 'positive' : highOpportunity === 1 ? 'stable' : 'insufficient_evidence',
    score: growthScore,
    confidence: growthConfidence,
    confidence_interval: interval(growthScore, growthConfidence),
    evidence_refs: ['enterprise.opportunities', 'competitive.signals'],
    explanation: 'Growth likelihood is a deterministic confidence-weighted score from ranked opportunities and external competitive evidence availability.',
  });

  return {
    status: signals.some((signal) => signal.confidence === 'medium' || signal.confidence === 'high') ? 'ready' : signals.some((signal) => signal.confidence === 'low') ? 'limited' : 'unavailable',
    signals,
  };
}
