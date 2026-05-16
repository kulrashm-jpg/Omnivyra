import { createHash } from 'crypto';
import type { EnterpriseOpportunity } from './analyticsEnterpriseSnapshotService';

export type PrioritizedAnalyticsOpportunity = EnterpriseOpportunity & {
  priority_rank: number;
  novelty_score: number;
  fatigue_state: 'new' | 'active' | 'repeated' | 'suppressed';
  escalation: 'escalate' | 'maintain' | 'de_escalate';
  priority_reason: string;
};

export type AnalyticsPrioritizationSummary = {
  generated_at: string;
  prioritized: PrioritizedAnalyticsOpportunity[];
  suppressed_count: number;
};

function stableBucket(id: string): number {
  const hash = createHash('sha256').update(id).digest('hex').slice(0, 8);
  return parseInt(hash, 16) % 100;
}

export function prioritizeAnalyticsOpportunities(opportunities: EnterpriseOpportunity[]): AnalyticsPrioritizationSummary {
  const seen = new Set<string>();
  const ranked = opportunities
    .map((item) => {
      const novelty = stableBucket(item.id);
      const repeated = seen.has(item.id);
      seen.add(item.id);
      const evidenceCount = Object.keys(item.evidence ?? {}).length;
      const evidenceBoost = Math.min(10, evidenceCount * 2);
      const confidenceBoost = item.confidence === 'high' ? 15 : item.confidence === 'medium' ? 8 : 0;
      const adjustedScore = Math.min(100, Math.round(item.score + confidenceBoost + evidenceBoost + novelty * 0.05));
      const fatigueState: PrioritizedAnalyticsOpportunity['fatigue_state'] =
        repeated ? 'suppressed'
          : novelty < 15 && item.score < 70 ? 'repeated'
            : 'active';
      const escalation: PrioritizedAnalyticsOpportunity['escalation'] =
        adjustedScore >= 80 && fatigueState !== 'suppressed'
          ? 'escalate'
          : adjustedScore < 45
            ? 'de_escalate'
            : 'maintain';
      return {
        ...item,
        score: adjustedScore,
        novelty_score: novelty,
        fatigue_state: fatigueState,
        escalation,
        priority_reason: `score=${adjustedScore}; confidence=${item.confidence}; evidence_fields=${evidenceCount}; novelty=${novelty}`,
      };
    })
    .filter((item) => item.fatigue_state !== 'suppressed')
    .sort((a, b) => b.score - a.score || b.novelty_score - a.novelty_score)
    .slice(0, 10)
    .map((item, index) => ({ ...item, priority_rank: index + 1 }));

  return {
    generated_at: new Date().toISOString(),
    prioritized: ranked,
    suppressed_count: opportunities.length - ranked.length,
  };
}
