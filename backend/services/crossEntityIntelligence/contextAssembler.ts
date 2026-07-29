/**
 * G-C301 — Cross-Entity Context Assembler (pure, deterministic).
 *
 * Given a set of canonical Understandings, builds a deterministic reasoning context: it materializes
 * the Phase-B graph from the entities (reusing the graph runtime — NO new graph), resolves the
 * neighborhood around a focus entity, identifies the participating entities, and gathers their
 * CANONICAL evidence (from reasoning traces + graph edges). It owns no semantics and never mutates the
 * understandings or the graph.
 */

import type { CanonicalEntityUnderstanding, ContextEntity, CrossEntityContext, EvidenceRef, NeighborhoodOptions } from './types';
import { materializeGraph, publishAll, nodeKey } from '../intelligenceGraph';
import { resolveNeighborhood } from './multiHopResolver';

/** Canonical evidence exposed by an Understanding — from reasoning `because` + graph edges (deduped by id). */
export function evidenceOf(u: CanonicalEntityUnderstanding): EvidenceRef[] {
  const byId = new Map<string, EvidenceRef>();
  for (const t of u.reasoning) for (const e of t.because) byId.set(e.id, e);
  for (const edge of u.graph.edges) for (const e of edge.evidence) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface ContextOptions extends NeighborhoodOptions { focusKey?: string; }

export function assembleCrossEntityContext(understandings: CanonicalEntityUnderstanding[], builtAt: string, opts: ContextOptions = {}): CrossEntityContext {
  if (understandings.length === 0) throw new Error('assembleCrossEntityContext: no entities');

  const graph = materializeGraph(publishAll(understandings), builtAt);

  // Map every owned root node → its understanding (references-only; entity keeps ownership).
  const byRoot = new Map<string, CanonicalEntityUnderstanding>();
  for (const u of understandings) byRoot.set(nodeKey(u.graph.root), u);

  const focusKey = opts.focusKey ?? nodeKey(understandings[0].graph.root);
  const focusU = byRoot.get(focusKey);
  if (!focusU) throw new Error(`assembleCrossEntityContext: focus ${focusKey} not among entities`);

  const neighborhood = resolveNeighborhood(graph, focusKey, opts);
  const reached = new Set(neighborhood.nodes.map((n) => n.key));

  const toEntity = (key: string, u: CanonicalEntityUnderstanding): ContextEntity => {
    const [type, ...rest] = key.split(':');
    return { key, type, id: rest.join(':'), understanding: u };
  };
  const focus = toEntity(focusKey, focusU);

  // Participating entities = understandings whose owned root is within the neighborhood (deterministic order).
  const entities: ContextEntity[] = [...byRoot.entries()]
    .filter(([key]) => reached.has(key))
    .map(([key, u]) => toEntity(key, u))
    .sort((a, b) => a.key.localeCompare(b.key));

  // Canonical evidence from participating entities (deduped by id, sorted) — CONSUMED, not owned.
  const byId = new Map<string, EvidenceRef>();
  for (const e of entities) for (const ev of evidenceOf(e.understanding)) byId.set(ev.id, ev);
  const evidence = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  return { focus, entities, graph, neighborhood, evidence, builtAt };
}
