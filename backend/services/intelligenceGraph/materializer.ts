/**
 * G-B205 — Graph Materializer (pure, deterministic). Aggregates published contributions into ONE
 * unified graph: merges + deduplicates nodes (by key) and edges (by id), preserves provenance (edge
 * evidence sources) and OWNERSHIP (a node is owned by the entity that published it as its root; all
 * other appearances are references), and builds deterministic adjacency indices. Owns no semantics.
 */

import type { GraphContribution, MaterializedGraph, MaterializedNode, MaterializedEdge } from './types';
import { nodeKey } from './types';

export function materializeGraph(contributions: GraphContribution[], builtAt: string): MaterializedGraph {
  const nodeIndex = new Map<string, MaterializedNode>();
  const referencedBy = new Map<string, Set<string>>();

  const touch = (type: string, id: string): MaterializedNode => {
    const key = `${type}:${id}`;
    let n = nodeIndex.get(key);
    if (!n) { n = { type, id, key, owner: null, referencedBy: [] }; nodeIndex.set(key, n); referencedBy.set(key, new Set()); }
    return n;
  };

  for (const c of contributions) {
    // The contribution's root is OWNED by `c.owner`; first writer wins (deterministic: contributions are pre-sorted).
    const rootNode = touch(c.root.type, c.root.id);
    if (rootNode.owner === null) rootNode.owner = c.owner;
    for (const ref of c.nodes) { touch(ref.type, ref.id); if (nodeKey(ref) !== nodeKey(c.root)) referencedBy.get(nodeKey(ref))!.add(c.owner); }
  }
  for (const [key, owners] of referencedBy) nodeIndex.get(key)!.referencedBy = [...owners].sort();

  // Edges: dedupe by id (first wins), attach provenance + owner (= from.type).
  const edgeMap = new Map<string, MaterializedEdge>();
  for (const c of contributions) {
    for (const e of c.edges) {
      if (edgeMap.has(e.id)) continue;
      edgeMap.set(e.id, { id: e.id, type: e.type, from: e.from, to: e.to, owner: e.from.type, confidence: e.confidence, asOf: e.asOf, provenance: e.evidence.map((ev) => ev.source) });
    }
  }

  const nodes = [...nodeIndex.values()].sort((a, b) => a.key.localeCompare(b.key));
  const edges = [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const outgoing = new Map<string, MaterializedEdge[]>();
  const incoming = new Map<string, MaterializedEdge[]>();
  for (const e of edges) {
    (outgoing.get(nodeKey(e.from)) ?? outgoing.set(nodeKey(e.from), []).get(nodeKey(e.from))!).push(e);
    (incoming.get(nodeKey(e.to)) ?? incoming.set(nodeKey(e.to), []).get(nodeKey(e.to))!).push(e);
  }
  return { nodes, edges, nodeIndex, outgoing, incoming, builtAt };
}
