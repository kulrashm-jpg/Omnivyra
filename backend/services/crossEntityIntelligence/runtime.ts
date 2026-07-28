/**
 * Cross-Entity Intelligence Runtime (pure orchestrator; owns no entity semantics). Ties context
 * assembly → evidence fusion → cross-entity reasoning → relationship intelligence → context
 * projection → explainability into one deterministic lifecycle. Flag-gated for any consumer path
 * (default OFF ⇒ null; shadow-only). Reads Programs 1–3 + the Phase-B graph unchanged; writes nothing
 * back.
 */

import type { CanonicalEntityUnderstanding, CrossEntityIntelligenceResult } from './types';
import type { ContextOptions } from './contextAssembler';
import { assembleCrossEntityContext } from './contextAssembler';
import { fuseCrossEntityEvidence } from './evidenceFusion';
import { reasonAcrossEntities } from './reasoningEngine';
import { assessRelationships } from './relationshipIntelligence';
import { projectContext } from './contextProjection';
import { explainAll } from './explainability';
import { isCrossEntityIntelligenceEnabled } from './flags';

export function computeCrossEntityIntelligence(understandings: CanonicalEntityUnderstanding[], builtAt: string, opts: ContextOptions = {}): CrossEntityIntelligenceResult {
  const context = assembleCrossEntityContext(understandings, builtAt, opts);
  const evidence = fuseCrossEntityEvidence(context);
  const insights = reasonAcrossEntities(context);
  const relationships = assessRelationships(context, opts);
  const projections = projectContext(context, insights, relationships);
  const explanations = explainAll(insights, context, relationships);
  return { context, evidence, insights, relationships, projections, explanations, builtAt };
}

/** Flag-gated entry (default OFF ⇒ null; shadow-only). */
export function computeCrossEntitySnapshot(understandings: CanonicalEntityUnderstanding[], builtAt: string, opts: ContextOptions = {}): CrossEntityIntelligenceResult | null {
  if (!isCrossEntityIntelligenceEnabled()) return null;
  return computeCrossEntityIntelligence(understandings, builtAt, opts);
}
