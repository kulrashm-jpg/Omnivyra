import type { DecisionNarrativeCluster } from './DecisionCompressionService';

export type DecisionNarrative = {
  cluster_id: string;
  title: string;
  what_is_happening: string;
  why_it_matters: string;
  what_to_do: string;
  expected_outcome: string;
  priority_score: number;
  business_impact_score: number;
};

function toCategoryLabel(category: DecisionNarrativeCluster['category']): string {
  return String(category || 'market').replace(/_/g, ' ');
}

function deterministicNarrative(cluster: DecisionNarrativeCluster): DecisionNarrative {
  const categoryLabel = toCategoryLabel(cluster.category);
  const recommendation = cluster.recommendations[0] ?? 'Execute the top-priority remediation plan.';

  return {
    cluster_id: cluster.cluster_id,
    title: cluster.title,
    what_is_happening:
      `${cluster.decision_count} aligned decisions indicate a concentrated ${categoryLabel} signal around ${cluster.dominant_issue_type}.`,
    why_it_matters:
      `This cluster carries priority ${cluster.priority_score}/100 with business impact ${cluster.business_impact_score}/100 and can materially influence near-term CMO outcomes.`,
    what_to_do: recommendation,
    expected_outcome:
      `If executed in the next planning cycle, this cluster should reduce risk exposure and improve channel-level conversion efficiency.`,
    priority_score: cluster.priority_score,
    business_impact_score: cluster.business_impact_score,
  };
}

export async function generateNarratives(params: {
  clusters: DecisionNarrativeCluster[];
  useOptionalLlm?: boolean;
}): Promise<DecisionNarrative[]> {
  const clusters = params.clusters ?? [];
  if (clusters.length === 0) return [];

  // LLM mode is optional by contract; deterministic templates are the default.
  return clusters.map((cluster) => deterministicNarrative(cluster));
}
