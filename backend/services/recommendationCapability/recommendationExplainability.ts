/**
 * recommendationExplainability.ts — recommendation explainability (PMF-007 §7).
 *
 * Every recommendation the platform path serves carries an explanation: confidence,
 * evidence, knowledge version, decision source, dependencies, reason codes, and a
 * priority explanation. No opaque recommendations. Pure/deterministic — the
 * explanation is derived from the graph node + the execution outcome; it is ADDITIVE
 * metadata and never mutates the recommendation payload (output parity, §9/§10).
 */

import { resolveRecommendationNode, type RecommendationNode, type RecommendationNodeId } from './recommendationGraph';

export interface RecommendationExplanation {
  /** 0–100 confidence for this recommendation. */
  confidence: number;
  /** Evidence sources the recommendation draws on. */
  evidence: string[];
  /** The CKC knowledge version consumed (null when unavailable). */
  knowledgeVersion: number | null;
  /** Where the decision came from — the graph node + runtime. */
  decisionSource: { node: RecommendationNodeId; capability: string; runtime: 'platform' | 'legacy' };
  /** Upstream nodes this recommendation depended on. */
  dependencies: RecommendationNodeId[];
  /** Canonical reason codes explaining the recommendation. */
  reasonCodes: string[];
  /** Human-readable explanation of the priority. */
  priorityExplanation: string;
}

function priorityBand(priority: number): string {
  if (priority <= 5) return 'critical';
  if (priority <= 20) return 'high';
  if (priority <= 35) return 'medium';
  return 'low';
}

export interface BuildExplanationInput {
  nodeId: RecommendationNodeId;
  confidence: number;
  knowledgeVersion: number | null;
  runtime?: 'platform' | 'legacy';
  /** Extra reason codes contributed by the runtime (deduped with the node's). */
  extraReasonCodes?: string[];
}

/** Build the explanation for a recommendation node's output. Deterministic. */
export function buildRecommendationExplanation(input: BuildExplanationInput): RecommendationExplanation {
  const node: RecommendationNode | null = resolveRecommendationNode(input.nodeId);
  const confidence = Math.max(0, Math.min(100, Math.round(input.confidence)));
  const priority = node?.priority ?? 50;
  const reasonCodes = Array.from(new Set([...(node ? [node.reasonCode] : []), ...(input.extraReasonCodes ?? [])])).sort();
  return {
    confidence,
    evidence: node ? [...node.evidence] : [],
    knowledgeVersion: input.knowledgeVersion,
    decisionSource: { node: input.nodeId, capability: node?.aicCapability ?? 'RECOMMENDATION_DECISION', runtime: input.runtime ?? 'platform' },
    dependencies: node ? [...node.dependsOn] : [],
    reasonCodes,
    priorityExplanation: `priority=${priority} (${priorityBand(priority)}): ${input.nodeId} confidence ${confidence} from ${(node?.evidence ?? []).join(', ') || 'company knowledge'}`,
  };
}

/**
 * Attach an explanation to a served recommendation result WITHOUT mutating the
 * recommendation payload. The explanation lives under a reserved key so existing
 * downstream consumers that ignore it keep working unchanged (§9/§10). Returns a new
 * object; never mutates the input. If the payload is not a plain object it is returned
 * unchanged (parity).
 */
export function withExplanation<T>(recommendations: T, explanation: RecommendationExplanation): T {
  if (!recommendations || typeof recommendations !== 'object' || Array.isArray(recommendations)) return recommendations;
  return { ...(recommendations as Record<string, unknown>), __explanation: explanation } as unknown as T;
}
