/**
 * PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 / Phase C — Cross-Entity Intelligence contracts.
 *
 * This layer REASONS ACROSS canonical entities (Lead/Company/Offering) by CONSUMING the Canonical
 * Intelligence Graph (Phase B) + the entities' canonical evidence — and OWNS NO entity semantics. It
 * never mutates the graph, never re-scores or re-projects an entity, never persists. It produces only
 * DERIVED evidence + DERIVED reasoning (grounded in canonical evidence, abstaining when insufficient),
 * reusing the shared `EvidenceRef`/`ReasoningTrace`/fusion/explain contracts (no new primitive).
 */

import type {
  GraphNodeRef, GraphEdge, EvidenceRef, ReasoningTrace, ContradictionRef, SourceRef, ISOTimestamp,
} from '../intelligence/canonical';
import type { MaterializedGraph, MaterializedNode, MaterializedEdge } from '../intelligenceGraph';

export type { GraphNodeRef, GraphEdge, EvidenceRef, ReasoningTrace, ContradictionRef, SourceRef, ISOTimestamp };
export type { MaterializedGraph, MaterializedNode, MaterializedEdge };

/**
 * The read-only surface any canonical Understanding exposes (Lead/Company/Offering all satisfy it
 * structurally). Cross-Entity Intelligence consumes this — it does NOT depend on entity-specific facet
 * shapes and never writes back. Semantics stay owned by the entity.
 */
export interface CanonicalEntityUnderstanding {
  graph: { root: GraphNodeRef; edges: GraphEdge[] };
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  builtAt: ISOTimestamp;
}

/** An entity participating in a cross-entity context (its root ref + the understanding it owns). */
export interface ContextEntity { key: string; type: string; id: string; understanding: CanonicalEntityUnderstanding; }

// ── G-C302 Multi-Hop Context Resolution ─────────────────────────────────────────────────────────
export interface NeighborhoodOptions { depth?: number; halfLifeDays?: number; }
export interface ResolvedNeighborhood {
  root: string;                       // focus node key
  depth: number;
  nodes: MaterializedNode[];          // reachable nodes (deterministic, deduped, cycle-safe)
  edges: MaterializedEdge[];          // edges within the neighborhood
  provenance: SourceRef[];            // union of edge provenance (preserved, deduped, sorted)
  hopsOf: Record<string, number>;     // node key → hop distance from root
}

// ── G-C301 Cross-Entity Context Assembly ────────────────────────────────────────────────────────
export interface CrossEntityContext {
  focus: ContextEntity;
  entities: ContextEntity[];          // focus + participating entities in the neighborhood
  graph: MaterializedGraph;           // the Phase-B graph (read-only)
  neighborhood: ResolvedNeighborhood;
  evidence: EvidenceRef[];            // canonical evidence gathered from participating entities (deduped)
  builtAt: ISOTimestamp;
}

// ── G-C303 Cross-Entity Evidence Fusion ─────────────────────────────────────────────────────────
export interface FusedCrossEntityEvidence {
  fused: EvidenceRef[];               // shared fuseEvidence output (dedup/reweight/conflict) — reused, not reinvented
  provenance: SourceRef[];
  contradictions: ContradictionRef[];
  confidence: number;
  derived: EvidenceRef[];             // inferred evidence summarizing each entity's cross-entity contribution
}

// ── G-C304 Cross-Entity Reasoning ───────────────────────────────────────────────────────────────
export type CrossEntityInsightKind = 'qualification' | 'portfolio' | 'interest' | 'buying_context' | 'account';
export interface CrossEntityInsight {
  kind: CrossEntityInsightKind;
  claim: string;
  entities: string[];                 // participating entity keys (sorted)
  trace: ReasoningTrace;              // canonical reasoning trace (references canonical evidence)
  confidence: number;
  abstained: boolean;
}

// ── G-C305 Relationship Intelligence ────────────────────────────────────────────────────────────
export interface RelationshipQuality {
  edgeId: string;
  type: string;                       // association (edge type — derived, graph unchanged)
  from: string; to: string;
  owner: string;                      // the entity that owns the edge (unchanged)
  strength: number;                   // 0..1 derived from confidence + provenance breadth
  confidence: number;                 // 0..1 (the edge's own confidence, unchanged)
  recency: number | null;             // 0..1 freshness (decay of asOf toward builtAt); null if undated
  freshestAt: ISOTimestamp | null;
  dependency: boolean;                // structural dependency edge (belongs_to/member_of/has_feature/priced_as)
}

// ── G-C306 Context Projections ──────────────────────────────────────────────────────────────────
export type ContextProjectionName = 'buying_context' | 'account_context' | 'offering_context' | 'relationship_context';
export interface ContextProjection {
  name: ContextProjectionName;
  focus: string;                      // focus node key
  entities: string[];                 // participating entity keys (sorted)
  insights: string[];                 // insight claims contributing (sorted)
  relationshipCount: number;
  confidence: number;                 // 0..1
  projectedAt: ISOTimestamp;
}

// ── G-C307 Cross-Entity Explainability ──────────────────────────────────────────────────────────
export interface CrossEntityExplanation {
  claim: string;
  conclusion: string | number | boolean | null;
  why: string[];
  whichEntities: string[];
  whichEvidence: EvidenceRef[];
  whichRelationships: string[];       // edge ids referenced
  whichTraversal: string[];           // node keys on the traversal path (root → participating roots)
  confidence: number;
  assumptions: string[];
  uncertainty: number;                // 1 - confidence
}

// ── Runtime result ──────────────────────────────────────────────────────────────────────────────
export interface CrossEntityIntelligenceResult {
  context: CrossEntityContext;
  evidence: FusedCrossEntityEvidence;
  insights: CrossEntityInsight[];
  relationships: RelationshipQuality[];
  projections: ContextProjection[];
  explanations: CrossEntityExplanation[];
  builtAt: ISOTimestamp;
}
