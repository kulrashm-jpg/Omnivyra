/**
 * G-C302 — Multi-Hop Context Resolver (pure, deterministic; READ-ONLY over the graph).
 *
 * Resolves the graph neighborhood around a focus node: configurable depth, deterministic (sorted)
 * ordering, provenance preservation, duplicate elimination, and cycle protection (visited set). It
 * traverses the Phase-B materialized graph and MUTATES NOTHING — the graph topology is unchanged; the
 * neighborhood is a derived view.
 */

import type { MaterializedGraph, MaterializedEdge, MaterializedNode, SourceRef, ResolvedNeighborhood, NeighborhoodOptions } from './types';
import { nodeKey, neighbors } from '../intelligenceGraph';

export function resolveNeighborhood(g: MaterializedGraph, rootKey: string, opts: NeighborhoodOptions = {}): ResolvedNeighborhood {
  const depth = Math.max(0, opts.depth ?? 2);
  const hopsOf: Record<string, number> = { [rootKey]: 0 };
  const visited = new Set<string>([rootKey]);          // cycle protection + dedup
  let frontier = [rootKey];

  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const k of frontier) {
      for (const n of neighbors(g, k)) {               // sorted → deterministic
        if (visited.has(n)) continue;                  // already reached (cycle-safe, deduped)
        visited.add(n); hopsOf[n] = d + 1; next.push(n);
      }
    }
    frontier = next.sort();
  }

  const nodes: MaterializedNode[] = [...visited]
    .map((k) => g.nodeIndex.get(k))
    .filter((n): n is MaterializedNode => n != null)
    .sort((a, b) => (hopsOf[a.key] - hopsOf[b.key]) || a.key.localeCompare(b.key));

  const edges: MaterializedEdge[] = g.edges
    .filter((e) => visited.has(nodeKey(e.from)) && visited.has(nodeKey(e.to)))
    .sort((a, b) => a.id.localeCompare(b.id));

  // Provenance preserved: union of edge provenance, deduped by (system|ref), sorted.
  const provMap = new Map<string, SourceRef>();
  for (const e of edges) for (const s of e.provenance) provMap.set(`${s.system}|${s.ref ?? ''}`, s);
  const provenance = [...provMap.values()].sort((a, b) => a.system.localeCompare(b.system));

  return { root: rootKey, depth, nodes, edges, provenance, hopsOf };
}
