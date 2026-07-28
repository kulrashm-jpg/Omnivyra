/**
 * LI-D302 — Multi-Source Intelligence Fusion (pure, deterministic). Merges evidence from many
 * sources (internal/CRM/marketing/enrichment/web/social/first-party/third-party) with deduplication,
 * conflict resolution (reuses the canonical contradiction engine), source weighting, freshness, and
 * confidence. Produces one fused evidence set + provenance + a conflict list — never drops silently.
 */

import type { EvidenceRef, SourceRef, ContradictionRef } from '../types';
import { normalizeEvidence, activeEvidence } from '../evidence';
import { detectEvidenceContradictions } from '../contradiction';
import { facetConfidenceFromEvidence } from '../facets';
import { clamp01 } from './engineTypes';

// Default source trust weights (deterministic policy; override per call).
export const DEFAULT_SOURCE_WEIGHTS: Record<string, number> = {
  crm: 0.9, filing: 0.95, company_profile: 0.9, enrichment_provider: 0.8, website_capture: 0.75,
  marketing: 0.7, first_party: 0.75, third_party: 0.6, news: 0.5, social: 0.4, community: 0.4, web: 0.5,
};

export interface FusionResult {
  fused: EvidenceRef[];
  provenance: SourceRef[];
  contradictions: ContradictionRef[];
  sourceWeights: Record<string, number>;
  confidence: number;
}

export function fuseEvidence(evidence: EvidenceRef[], opts: { sourceWeights?: Record<string, number> } = {}): FusionResult {
  const weights = { ...DEFAULT_SOURCE_WEIGHTS, ...(opts.sourceWeights ?? {}) };
  // Dedup by identity id (normalizeEvidence), then by (label|value|system) keeping the freshest.
  const byKey = new Map<string, EvidenceRef>();
  for (const e of normalizeEvidence(evidence)) {
    const key = `${e.label}|${String(e.value)}|${e.source.system}`;
    const prev = byKey.get(key);
    if (!prev || e.observedAt > prev.observedAt) byKey.set(key, e);
  }
  // Apply source weighting onto each item's weight (deterministic).
  const fused = [...byKey.values()]
    .map((e) => ({ ...e, weight: clamp01((e.weight ?? 0.5) * (weights[e.source.system] ?? 0.5)) }))
    .sort((a, b) => (a.observedAt === b.observedAt ? a.id.localeCompare(b.id) : b.observedAt.localeCompare(a.observedAt)));

  const contradictions = detectEvidenceContradictions(fused);
  const provenance = [...new Map(fused.map((e) => [`${e.source.system}|${e.source.ref ?? ''}`, e.source])).values()].sort((a, b) => a.system.localeCompare(b.system));
  return { fused, provenance, contradictions, sourceWeights: weights, confidence: facetConfidenceFromEvidence(activeEvidence(fused)) };
}
