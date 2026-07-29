/**
 * J-B208 — Journey Intelligence Graph publication. Journey-centric edges to the actor (Visitor/Lead)
 * + touched entities (Offering/Content/Campaign) + journey-scoped Stage/Milestone/Touchpoint reference
 * nodes — REFERENCES only (shared `GraphNodeRef = {type,id}`). Journey owns ONLY its own root node;
 * everything else is a reference (no duplicate ownership). Ordering does NOT live here — it lives in
 * the Journey facets (derived from evidence chronology); the graph stays relationship infrastructure.
 */

import type { JourneyIdentityKey } from './types';
import type { GraphEdge, GraphNodeRef, GraphEdgeType, GraphNodeType, EvidenceRef } from '../intelligence/canonical';
import { node, edge, buildEntityGraph, neighbours } from '../intelligence/canonical';

export function journeyEdge(journeyId: string, type: GraphEdgeType, toType: GraphNodeType, toId: string, evidence: EvidenceRef[] = [], confidence = 0.6): GraphEdge {
  return edge({ type, from: node('journey', journeyId), to: node(toType, toId), evidence, confidence });
}

export function buildJourneyGraph(key: JourneyIdentityKey, edges: GraphEdge[]): { root: GraphNodeRef; edges: GraphEdge[] } {
  return buildEntityGraph(node('journey', key.journeyId), edges);
}

export { neighbours };
