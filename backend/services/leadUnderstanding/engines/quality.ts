/**
 * LI-C211 — Lead Intelligence Quality Framework (pure). Scorecards over a canonical Understanding:
 * completeness, evidence coverage, freshness, contradiction rate, confidence calibration, abstention
 * rate, unsupported conclusions, provenance coverage, reasoning integrity. Deterministic; measures,
 * does not mutate.
 */

import type { LeadUnderstanding, ScoreDimension } from '../types';
import { LEAD_FACET_NAMES, SCORE_DIMENSIONS } from '../types';
import { validateReasoning } from '../reasoning';

export interface QualityScorecard {
  completeness: number;          // non-null facets / 12
  evidenceCoverage: number;      // non-null facets that cite evidence / non-null facets
  provenanceCoverage: number;    // non-null facets with provenance / non-null facets
  freshnessDays: number | null;  // age of freshest facet vs builtAt
  contradictionRate: number;     // contradictions / evidence items
  unresolvedContradictions: number;
  confidenceCalibration: number; // mean confidence of non-abstained dimensions
  abstentionRate: number;        // abstained dimensions / total
  unsupportedConclusions: number;// reasoning traces failing validation (ungrounded)
  reasoningIntegrity: number;    // valid traces / total traces
  scoredDimensions: number;
}

export function assessQuality(u: LeadUnderstanding): QualityScorecard {
  const nonNull = LEAD_FACET_NAMES.filter((n) => u.facets[n].value !== null);
  const withEvidence = nonNull.filter((n) => u.facets[n].evidence.length > 0);
  const withProvenance = nonNull.filter((n) => u.facets[n].provenance.length > 0);

  const allEvidence = new Set(Object.values(u.facets).flatMap((f) => f.evidence.map((e) => e.id))).size;
  const scoredDims = SCORE_DIMENSIONS.filter((d: ScoreDimension) => !u.score.dimensions[d].abstained);
  const calib = scoredDims.length ? Number((scoredDims.reduce((a, d) => a + u.score.dimensions[d].confidence, 0) / scoredDims.length).toFixed(4)) : 0;

  const freshestAsOf = nonNull.map((n) => u.facets[n].asOf).filter(Boolean).sort().pop() ?? null;
  const freshnessDays = freshestAsOf ? Number(((Date.parse(u.builtAt) - Date.parse(freshestAsOf)) / 86_400_000).toFixed(2)) : null;

  const invalid = u.reasoning.filter((t) => !validateReasoning(t).valid).length;

  return {
    completeness: Number((nonNull.length / LEAD_FACET_NAMES.length).toFixed(4)),
    evidenceCoverage: nonNull.length ? Number((withEvidence.length / nonNull.length).toFixed(4)) : 0,
    provenanceCoverage: nonNull.length ? Number((withProvenance.length / nonNull.length).toFixed(4)) : 0,
    freshnessDays,
    contradictionRate: allEvidence ? Number((u.contradictions.length / allEvidence).toFixed(4)) : 0,
    unresolvedContradictions: u.contradictions.filter((c) => !c.resolved).length,
    confidenceCalibration: calib,
    abstentionRate: Number(((SCORE_DIMENSIONS.length - scoredDims.length) / SCORE_DIMENSIONS.length).toFixed(4)),
    unsupportedConclusions: invalid,
    reasoningIntegrity: u.reasoning.length ? Number(((u.reasoning.length - invalid) / u.reasoning.length).toFixed(4)) : 1,
    scoredDimensions: scoredDims.length,
  };
}
