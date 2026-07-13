/**
 * decisionMapping.ts — deterministic recommendation → Decision Object mapping (PMF-007R §2).
 *
 * Every Recommendation Graph node maps deterministically to one or more Decision
 * Objects. Recommendations are unchanged; Decision Objects become the canonical
 * internal representation, DERIVED (never rewritten) from the recommendation graph +
 * the served recommendation result. Pure — no clock/randomness (createdAt injected).
 */

import {
  RECOMMENDATION_GRAPH, RECOMMENDATION_NODE_IDS, recommendationProducingNode,
  type RecommendationNode, type RecommendationNodeId,
} from '../recommendationCapability/recommendationGraph';
import { buildDecisionObject, type DecisionObject } from './decisionObjectModel';

export interface DecisionMappingContext {
  companyId: string;
  knowledgeVersion: number | null;
  runtime?: 'platform' | 'legacy';
  createdAt: string;
  /** Default confidence when an item/node carries none (0–100). */
  defaultConfidence?: number;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function humanize(id: string): string {
  return id.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Map a single graph node → one Decision Object (structural representation of the node). */
export function mapNodeToDecision(node: RecommendationNode, ctx: DecisionMappingContext): DecisionObject {
  const title = humanize(node.id);
  return buildDecisionObject({
    companyId: ctx.companyId, node: node.id, capability: node.aicCapability, runtime: ctx.runtime,
    decisionType: node.id, title,
    summary: `${title} decision derived from the recommendation graph.`,
    recommendedAction: `Apply the ${title.toLowerCase()} recommendation.`,
    expectedOutcome: 'Improved marketing performance per the recommendation.',
    priority: node.priority, confidence: ctx.defaultConfidence ?? 70,
    knowledgeVersion: ctx.knowledgeVersion, evidence: [...node.evidence], reasonCodes: [node.reasonCode],
    dependencies: [...node.dependsOn], createdAt: ctx.createdAt,
    metadata: { source: 'graph_node', outputs: node.outputs },
  });
}

/** Map one recommendation item (from the engine result) → one Decision Object. */
export function mapRecommendationItemToDecision(item: Record<string, unknown>, node: RecommendationNode, ctx: DecisionMappingContext, index: number): DecisionObject {
  const title = str(item.title ?? item.trend ?? item.name ?? item.topic, `${humanize(node.id)} #${index + 1}`);
  const confidence = num(item.confidence ?? item.confidence_score, ctx.defaultConfidence ?? 70);
  return buildDecisionObject({
    companyId: ctx.companyId, node: node.id, capability: node.aicCapability, runtime: ctx.runtime,
    decisionType: node.id, title,
    summary: str(item.explanation ?? item.summary ?? item.reason, title),
    recommendedAction: str(item.recommendedAction ?? item.action ?? item.next_action, `Execute: ${title}`),
    expectedOutcome: str(item.expectedOutcome ?? item.expected_reach ?? item.expected_growth ?? item.outcome, 'Improved performance.'),
    priority: num(item.priority, node.priority + index), // stable per-item ordering
    confidence,
    knowledgeVersion: ctx.knowledgeVersion, evidence: [...node.evidence], reasonCodes: [node.reasonCode],
    dependencies: [...node.dependsOn], createdAt: ctx.createdAt,
    metadata: { source: 'recommendation_item', index },
  });
}

/** Extract a recommendation-item list from a RecommendationEngineResult-like object. Deterministic. */
function extractItems(result: unknown): Record<string, unknown>[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;
  for (const key of ['recommendations', 'trends_used', 'weekly_plan', 'daily_plan']) {
    const v = r[key];
    if (Array.isArray(v) && v.length) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
  }
  return [];
}

/**
 * Map a served recommendation result → Decision Objects (§2). Every item under the
 * producing node becomes a Decision Object; if there are no items, the producing node
 * itself maps to a single Decision Object. Deterministic (stable ordering).
 */
export function mapRecommendationsToDecisions(result: unknown, ctx: DecisionMappingContext): DecisionObject[] {
  const producing = RECOMMENDATION_GRAPH[recommendationProducingNode()];
  const items = extractItems(result);
  if (items.length) return items.map((it, i) => mapRecommendationItemToDecision(it, producing, ctx, i));
  return [mapNodeToDecision(producing, ctx)];
}

/** Map EVERY graph node → a Decision Object (the canonical internal representation). Deterministic. */
export function mapGraphToDecisions(ctx: DecisionMappingContext): DecisionObject[] {
  return RECOMMENDATION_NODE_IDS.map((id: RecommendationNodeId) => mapNodeToDecision(RECOMMENDATION_GRAPH[id], ctx));
}
