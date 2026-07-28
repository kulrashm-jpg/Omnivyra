/**
 * G-B207 — Graph Query Framework (pure, deterministic; NO inference). Node/edge lookup, relationship
 * filters, multi-hop traversal, and graph projections over the materialized graph. Returns references
 * only — it draws no conclusions.
 */

import type { MaterializedGraph, MaterializedNode, MaterializedEdge } from './types';
import { nodeKey } from './types';
import { neighbors } from './traversal';

export function getNode(g: MaterializedGraph, type: string, id: string): MaterializedNode | null { return g.nodeIndex.get(`${type}:${id}`) ?? null; }
export function nodesOfType(g: MaterializedGraph, type: string): MaterializedNode[] { return g.nodes.filter((n) => n.type === type); }
export function edgesOfType(g: MaterializedGraph, type: string): MaterializedEdge[] { return g.edges.filter((e) => e.type === type); }

/** Edges matching optional from-type / to-type / edge-type filters. */
export function filterEdges(g: MaterializedGraph, f: { edgeType?: string; fromType?: string; toType?: string } = {}): MaterializedEdge[] {
  return g.edges.filter((e) => (!f.edgeType || e.type === f.edgeType) && (!f.fromType || e.from.type === f.fromType) && (!f.toType || e.to.type === f.toType));
}

/** Multi-hop: node keys reachable in exactly `hops` directed steps (deterministic, deduped). */
export function multiHop(g: MaterializedGraph, startKey: string, hops: number): string[] {
  let frontier = [startKey];
  for (let h = 0; h < hops; h++) frontier = [...new Set(frontier.flatMap((k) => neighbors(g, k)))].sort();
  return frontier;
}

/** Projection: a flat view of nodes of a type + their outgoing edges (deterministic). */
export interface NodeProjection { key: string; type: string; id: string; owner: string | null; out: Array<{ type: string; to: string }>; }
export function project(g: MaterializedGraph, type: string): NodeProjection[] {
  return nodesOfType(g, type).map((n) => ({ key: n.key, type: n.type, id: n.id, owner: n.owner, out: (g.outgoing.get(n.key) ?? []).map((e) => ({ type: e.type, to: nodeKey(e.to) })).sort((a, b) => (a.type + a.to).localeCompare(b.type + b.to)) }));
}
