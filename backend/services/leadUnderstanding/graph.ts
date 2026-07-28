/**
 * LI-B106 — Lead Intelligence Graph foundation (pure, deterministic). Relationships among Lead,
 * Company, Offering, Competitor, Campaign, Content, Signal, Opportunity, Team, Organization.
 * Nodes are REFERENCES only (type + id) — the graph never owns entity semantics (no duplicate
 * ownership; the owning platform remains the source of truth). Edges carry evidence + confidence.
 */

import type { LeadGraph, GraphEdge, GraphNodeRef, GraphNodeType, GraphEdgeType, EvidenceRef } from './types';

export function node(type: GraphNodeType, id: string): GraphNodeRef { return { type, id }; }

export function edge(input: { type: GraphEdgeType; from: GraphNodeRef; to: GraphNodeRef; evidence?: EvidenceRef[]; confidence?: number; asOf?: string | null }): GraphEdge {
  const ev = input.evidence ?? [];
  return {
    id: `${input.type}:${input.from.type}/${input.from.id}->${input.to.type}/${input.to.id}`,
    type: input.type, from: input.from, to: input.to,
    evidence: ev, confidence: Math.max(0, Math.min(1, input.confidence ?? (ev.length ? 0.5 : 0))),
    asOf: input.asOf ?? (ev.length ? ev.reduce((m, e) => (e.observedAt > m ? e.observedAt : m), ev[0].observedAt) : null),
  };
}

/** Build the canonical lead graph: reject self-loops, dedupe by edge id, deterministic order. */
export function buildLeadGraph(root: GraphNodeRef, edges: GraphEdge[]): LeadGraph {
  const seen = new Set<string>();
  const clean: GraphEdge[] = [];
  for (const e of edges) {
    if (e.from.type === e.to.type && e.from.id === e.to.id) continue; // no self-loop
    if (seen.has(e.id)) continue;                                     // no duplicate relationship ownership
    seen.add(e.id); clean.push(e);
  }
  clean.sort((a, b) => a.id.localeCompare(b.id));
  return { root, edges: clean };
}

/** Neighbours of a node by edge type (deterministic). */
export function neighbours(graph: LeadGraph, type?: GraphEdgeType): GraphNodeRef[] {
  return graph.edges.filter((e) => !type || e.type === type).map((e) => e.to);
}
