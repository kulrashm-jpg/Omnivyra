/**
 * recommendationCapability — Recommendation Engine as a platform consumer (PMF-007).
 *
 * A Recommendation Graph (deterministic recommendation model + execution graph) + a
 * Recommendation AIA agent (orchestration) + a platform runtime that executes
 * recommendations through AIA-001 (orchestration), AIC-001 (execution), and CKC-001
 * (knowledge), with the existing recommendation engine as the backend (zero
 * recommendation change) behind a reversible flag. Every recommendation is explainable
 * (§7).
 */

export {
  RECOMMENDATION_GRAPH, RECOMMENDATION_NODE_IDS, resolveRecommendationNode,
  recommendationExecutionOrder, recommendationProducingNode,
} from './recommendationGraph';
export type { RecommendationNodeId, RecommendationNode } from './recommendationGraph';

export { getRecommendationRuntimeMode, shouldRunPlatform, legacyIsSafetyNet } from './recommendationMigrationFlag';
export type { RecommendationRuntimeMode } from './recommendationMigrationFlag';

export { buildRecommendationExplanation, withExplanation } from './recommendationExplainability';
export type { RecommendationExplanation } from './recommendationExplainability';

export { runRecommendationsViaPlatform, recordRecommendationRuntime } from './recommendationPlatformRuntime';
export type { RecommendationPlatformInput, RecommendationPlatformDeps } from './recommendationPlatformRuntime';
