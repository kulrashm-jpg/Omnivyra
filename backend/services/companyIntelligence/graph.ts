/**
 * CI-B208 — Company Intelligence Graph foundation. Company-centric edges to Lead / Offering /
 * Competitor / Product / Technology / Executive / Customer / Partner / Market / Campaign / Signal —
 * REFERENCES only (reuses the shared `GraphNodeRef = {type,id}`); the company never duplicates entity
 * ownership. Each relationship has exactly one owner: the edge origin.
 */

import type { CompanyIdentityKey } from './types';
import type { GraphEdge, GraphNodeRef, GraphEdgeType, GraphNodeType, EvidenceRef } from '../intelligence/canonical';
import { node, edge, buildEntityGraph, neighbours } from '../intelligence/canonical';

/** Build a company-owned edge (company → referenced entity). */
export function companyEdge(companyId: string, type: GraphEdgeType, toType: GraphNodeType, toId: string, evidence: EvidenceRef[] = [], confidence = 0.6): GraphEdge {
  return edge({ type, from: node('company', companyId), to: node(toType, toId), evidence, confidence });
}

export function buildCompanyGraph(key: CompanyIdentityKey, edges: GraphEdge[]): { root: GraphNodeRef; edges: GraphEdge[] } {
  return buildEntityGraph(node('company', key.companyId), edges);
}

export { neighbours };
