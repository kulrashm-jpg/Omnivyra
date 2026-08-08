/**
 * CI-B209 — Contact Intelligence Graph publication. Contact-centric edges to the Canonical Person, the
 * employing Company, and the Lead/Journey/Intent surfaces that reference this person — REFERENCES only
 * (shared `GraphNodeRef = {type,id}`). Contact owns ONLY its own root node; everything else is a
 * reference, so no entity is owned twice. No reasoning edges: the understanding lives in the Contact
 * facets, and the graph stays relationship infrastructure.
 */

import type { ContactIdentityKey } from './types';
import type { GraphEdge, GraphNodeRef, GraphEdgeType, GraphNodeType, EvidenceRef } from '../intelligence/canonical';
import { node, edge, buildEntityGraph, neighbours } from '../intelligence/canonical';

export function contactEdge(
  contactId: string,
  type: GraphEdgeType,
  toType: GraphNodeType,
  toId: string,
  evidence: EvidenceRef[] = [],
  confidence = 0.6,
): GraphEdge {
  return edge({ type, from: node('contact', contactId), to: node(toType, toId), evidence, confidence });
}

export function buildContactGraph(key: ContactIdentityKey, edges: GraphEdge[]): { root: GraphNodeRef; edges: GraphEdge[] } {
  return buildEntityGraph(node('contact', key.contactId), edges);
}

export { neighbours };
