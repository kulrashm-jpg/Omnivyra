/**
 * LI-B101 — Canonical Lead Facet primitives (pure, deterministic).
 * The ONE way to build a facet. Abstains (null) when no evidence; confidence derives
 * deterministically from evidence breadth + distinct sources (mirrors buyingIntent's rule).
 */

import type { Facet, EvidenceRef, SourceRef, ContradictionRef, ISOTimestamp } from './types';

/** Deterministic confidence from evidence: breadth (count) + distinct sources, capped 0..1. */
export function facetConfidenceFromEvidence(evidence: EvidenceRef[]): number {
  if (!evidence.length) return 0;
  const distinctSources = new Set(evidence.map((e) => e.source.system)).size;
  const breadth = Math.min(evidence.length, 8) / 8;          // saturates at 8 items
  const spread = Math.min(distinctSources, 3) / 3;           // saturates at 3 sources
  const conf = 0.4 * spread + 0.6 * breadth;
  return Math.max(0, Math.min(1, Number(conf.toFixed(4))));
}

function provenanceOf(evidence: EvidenceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const e of evidence) {
    const key = `${e.source.system}|${e.source.ref ?? ''}`;
    if (!seen.has(key)) { seen.add(key); out.push(e.source); }
  }
  return out.sort((a, b) => a.system.localeCompare(b.system));
}

function freshest(evidence: EvidenceRef[]): ISOTimestamp | null {
  if (!evidence.length) return null;
  return evidence.reduce((m, e) => (e.observedAt > m ? e.observedAt : m), evidence[0].observedAt);
}

/** An abstaining facet — the honest default when evidence is absent. */
export function nullFacet<T>(unknowns: string[] = []): Facet<T> {
  return { value: null, confidence: 0, evidence: [], provenance: [], asOf: null, contradictions: [], unknowns, assumptions: [] };
}

/** Build a facet from a decided value + its supporting evidence. Confidence is derived, not asserted. */
export function facet<T>(
  value: T | null,
  evidence: EvidenceRef[],
  opts: { contradictions?: ContradictionRef[]; unknowns?: string[]; assumptions?: string[]; confidenceOverride?: number } = {},
): Facet<T> {
  if (value === null || evidence.length === 0) {
    return { ...nullFacet<T>(opts.unknowns ?? []), value: value ?? null, assumptions: opts.assumptions ?? [], contradictions: opts.contradictions ?? [] };
  }
  const active = evidence.filter((e) => e.lifecycle !== 'superseded' && e.lifecycle !== 'expired');
  const base = opts.confidenceOverride ?? facetConfidenceFromEvidence(active);
  // Unresolved contradictions lower confidence (contradiction-aware).
  const unresolved = (opts.contradictions ?? []).filter((c) => !c.resolved).length;
  const confidence = Math.max(0, Math.min(1, Number((base * Math.pow(0.85, unresolved)).toFixed(4))));
  return {
    value,
    confidence,
    evidence: [...evidence],
    provenance: provenanceOf(active.length ? active : evidence),
    asOf: freshest(active.length ? active : evidence),
    contradictions: opts.contradictions ?? [],
    unknowns: opts.unknowns ?? [],
    assumptions: opts.assumptions ?? [],
  };
}
