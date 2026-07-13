/**
 * recommendationGraph.ts — the Recommendation Graph (PMF-007 §2/§3).
 *
 * ONE deterministic graph modelling every recommendation as a node. The
 * Recommendation Engine AIA agent orchestrates these nodes rather than implementing
 * them directly; adding a recommendation capability becomes "add a node + edges", not
 * "write orchestration code". Each node selects the existing engine/prompts via its
 * capability (prompt selection behind the profile, §8) and carries the explainability
 * fields (confidence, priority, evidence, reason code — §7). It changes no
 * recommendation logic and no recommendation quality.
 */

export type RecommendationNodeId =
  | 'KNOWLEDGE_ANALYSIS'
  | 'BUSINESS_ANALYSIS'
  | 'CONTENT_RECOMMENDATIONS'
  | 'CHANNEL_RECOMMENDATIONS'
  | 'SEO_RECOMMENDATIONS'
  | 'GROWTH_RECOMMENDATIONS'
  | 'CAMPAIGN_RECOMMENDATIONS'
  | 'PRIORITY_SCORING'
  | 'RISK_ANALYSIS'
  | 'FINAL_RECOMMENDATIONS';

export interface RecommendationNode {
  id: RecommendationNodeId;
  /** Dependencies — nodes that must complete first (§2). */
  dependsOn: RecommendationNodeId[];
  /** Inputs consumed (dependency outputs). */
  inputs: string[];
  /** Outputs produced. */
  outputs: string[];
  /** Required CKC knowledge (consumer + mode). */
  knowledge: { consumer: string; minConfidence?: number; mode?: 'summary' | 'full' | 'compressed' };
  /** Minimum confidence for this recommendation (0–100). */
  confidenceThreshold: number;
  /** Default priority (lower = higher priority) — §7 priority explanation. */
  priority: number;
  /** Evidence sources this node draws on — §7 evidence. */
  evidence: string[];
  /** Canonical reason code for this recommendation type — §7 reason codes. */
  reasonCode: string;
  /** Deterministic validation applied. */
  validation: string[];
  /** The AIC capability this node executes (§3). */
  aicCapability: string;
  outputContract: string;
  /** The node that produces the definitive recommendation set (engine backend). */
  producesRecommendations: boolean;
  /** Terminal node gating on human approval (§6 approval gate). */
  requiresApproval: boolean;
  executionMetadata: { kind: 'analysis' | 'recommendation' | 'scoring' | 'synthesis'; deterministic: boolean };
}

function node(
  id: RecommendationNodeId, dependsOn: RecommendationNodeId[], outputs: string[], evidence: string[],
  reasonCode: string, priority: number, kind: RecommendationNode['executionMetadata']['kind'],
  overrides: Partial<RecommendationNode> = {},
): RecommendationNode {
  return {
    id, dependsOn,
    inputs: overrides.inputs ?? dependsOn.map((d) => `${d}.output`),
    outputs, evidence, reasonCode, priority,
    knowledge: { consumer: 'RECOMMENDATION_ENGINE', mode: 'summary', ...(overrides.knowledge ?? {}) },
    confidenceThreshold: overrides.confidenceThreshold ?? 0,
    validation: overrides.validation ?? ['schema'],
    aicCapability: overrides.aicCapability ?? 'RECOMMENDATION_DECISION',
    outputContract: overrides.outputContract ?? 'recommendations',
    producesRecommendations: overrides.producesRecommendations ?? false,
    requiresApproval: overrides.requiresApproval ?? false,
    executionMetadata: overrides.executionMetadata ?? { kind, deterministic: kind !== 'synthesis' },
  };
}

const GRAPH_INTERNAL: Record<RecommendationNodeId, RecommendationNode> = {
  KNOWLEDGE_ANALYSIS:      node('KNOWLEDGE_ANALYSIS', [], ['knowledge_profile'], ['company_knowledge'], 'RC_KNOWLEDGE', 10, 'analysis'),
  BUSINESS_ANALYSIS:       node('BUSINESS_ANALYSIS', ['KNOWLEDGE_ANALYSIS'], ['business_signals'], ['company_knowledge', 'performance'], 'RC_BUSINESS', 15, 'analysis'),
  CONTENT_RECOMMENDATIONS: node('CONTENT_RECOMMENDATIONS', ['BUSINESS_ANALYSIS'], ['content_recs'], ['content_performance', 'audience'], 'RC_CONTENT', 30, 'recommendation'),
  CHANNEL_RECOMMENDATIONS: node('CHANNEL_RECOMMENDATIONS', ['BUSINESS_ANALYSIS'], ['channel_recs'], ['channel_performance', 'audience'], 'RC_CHANNEL', 30, 'recommendation'),
  SEO_RECOMMENDATIONS:     node('SEO_RECOMMENDATIONS', ['BUSINESS_ANALYSIS'], ['seo_recs'], ['website', 'keywords'], 'RC_SEO', 35, 'recommendation'),
  GROWTH_RECOMMENDATIONS:  node('GROWTH_RECOMMENDATIONS', ['BUSINESS_ANALYSIS'], ['growth_recs'], ['performance', 'market'], 'RC_GROWTH', 25, 'recommendation'),
  // The campaign-recs node produces the definitive recommendation set via the engine.
  CAMPAIGN_RECOMMENDATIONS: node('CAMPAIGN_RECOMMENDATIONS', ['CONTENT_RECOMMENDATIONS', 'CHANNEL_RECOMMENDATIONS'], ['recommendations'], ['content_recs', 'channel_recs'], 'RC_CAMPAIGN', 20, 'synthesis', { producesRecommendations: true }),
  PRIORITY_SCORING:        node('PRIORITY_SCORING', ['CONTENT_RECOMMENDATIONS', 'CHANNEL_RECOMMENDATIONS', 'SEO_RECOMMENDATIONS', 'GROWTH_RECOMMENDATIONS', 'CAMPAIGN_RECOMMENDATIONS'], ['ranked'], ['impact', 'effort', 'confidence'], 'RC_PRIORITY', 5, 'scoring', { validation: ['schema', 'ranking'] }),
  RISK_ANALYSIS:           node('RISK_ANALYSIS', ['CAMPAIGN_RECOMMENDATIONS'], ['risk_report'], ['risk_signals'], 'RC_RISK', 40, 'analysis'),
  // Terminal synthesis, gated on approval (§6 approval gate).
  FINAL_RECOMMENDATIONS:   node('FINAL_RECOMMENDATIONS', ['PRIORITY_SCORING', 'RISK_ANALYSIS'], ['final_recommendations'], ['ranked', 'risk_report'], 'RC_FINAL', 1, 'synthesis', { requiresApproval: true, validation: ['schema', 'dedup', 'final_contract'] }),
};

export const RECOMMENDATION_GRAPH: Readonly<Record<RecommendationNodeId, RecommendationNode>> = GRAPH_INTERNAL;
export const RECOMMENDATION_NODE_IDS = Object.keys(GRAPH_INTERNAL) as RecommendationNodeId[];

export function resolveRecommendationNode(id: RecommendationNodeId): RecommendationNode | null {
  return GRAPH_INTERNAL[id] ?? null;
}

/** The node that produces the definitive recommendation set (engine backend). */
export function recommendationProducingNode(): RecommendationNodeId {
  return (RECOMMENDATION_NODE_IDS.find((id) => GRAPH_INTERNAL[id].producesRecommendations) ?? 'CAMPAIGN_RECOMMENDATIONS') as RecommendationNodeId;
}

/**
 * Deterministic topological execution order over the dependency edges (§2/§6).
 * Cycle-detecting; stable (ids sorted within each ready set). Pure.
 */
export function recommendationExecutionOrder(): RecommendationNodeId[] {
  const visited = new Set<RecommendationNodeId>();
  const temp = new Set<RecommendationNodeId>();
  const order: RecommendationNodeId[] = [];
  const visit = (id: RecommendationNodeId) => {
    if (visited.has(id)) return;
    if (temp.has(id)) throw new Error(`RECOMMENDATION_GRAPH_CYCLE:${id}`);
    temp.add(id);
    for (const dep of [...GRAPH_INTERNAL[id].dependsOn].sort()) visit(dep);
    temp.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of [...RECOMMENDATION_NODE_IDS].sort()) visit(id);
  return order;
}
