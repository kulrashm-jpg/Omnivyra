/**
 * V-B206 — Visitor Confidence Framework (deterministic; reuses shared scoring primitives — NO new
 * scoring system). Summarizes confidence in the visitor understanding across four factors: evidence
 * quantity, quality (distinct sources), freshness (decay toward asOf), and agreement (1 − unresolved-
 * contradiction ratio). Reuses `facetConfidenceFromEvidence` + `decayFactor` + `clamp01`.
 */

import type { EvidenceRef, ContradictionRef } from '../types';
import { facetConfidenceFromEvidence, decayFactor, clamp01 } from '../../intelligence/canonical';

export interface VisitorConfidence {
  overall: number;                 // 0..1 blended
  quantity: number;                // evidence breadth
  quality: number;                 // distinct-source coverage
  freshness: number;               // decay of the freshest evidence toward asOf
  agreement: number;               // 1 − unresolved-contradiction ratio
  evidenceCount: number;
  distinctSources: number;
}

export function visitorConfidence(evidence: EvidenceRef[], contradictions: ContradictionRef[], asOf: string): VisitorConfidence {
  const evidenceCount = evidence.length;
  const distinctSources = new Set(evidence.map((e) => e.source.system)).size;
  const quantity = clamp01(Math.min(evidenceCount, 8) / 8);
  const quality = clamp01(Math.min(distinctSources, 3) / 3);
  const base = facetConfidenceFromEvidence(evidence);   // shared breadth+source blend (reused, not reinvented)

  const freshestAt = evidenceCount ? evidence.reduce((m, e) => (e.observedAt > m ? e.observedAt : m), evidence[0].observedAt) : null;
  const freshness = freshestAt ? decayFactor(freshestAt, asOf, 30) : 0;

  const unresolved = contradictions.filter((c) => !c.resolved).length;
  const agreement = evidenceCount ? clamp01(1 - unresolved / Math.max(1, evidenceCount)) : 1;

  const overall = clamp01(0.4 * base + 0.25 * freshness + 0.2 * quality + 0.15 * agreement);
  return { overall, quantity, quality, freshness, agreement, evidenceCount, distinctSources };
}
