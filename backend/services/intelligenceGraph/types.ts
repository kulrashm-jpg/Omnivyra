/**
 * PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 / Phase B — Canonical Intelligence Graph contracts.
 *
 * The graph is INFRASTRUCTURE, not intelligence. It aggregates the references-only `GraphEdge`s that
 * every canonical Understanding (Lead/Company/Offering/…) already emits, into one traversable graph —
 * REUSING the shared `GraphNodeRef`/`GraphEdge` primitives (no new foundational primitive; G-A1). Node
 * and edge TYPES are OPEN (registry-driven strings), so future entities register additively without
 * editing any shared union (G-A2). The graph owns NO business semantics — each entity remains the sole
 * owner of its semantics; the graph only stores references + provenance.
 */

import type { GraphNodeRef, GraphEdge, SourceRef, ISOTimestamp } from '../intelligence/canonical';

export type { GraphNodeRef, GraphEdge, SourceRef, ISOTimestamp };

/** Deterministic node key = `type:id`. */
export function nodeKey(ref: { type: string; id: string }): string { return `${ref.type}:${ref.id}`; }

// ── Registries (G-B202/B203) — OPEN, additive type registration ─────────────────────────────────
export interface NodeTypeDefinition { type: string; description?: string; }
export interface EdgeTypeDefinition { type: string; description?: string; from?: string[]; to?: string[]; cardinality?: 'one' | 'many'; directed?: boolean; }
export interface NodeRegistry { register(def: NodeTypeDefinition): void; has(type: string): boolean; get(type: string): NodeTypeDefinition | null; all(): NodeTypeDefinition[]; }
export interface EdgeRegistry { register(def: EdgeTypeDefinition): void; has(type: string): boolean; get(type: string): EdgeTypeDefinition | null; all(): EdgeTypeDefinition[]; }

// ── Publication (G-B204) — an Understanding's references-only contribution ──────────────────────
export interface GraphContribution {
  owner: string;                 // the owning entity type (e.g. 'lead' | 'company' | 'offering')
  ownerId: string;               // the owned root id
  root: GraphNodeRef;            // the node this entity OWNS
  nodes: GraphNodeRef[];         // root + referenced nodes (references are NOT owned here)
  edges: GraphEdge[];            // references-only edges emitted by the Understanding
}

/** Minimal shape any canonical Understanding satisfies (Lead/Company/Offering all match structurally). */
export interface PublishableUnderstanding { graph: { root: GraphNodeRef; edges: GraphEdge[] }; }

// ── Materialized graph (G-B205) ─────────────────────────────────────────────────────────────────
export interface MaterializedNode {
  type: string; id: string; key: string;
  owner: string | null;          // owning entity type if a contribution published it as its root; null = reference-only
  referencedBy: string[];        // owner types that reference this node (sorted, deterministic)
}
export interface MaterializedEdge {
  id: string; type: string; from: GraphNodeRef; to: GraphNodeRef;
  owner: string;                 // the entity that published the edge (= from.type)
  confidence: number; asOf: ISOTimestamp | null; provenance: SourceRef[];
}
export interface MaterializedGraph {
  nodes: MaterializedNode[];
  edges: MaterializedEdge[];
  nodeIndex: Map<string, MaterializedNode>;
  outgoing: Map<string, MaterializedEdge[]>;   // nodeKey → edges where from == node
  incoming: Map<string, MaterializedEdge[]>;   // nodeKey → edges where to == node
  builtAt: ISOTimestamp;
}

// ── Integrity (G-B208) ──────────────────────────────────────────────────────────────────────────
export interface GraphIntegrityIssue { code: string; detail: string; nodeKey?: string; edgeId?: string; }
export interface GraphIntegrityReport { valid: boolean; issues: GraphIntegrityIssue[]; orphanCount: number; danglingCount: number; duplicateOwnershipCount: number; }

// ── Observability (G-B209) ──────────────────────────────────────────────────────────────────────
export interface GraphMetrics {
  nodeCount: number; edgeCount: number; ownedNodes: number; referenceNodes: number;
  nodeTypesUsed: number; edgeTypesUsed: number; registeredNodeTypes: number; registeredEdgeTypes: number;
  registryUtilizationNodes: number; registryUtilizationEdges: number; integrityFailures: number;
}
