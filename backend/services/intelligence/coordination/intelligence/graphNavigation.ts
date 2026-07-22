/**
 * Communication graph navigation (WS-2C) — PURE helpers over a CommunicationGraph.
 *
 * The graph's derivation edges point child → predecessor (`derives_from`/`adapts`/
 * `responds_to`/`measures`), plus `belongs_to` (artifact → root/campaign). These
 * helpers walk that structure. No I/O, deterministic.
 */
import type { CommunicationGraph, GraphNode, GraphNodeKind } from '../semanticContinuityContracts';
import type { ArtifactType } from '../coordinationContracts';

const DERIVATION_KINDS = new Set(['derives_from', 'adapts', 'responds_to', 'measures']);

/** A node with its derived children nested — the centralized lineage-tree shape. */
export interface LineageTreeNode {
  id: string;
  kind: GraphNodeKind;
  artifactType?: ArtifactType;
  label?: string;
  children: LineageTreeNode[];
}

/**
 * Build a lineage tree rooted at `startId` by composing `childrenOf` (cycle-safe).
 * Centralized here so profiles never re-implement traversal.
 */
export function lineageTree(graph: CommunicationGraph, startId: string): LineageTreeNode | null {
  const start = graph.nodes.find((n) => n.id === startId);
  if (!start) return null;
  const visited = new Set<string>();
  const build = (node: GraphNode): LineageTreeNode => {
    visited.add(node.id);
    const children = childrenOf(graph, node.id)
      .filter((c) => !visited.has(c.id))
      .map((c) => build(c));
    return { id: node.id, kind: node.kind, artifactType: node.artifactType, label: node.label, children };
  };
  return build(start);
}

/** The semantic-root nodes in the graph. */
export function rootsOf(graph: CommunicationGraph): GraphNode[] {
  return graph.nodes.filter((n) => n.kind === 'semantic_root');
}

/** Direct predecessors of a node (its parents in the derivation chain). */
export function parentsOf(graph: CommunicationGraph, nodeId: string): GraphNode[] {
  const ids = graph.edges
    .filter((e) => e.from === nodeId && DERIVATION_KINDS.has(e.kind))
    .map((e) => e.to);
  return nodesByIds(graph, ids);
}

/** Direct successors of a node (artifacts derived directly from it). */
export function childrenOf(graph: CommunicationGraph, nodeId: string): GraphNode[] {
  const ids = graph.edges
    .filter((e) => e.to === nodeId && DERIVATION_KINDS.has(e.kind))
    .map((e) => e.from);
  return nodesByIds(graph, ids);
}

/** Transitive descendants (breadth-first; cycle-safe). */
export function descendantsOf(graph: CommunicationGraph, nodeId: string): GraphNode[] {
  return traverse(graph, nodeId, childrenOf);
}

/** Transitive ancestors up to the root (breadth-first; cycle-safe). */
export function ancestorsOf(graph: CommunicationGraph, nodeId: string): GraphNode[] {
  return traverse(graph, nodeId, parentsOf);
}

function nodesByIds(graph: CommunicationGraph, ids: string[]): GraphNode[] {
  const seen = new Set<string>();
  const out: GraphNode[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const node = graph.nodes.find((n) => n.id === id);
    if (node) out.push(node);
  }
  return out;
}

function traverse(
  graph: CommunicationGraph,
  startId: string,
  step: (g: CommunicationGraph, id: string) => GraphNode[],
): GraphNode[] {
  const visited = new Set<string>([startId]);
  const out: GraphNode[] = [];
  let frontier = [startId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const node of step(graph, id)) {
        if (visited.has(node.id)) continue;
        visited.add(node.id);
        out.push(node);
        next.push(node.id);
      }
    }
    frontier = next;
  }
  return out;
}
