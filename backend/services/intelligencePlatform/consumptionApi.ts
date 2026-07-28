/**
 * G-D403 — Platform Consumption API (pure, deterministic; the stable downstream seam).
 *
 * `openIntelligencePlatform(understandings, builtAt, opts)` computes the cross-entity intelligence ONCE
 * (Phase C, which itself materializes the Phase-B graph) and returns a read-only `PlatformSession`
 * exposing context / traversal / evidence / reasoning / relationships / explainability. Downstream
 * consumers use ONLY these views — they never import graph internals, never build a parallel
 * relationship model, never re-reason. The session owns nothing and mutates nothing.
 */

import type { CanonicalEntityUnderstanding, PlatformSession, ConsumptionOptions, CanonicalContext, EvidenceRef, CrossEntityInsight, RelationshipQuality, CrossEntityExplanation } from './types';
import { computeCrossEntityIntelligence } from '../crossEntityIntelligence';
import { shortestPath } from '../intelligenceGraph';
import { toCanonicalContext } from './contextContracts';
import { isIntelligencePlatformEnabled } from './flags';

export function openIntelligencePlatform(understandings: CanonicalEntityUnderstanding[], builtAt: string, opts: ConsumptionOptions = {}): PlatformSession {
  const result = computeCrossEntityIntelligence(understandings, builtAt, opts);  // single compute; internals stay inside
  const canonical: CanonicalContext = toCanonicalContext(result);
  return Object.freeze({
    context: (): CanonicalContext => canonical,
    traverse: (fromKey: string, toKey: string): string[] | null => shortestPath(result.context.graph, fromKey, toKey),
    evidence: (): EvidenceRef[] => result.evidence.fused,
    reasoning: (): CrossEntityInsight[] => result.insights,
    relationships: (): RelationshipQuality[] => result.relationships,
    explain: (): CrossEntityExplanation[] => result.explanations,
  });
}

/** Flag-gated entry (default OFF ⇒ null; shadow-only). */
export function openIntelligencePlatformSnapshot(understandings: CanonicalEntityUnderstanding[], builtAt: string, opts: ConsumptionOptions = {}): PlatformSession | null {
  if (!isIntelligencePlatformEnabled()) return null;
  return openIntelligencePlatform(understandings, builtAt, opts);
}
