/**
 * G-C307 — Cross-Entity Explainability (pure, deterministic).
 *
 * Every cross-entity conclusion explains itself: Why / Which entities / Which evidence / Which
 * relationships / Which traversal / Which confidence / Which assumptions / Which uncertainty. Nothing
 * is invented — the explanation is derived entirely from the insight's canonical `ReasoningTrace`, the
 * assembled context, and the derived relationships.
 */

import type { CrossEntityContext, CrossEntityInsight, RelationshipQuality, CrossEntityExplanation } from './types';
import { shortestPath } from '../intelligenceGraph';
import { clamp01 } from '../intelligence/canonical';

export function explainInsight(insight: CrossEntityInsight, context: CrossEntityContext, relationships: RelationshipQuality[]): CrossEntityExplanation {
  const t = insight.trace;
  const entitySet = new Set(insight.entities);

  // Traversal: union of the shortest paths from the focus to each participating entity root.
  const traversal = new Set<string>([context.focus.key]);
  for (const key of insight.entities) {
    const path = shortestPath(context.graph, context.focus.key, key);
    if (path) for (const k of path) traversal.add(k);
  }

  const whichRelationships = relationships
    .filter((r) => entitySet.has(r.from) && entitySet.has(r.to))
    .map((r) => r.edgeId).sort();

  return {
    claim: t.claim,
    conclusion: t.conclusion,
    why: [t.claim, ...t.assumptions],
    whichEntities: [...insight.entities].sort(),
    whichEvidence: t.because,
    whichRelationships,
    whichTraversal: [...traversal].sort(),
    confidence: t.confidence,
    assumptions: t.assumptions,
    uncertainty: clamp01(1 - t.confidence),
  };
}

export function explainAll(insights: CrossEntityInsight[], context: CrossEntityContext, relationships: RelationshipQuality[]): CrossEntityExplanation[] {
  return insights.map((i) => explainInsight(i, context, relationships));
}
