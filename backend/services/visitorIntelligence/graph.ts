/**
 * V-A109 — Visitor Intelligence Graph publication. Visitor-centric edges to Lead (identified_as) /
 * Company (belongs_to) / Offering + Content (engaged_with) / Campaign (acquired_via) — REFERENCES only
 * (shared `GraphNodeRef = {type,id}`). Visitor owns ONLY its own root node; everything else is a
 * reference (no duplicate ownership). Reuses Program 1's graph primitives + Program 4's registries.
 */

import type { VisitorIdentityKey } from './types';
import type { GraphEdge, GraphNodeRef, GraphEdgeType, GraphNodeType, EvidenceRef } from '../intelligence/canonical';
import { node, edge, buildEntityGraph, neighbours } from '../intelligence/canonical';

export function visitorEdge(visitorId: string, type: GraphEdgeType, toType: GraphNodeType, toId: string, evidence: EvidenceRef[] = [], confidence = 0.6): GraphEdge {
  return edge({ type, from: node('visitor', visitorId), to: node(toType, toId), evidence, confidence });
}

export function buildVisitorGraph(key: VisitorIdentityKey, edges: GraphEdge[]): { root: GraphNodeRef; edges: GraphEdge[] } {
  return buildEntityGraph(node('visitor', key.visitorId), edges);
}

export { neighbours };
