/**
 * I-B208 — Intent Intelligence Graph publication. Intent-centric edges to the actor (Visitor/Lead) +
 * the object of intent (Offering/Company) — REFERENCES only (shared `GraphNodeRef = {type,id}`).
 * Intent owns ONLY its own root node; everything else is a reference (no duplicate ownership). NO
 * reasoning edges: the interpretation lives in the Intent facets, never the graph; the graph stays
 * relationship infrastructure.
 */

import type { IntentIdentityKey } from './types';
import type { GraphEdge, GraphNodeRef, GraphEdgeType, GraphNodeType, EvidenceRef } from '../intelligence/canonical';
import { node, edge, buildEntityGraph, neighbours } from '../intelligence/canonical';

export function intentEdge(intentId: string, type: GraphEdgeType, toType: GraphNodeType, toId: string, evidence: EvidenceRef[] = [], confidence = 0.6): GraphEdge {
  return edge({ type, from: node('intent', intentId), to: node(toType, toId), evidence, confidence });
}

export function buildIntentGraph(key: IntentIdentityKey, edges: GraphEdge[]): { root: GraphNodeRef; edges: GraphEdge[] } {
  return buildEntityGraph(node('intent', key.intentId), edges);
}

export { neighbours };
