/**
 * G-B204 — Graph Publication Framework (pure, deterministic). Every canonical Understanding publishes
 * a references-only `GraphContribution` — extracted from the `graph: {root, edges}` it ALREADY emits.
 * The entity retains sole semantic ownership: the contribution carries the root it owns + the edges +
 * the referenced node ids (references, NOT owned). Reads Programs 1–3 unchanged; writes nothing back.
 */

import type { GraphContribution, PublishableUnderstanding, GraphNodeRef } from './types';
import { nodeKey } from './types';

/** Publish one Understanding's graph as a references-only contribution. */
export function publishUnderstanding(u: PublishableUnderstanding): GraphContribution {
  const root = u.graph.root;
  const nodeSet = new Map<string, GraphNodeRef>();
  nodeSet.set(nodeKey(root), root);
  for (const e of u.graph.edges) { nodeSet.set(nodeKey(e.from), e.from); nodeSet.set(nodeKey(e.to), e.to); }
  const nodes = [...nodeSet.values()].sort((a, b) => nodeKey(a).localeCompare(nodeKey(b)));
  return {
    owner: root.type,
    ownerId: root.id,
    root,
    nodes,
    edges: [...u.graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Publish many understandings (deterministic order by owner root key). */
export function publishAll(understandings: PublishableUnderstanding[]): GraphContribution[] {
  return understandings.map(publishUnderstanding).sort((a, b) => nodeKey(a.root).localeCompare(nodeKey(b.root)));
}
