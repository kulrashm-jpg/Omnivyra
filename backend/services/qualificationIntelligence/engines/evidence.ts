/**
 * Q-C302 — Evidence Intelligence Engine (deterministic contributor). Analyzes the evidence supporting
 * the policy evaluation: coverage, freshness, completeness, consistency, contradictory evidence.
 * Interprets only — introduces NO new evidence. Abstains without observations.
 */

import type { QualificationEngineOutput, QualificationIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { mkEvidence, clamp01, decayFactor, reasoningTrace, detectEvidenceContradictions, evidenceRef } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runEvidence(ctx: QualificationIntelligenceContext): QualificationEngineOutput {
  const observations = ctx.raw?.observations ?? [];
  const criteria = ctx.raw?.policy.criteria ?? [];
  if (!observations.length) return emptyOutput('evidence');
  const src = ctx.raw?.source ?? 'qualification_eval', at = ctx.asOf;

  const coverage = criteria.length ? clamp01(new Set(observations.map((o) => o.criterionId)).size / criteria.length) : 0;
  const freshestAt = observations.reduce((m, o) => (o.observedAt > m ? o.observedAt : m), observations[0].observedAt);
  const freshness = decayFactor(freshestAt, ctx.asOf, 90);
  const distinctSources = new Set(observations.map((o) => o.source ?? src)).size;

  // consistency = 1 − contradiction ratio over reconstructed observation evidence (reuses shared detector).
  const obsEv = observations.map((o, i) => evidenceRef({ id: `qualification:obs:${o.criterionId}:${i}:${o.source ?? src}:${o.observedAt}`, kind: 'observed', label: `obs:${o.criterionId}`, value: o.outcome, source: { system: o.source ?? src }, observedAt: o.observedAt, recordedAt: o.observedAt }));
  const contradictions = detectEvidenceContradictions(obsEv);
  const consistency = clamp01(1 - contradictions.length / Math.max(1, observations.length));

  const ev: EvidenceRef[] = [
    mkEvidence('evidence', { label: 'coverage', value: Number(coverage.toFixed(4)), source: src, observedAt: at, kind: 'inferred' }),
    mkEvidence('evidence', { label: 'sources', value: distinctSources, source: src, observedAt: at, kind: 'inferred' }),
  ];
  const o: QualificationEngineOutput = { ...emptyOutput('evidence'), abstained: false, evidence: ev };
  o.contributions.push({ dimension: 'completeness', contributor: 'evidence', method: 'deterministic', value: coverage, confidence: clamp01(0.4 + 0.1 * Math.min(observations.length, 4)), evidence: ev, asOf: at });
  o.contributions.push({ dimension: 'readiness', contributor: 'evidence', method: 'deterministic', value: clamp01(freshness), confidence: clamp01(0.4 + 0.1 * Math.min(observations.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'evidence_quality', conclusion: Number(consistency.toFixed(4)), because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`coverage=${coverage}, freshness=${clamp01(freshness)}, sources=${distinctSources}, consistency=${consistency}`], unknowns: [] }));
  return o;
}
