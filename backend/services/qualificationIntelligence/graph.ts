/**
 * Q-B208 — Qualification Intelligence Graph publication. Qualification-centric edges to the actor
 * (Lead/Visitor) + the object of qualification (Offering/Company) — REFERENCES only (shared
 * `GraphNodeRef = {type,id}`). Qualification owns ONLY its own root node; everything else is a
 * reference (no duplicate ownership). NO reasoning/policy edges: the evaluation + policy provenance
 * live in the Qualification facets, never the graph; the graph stays relationship infrastructure.
 */

import type { QualificationIdentityKey } from './types';
import type { GraphEdge, GraphNodeRef, GraphEdgeType, GraphNodeType, EvidenceRef } from '../intelligence/canonical';
import { node, edge, buildEntityGraph, neighbours } from '../intelligence/canonical';

export function qualificationEdge(qualificationId: string, type: GraphEdgeType, toType: GraphNodeType, toId: string, evidence: EvidenceRef[] = [], confidence = 0.6): GraphEdge {
  return edge({ type, from: node('qualification', qualificationId), to: node(toType, toId), evidence, confidence });
}

export function buildQualificationGraph(key: QualificationIdentityKey, edges: GraphEdge[]): { root: GraphNodeRef; edges: GraphEdge[] } {
  return buildEntityGraph(node('qualification', key.qualificationId), edges);
}

export { neighbours };
