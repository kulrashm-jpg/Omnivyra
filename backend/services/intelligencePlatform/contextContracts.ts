/**
 * G-D402 — Canonical Context Contract normalization (pure, deterministic).
 *
 * Turns a Phase-C `CrossEntityIntelligenceResult` into the STABLE `CanonicalContext` downstream
 * programs consume — flattening insights to identity-only references and carrying the cross-entity
 * context projections + relationship/evidence summaries. It DUPLICATES no entity projection and adds
 * no new model; it re-shapes existing cross-entity outputs into one stable contract.
 */

import type { CanonicalContext, ContextInsight, EntityRef } from './types';
import type { CrossEntityIntelligenceResult } from '../crossEntityIntelligence';

export function toCanonicalContext(result: CrossEntityIntelligenceResult): CanonicalContext {
  const ref = (e: { key: string; type: string; id: string }): EntityRef => ({ key: e.key, type: e.type, id: e.id });
  const insights: ContextInsight[] = result.insights
    .map((i) => ({ kind: i.kind, claim: i.claim, conclusion: i.trace.conclusion, entities: [...i.entities].sort(), confidence: i.confidence, abstained: i.abstained }))
    .sort((a, b) => a.kind.localeCompare(b.kind));

  return {
    focus: ref(result.context.focus),
    entities: result.context.entities.map(ref).sort((a, b) => a.key.localeCompare(b.key)),
    contexts: result.projections,
    insights,
    relationshipCount: result.relationships.length,
    evidenceCount: result.evidence.fused.length,
    builtAt: result.builtAt,
  };
}
