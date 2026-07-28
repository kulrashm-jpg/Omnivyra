/**
 * OI-B207 — Offering Intelligence Graph foundation. Offering-centric edges to Company / Lead /
 * Competitor / Feature / PricingPlan / Persona / Industry / Integration / Technology / Campaign /
 * Customer / Partner — REFERENCES only (shared `GraphNodeRef = {type,id}`). Offering owns only its
 * own semantics; everything else is a reference (no duplicate ownership).
 */

import type { OfferingIdentityKey } from './types';
import type { GraphEdge, GraphNodeRef, GraphEdgeType, GraphNodeType, EvidenceRef } from '../intelligence/canonical';
import { node, edge, buildEntityGraph, neighbours } from '../intelligence/canonical';

export function offeringEdge(offeringId: string, type: GraphEdgeType, toType: GraphNodeType, toId: string, evidence: EvidenceRef[] = [], confidence = 0.6): GraphEdge {
  return edge({ type, from: node('offering', offeringId), to: node(toType, toId), evidence, confidence });
}

export function buildOfferingGraph(key: OfferingIdentityKey, edges: GraphEdge[]): { root: GraphNodeRef; edges: GraphEdge[] } {
  return buildEntityGraph(node('offering', key.offeringId), edges);
}

export { neighbours };
