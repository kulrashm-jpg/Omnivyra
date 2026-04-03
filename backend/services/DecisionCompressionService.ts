import type { PersistedDecisionObject } from './decisionObjectService';
import { classifyDecisionType } from './decisionTypeRegistry';

export type DecisionNarrativeCluster = {
  cluster_id: string;
  title: string;
  dominant_issue_type: string;
  category: ReturnType<typeof classifyDecisionType>;
  decision_ids: string[];
  decision_count: number;
  priority_score: number;
  business_impact_score: number;
  narrative_score: number;
  recommendations: string[];
  source_services: string[];
  evidence: {
    key_signals: string[];
    latest_decision_at: string | null;
  };
  decisions: PersistedDecisionObject[];
};

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function impactScore(decision: PersistedDecisionObject): number {
  return Math.max(
    Number(decision.impact_traffic ?? 0),
    Number(decision.impact_conversion ?? 0),
    Number(decision.impact_revenue ?? 0),
  );
}

function normalizePhrase(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clusterKey(decision: PersistedDecisionObject): string {
  const category = classifyDecisionType(decision.issue_type);
  const recommendation = normalizePhrase(decision.recommendation).split(' ').slice(0, 6).join(' ');
  return `${category}:${decision.issue_type}:${recommendation}`;
}

function extractEvidenceSignals(decisions: PersistedDecisionObject[]): string[] {
  const keys = new Map<string, number>();

  for (const decision of decisions) {
    const evidence = decision.evidence;
    if (Array.isArray(evidence)) {
      for (const item of evidence) {
        for (const key of Object.keys(item ?? {})) {
          keys.set(key, (keys.get(key) ?? 0) + 1);
        }
      }
      continue;
    }

    for (const key of Object.keys(evidence ?? {})) {
      keys.set(key, (keys.get(key) ?? 0) + 1);
    }
  }

  return [...keys.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key]) => key);
}

function latestTimestamp(decisions: PersistedDecisionObject[]): string | null {
  if (decisions.length === 0) return null;
  return [...decisions]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]?.updated_at ?? null;
}

function buildCluster(clusterId: string, decisions: PersistedDecisionObject[]): DecisionNarrativeCluster {
  const ranked = [...decisions].sort((a, b) => Number(b.priority_score ?? 0) - Number(a.priority_score ?? 0));
  const top = ranked[0];

  const priority = avg(ranked.map((decision) => Number(decision.priority_score ?? 0)));
  const impact = avg(ranked.map((decision) => impactScore(decision)));
  const narrativeScore = Math.round(priority * 0.55 + impact * 0.45);

  return {
    cluster_id: clusterId,
    title: top?.title ?? 'Emerging decision cluster',
    dominant_issue_type: top?.issue_type ?? 'unknown_issue',
    category: classifyDecisionType(top?.issue_type ?? ''),
    decision_ids: ranked.map((decision) => decision.id),
    decision_count: ranked.length,
    priority_score: Math.round(priority),
    business_impact_score: Math.round(impact),
    narrative_score: narrativeScore,
    recommendations: [...new Set(ranked.map((decision) => decision.recommendation).filter(Boolean))].slice(0, 4),
    source_services: [...new Set(ranked.map((decision) => decision.source_service).filter(Boolean))],
    evidence: {
      key_signals: extractEvidenceSignals(ranked),
      latest_decision_at: latestTimestamp(ranked),
    },
    decisions: ranked,
  };
}

export function compressDecisionObjects(params: {
  decisions: PersistedDecisionObject[];
  maxNarratives?: number;
}): DecisionNarrativeCluster[] {
  const maxNarratives = Math.max(1, Math.min(10, Number(params.maxNarratives ?? 10)));
  const source = (params.decisions ?? []).filter((decision) => decision.status === 'open');
  if (source.length === 0) return [];

  const buckets = new Map<string, PersistedDecisionObject[]>();
  for (const decision of source) {
    const key = clusterKey(decision);
    const current = buckets.get(key) ?? [];
    current.push(decision);
    buckets.set(key, current);
  }

  return [...buckets.values()]
    .map((decisions, index) => buildCluster(`cluster_${index + 1}`, decisions))
    .sort((a, b) => {
      if (b.narrative_score !== a.narrative_score) return b.narrative_score - a.narrative_score;
      return b.decision_count - a.decision_count;
    })
    .slice(0, maxNarratives);
}
