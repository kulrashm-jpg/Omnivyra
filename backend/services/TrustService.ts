import type { DecisionNarrativeCluster } from './DecisionCompressionService';

export type NarrativeTrustEnvelope = {
  cluster_id: string;
  confidence_level: 'low' | 'medium' | 'high';
  confidence_score: number;
  evidence: {
    decision_count: number;
    key_signals: string[];
  };
  data_sources: string[];
  freshness: {
    label: 'fresh' | 'recent' | 'stale';
    last_updated_at: string | null;
    age_hours: number | null;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreToLevel(score: number): NarrativeTrustEnvelope['confidence_level'] {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

function freshnessFromTimestamp(timestamp: string | null): NarrativeTrustEnvelope['freshness'] {
  if (!timestamp) {
    return {
      label: 'stale',
      last_updated_at: null,
      age_hours: null,
    };
  }

  const ageHours = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / (60 * 60 * 1000)));
  const label: NarrativeTrustEnvelope['freshness']['label'] = ageHours <= 24 ? 'fresh' : ageHours <= 72 ? 'recent' : 'stale';

  return {
    label,
    last_updated_at: timestamp,
    age_hours: ageHours,
  };
}

export function attachNarrativeTrust(clusters: DecisionNarrativeCluster[]): NarrativeTrustEnvelope[] {
  return (clusters ?? []).map((cluster) => {
    const avgConfidence = cluster.decisions.length > 0
      ? cluster.decisions.reduce((sum, decision) => sum + Number(decision.confidence_score ?? 0), 0) / cluster.decisions.length
      : 0;

    const sampleBoost = Math.min(0.15, cluster.decision_count * 0.01);
    const freshness = freshnessFromTimestamp(cluster.evidence.latest_decision_at);
    const freshnessBoost = freshness.label === 'fresh' ? 0.1 : freshness.label === 'recent' ? 0.05 : 0;
    const confidenceScore = clamp(Number((avgConfidence + sampleBoost + freshnessBoost).toFixed(3)), 0, 1);

    return {
      cluster_id: cluster.cluster_id,
      confidence_level: scoreToLevel(confidenceScore),
      confidence_score: confidenceScore,
      evidence: {
        decision_count: cluster.decision_count,
        key_signals: cluster.evidence.key_signals,
      },
      data_sources: cluster.source_services,
      freshness,
    };
  });
}
