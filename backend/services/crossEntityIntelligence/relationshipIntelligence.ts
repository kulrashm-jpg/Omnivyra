/**
 * G-C305 — Relationship Intelligence Engine (pure, deterministic; graph UNCHANGED).
 *
 * Infers relationship QUALITY (strength / recency / freshness / confidence / association / dependency)
 * from the graph edges in the resolved neighborhood. This is entirely DERIVED — the graph topology and
 * edge data are read-only; relationship intelligence produces new descriptors and never writes back.
 */

import type { CrossEntityContext, RelationshipQuality } from './types';
import { nodeKey } from '../intelligenceGraph';
import { decayFactor, clamp01 } from '../intelligence/canonical';

const DEPENDENCY_EDGES = new Set(['belongs_to', 'member_of', 'has_feature', 'priced_as']);

export function assessRelationships(context: CrossEntityContext, opts: { halfLifeDays?: number } = {}): RelationshipQuality[] {
  const halfLife = opts.halfLifeDays ?? 180;
  return context.neighborhood.edges
    .map((e): RelationshipQuality => {
      const provBreadth = clamp01(e.provenance.length / 2);           // 0..1 (≥2 distinct sources = full)
      const strength = clamp01(e.confidence * (0.7 + 0.3 * provBreadth));
      const recency = e.asOf ? decayFactor(e.asOf, context.builtAt, halfLife) : null;
      return {
        edgeId: e.id, type: e.type, from: nodeKey(e.from), to: nodeKey(e.to), owner: e.owner,
        strength, confidence: e.confidence, recency, freshestAt: e.asOf, dependency: DEPENDENCY_EDGES.has(e.type),
      };
    })
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId));
}
