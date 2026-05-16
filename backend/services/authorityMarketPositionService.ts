import type { EnterpriseOpportunity } from './analyticsEnterpriseSnapshotService';
import type { ExternalCompetitiveIntelligence } from './externalCompetitiveIntelligenceService';
import type { GscSeoIntelligence } from './gscSeoIntelligenceService';

export type AuthorityMarketPosition = {
  status: 'ready' | 'limited' | 'unavailable';
  domain_authority_trajectory_score: number;
  market_position_score: number;
  visibility_moat: 'strong' | 'developing' | 'weak' | 'insufficient';
  topic_opportunities: Array<{
    topic: string;
    score: number;
    confidence: 'high' | 'medium' | 'low';
    evidence: Record<string, unknown>;
  }>;
  recommendations: Array<{
    title: string;
    confidence: 'high' | 'medium' | 'low';
    evidence_refs: string[];
  }>;
};

function topicFromQuery(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || query;
}

export function buildAuthorityMarketPosition(input: {
  opportunities: EnterpriseOpportunity[];
  gsc: GscSeoIntelligence | null;
  external: ExternalCompetitiveIntelligence;
}): AuthorityMarketPosition {
  if (!input.gsc && input.external.status === 'unavailable') {
    return {
      status: 'unavailable',
      domain_authority_trajectory_score: 0,
      market_position_score: 0,
      visibility_moat: 'insufficient',
      topic_opportunities: [],
      recommendations: [],
    };
  }

  const impressions = (input.gsc?.top_queries ?? []).reduce((sum, query) => sum + query.impressions, 0);
  const rising = input.gsc?.rising_keywords.length ?? 0;
  const competitiveScore = input.external.signals[0]?.score ?? 0;
  const authorityScore = Math.min(100, Math.round(Math.log10(impressions + 1) * 22 + rising * 8));
  const marketScore = Math.min(100, Math.round(authorityScore * 0.6 + competitiveScore * 0.4));

  const topicMap = new Map<string, { impressions: number; clicks: number; score: number }>();
  for (const query of input.gsc?.top_queries ?? []) {
    const topic = topicFromQuery(query.query);
    const current = topicMap.get(topic) ?? { impressions: 0, clicks: 0, score: 0 };
    current.impressions += query.impressions;
    current.clicks += query.clicks;
    current.score = Math.max(current.score, query.opportunity_score);
    topicMap.set(topic, current);
  }

  const topicOpportunities = Array.from(topicMap.entries())
    .map(([topic, row]) => ({
      topic,
      score: Math.min(100, Math.round(row.score + Math.log10(row.impressions + 1) * 8)),
      confidence: row.impressions >= 500 ? 'high' as const : row.impressions >= 50 ? 'medium' as const : 'low' as const,
      evidence: row,
    }))
    .filter((row) => row.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    status: topicOpportunities.some((row) => row.confidence !== 'low') ? 'ready' : 'limited',
    domain_authority_trajectory_score: authorityScore,
    market_position_score: marketScore,
    visibility_moat: marketScore >= 75 ? 'strong' : marketScore >= 45 ? 'developing' : 'weak',
    topic_opportunities: topicOpportunities,
    recommendations: topicOpportunities.slice(0, 3).map((topic) => ({
      title: `Build authority around ${topic.topic}`,
      confidence: topic.confidence,
      evidence_refs: ['gsc.top_queries', 'authority.topic_opportunities'],
    })),
  };
}
