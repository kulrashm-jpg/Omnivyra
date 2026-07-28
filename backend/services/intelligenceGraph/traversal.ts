/**
 * G-B206 — Traversal API (pure, deterministic; NO reasoning). Deterministic graph walks over the
 * materialized graph: neighbors / pathExists / shortestPath / subgraph / ancestors / descendants /
 * connectedComponents. All iteration is over sorted keys, so results are reproducible. Traversal
 * performs no inference — it only follows edges.
 */

import type { MaterializedGraph, MaterializedEdge } from './types';
import { nodeKey } from './types';

const sortedKeys = (edges: MaterializedEdge[] | undefined, pick: (e: MaterializedEdge) => string): string[] =>
  [...new Set((edges ?? []).map(pick))].sort();

/** Directed out-neighbors (edge.from == node), sorted. */
export function neighbors(g: MaterializedGraph, key: string): string[] { return sortedKeys(g.outgoing.get(key), (e) => nodeKey(e.to)); }
/** Directed in-neighbors (edge.to == node), sorted. */
export function ancestors(g: MaterializedGraph, key: string): string[] {
  const seen = new Set<string>(); const out: string[] = []; const stack = [key];
  while (stack.length) { const k = stack.pop()!; for (const p of sortedKeys(g.incoming.get(k), (e) => nodeKey(e.from))) if (!seen.has(p)) { seen.add(p); out.push(p); stack.push(p); } }
  return out.sort();
}
export function descendants(g: MaterializedGraph, key: string): string[] {
  const seen = new Set<string>(); const out: string[] = []; const stack = [key];
  while (stack.length) { const k = stack.pop()!; for (const c of neighbors(g, k)) if (!seen.has(c)) { seen.add(c); out.push(c); stack.push(c); } }
  return out.sort();
}

/** Deterministic BFS (sorted frontier) — shortest hop path or null. */
export function shortestPath(g: MaterializedGraph, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>(); const seen = new Set([from]); let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const k of frontier) for (const n of neighbors(g, k)) if (!seen.has(n)) { seen.add(n); prev.set(n, k); if (n === to) { const path = [to]; let c = to; while (prev.has(c)) { c = prev.get(c)!; path.unshift(c); } return path; } next.push(n); }
    frontier = next.sort();
  }
  return null;
}
export function pathExists(g: MaterializedGraph, from: string, to: string): boolean { return shortestPath(g, from, to) !== null; }

/** Undirected connected components (deterministic, sorted). */
export function connectedComponents(g: MaterializedGraph): string[][] {
  const seen = new Set<string>(); const comps: string[][] = [];
  for (const n of g.nodes) {
    if (seen.has(n.key)) continue;
    const comp: string[] = []; const stack = [n.key];
    while (stack.length) { const k = stack.pop()!; if (seen.has(k)) continue; seen.add(k); comp.push(k);
      for (const nb of [...neighbors(g, k), ...sortedKeys(g.incoming.get(k), (e) => nodeKey(e.from))]) if (!seen.has(nb)) stack.push(nb); }
    comps.push(comp.sort());
  }
  return comps.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}

/** Subgraph reachable within `depth` hops from a node (deterministic). */
export function subgraph(g: MaterializedGraph, key: string, depth: number): { nodes: string[]; edges: MaterializedEdge[] } {
  const nodes = new Set([key]); let frontier = [key];
  for (let d = 0; d < depth; d++) { const next: string[] = []; for (const k of frontier) for (const n of neighbors(g, k)) if (!nodes.has(n)) { nodes.add(n); next.push(n); } frontier = next; }
  const edges = g.edges.filter((e) => nodes.has(nodeKey(e.from)) && nodes.has(nodeKey(e.to)));
  return { nodes: [...nodes].sort(), edges };
}
