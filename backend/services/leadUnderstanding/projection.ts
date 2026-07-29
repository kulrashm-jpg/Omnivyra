/**
 * LI-B105 — Canonical Lead Understanding builder (SINGLE semantic owner) + derived projection.
 *
 * `buildLeadUnderstanding` is the ONE producer of a `LeadUnderstanding` — it combines the unified
 * score, detects contradictions, and assembles the 12 facets. `projectLead` is a pure derived
 * RESHAPE for consumers — it reads decided values and NEVER recomputes a semantic. Deterministic:
 * `builtAt`/`projectedAt` are passed in (never Date.now).
 */

import type {
  LeadUnderstanding, LeadProjection, LeadFacets, LeadFacetName, LeadIdentityKey,
  ScoreContribution, ReasoningTrace, EvidenceRef, ContradictionRef, LeadGraph,
  ScoreDimension, EvidenceSummaryValue, IdentityValue,
} from './types';
import { LEAD_FACET_NAMES, SCORE_DIMENSIONS } from './types';
import { nullFacet, facet } from './facets';
import { combineScores, type ScoringConfig } from './scoring';
import { detectEvidenceContradictions, detectScoreContradictions } from './contradiction';
import { countByKind, normalizeEvidence } from './evidence';

export const LEAD_MODEL_VERSION = 1;

export interface BuildInput {
  key: LeadIdentityKey;
  builtAt: string;                              // deterministic timestamp (passed in)
  facets?: Partial<LeadFacets>;                 // caller-supplied decided facets (Phase C engines)
  evidence?: EvidenceRef[];                     // full evidence pool (for summary + contradictions)
  contributions?: ScoreContribution[];          // score contributors
  reasoning?: ReasoningTrace[];
  graph?: LeadGraph;
  scoringConfig?: ScoringConfig;
  version?: number;
}

function emptyFacets(): LeadFacets {
  const f = {} as LeadFacets;
  for (const name of LEAD_FACET_NAMES) (f as any)[name] = nullFacet();
  return f;
}

/** THE single producer of LeadUnderstanding. */
export function buildLeadUnderstanding(input: BuildInput): LeadUnderstanding {
  const evidence = normalizeEvidence(input.evidence ?? []);
  const contributions = input.contributions ?? [];

  const facets: LeadFacets = { ...emptyFacets(), ...(input.facets ?? {}) };

  // Derived evidenceSummary facet (owned here, from the pool).
  if (evidence.length) {
    const summary: EvidenceSummaryValue = { totalEvidence: evidence.length, byKind: countByKind(evidence), freshestAt: evidence[0]?.observedAt };
    facets.evidenceSummary = facet(summary, evidence);
  }

  const score = combineScores(contributions, input.scoringConfig);
  const contradictions = [...detectEvidenceContradictions(evidence), ...detectScoreContradictions(contributions)]
    .sort((a, b) => a.id.localeCompare(b.id));

  const graph: LeadGraph = input.graph ?? { root: { type: 'lead', id: input.key.leadKey }, edges: [] };

  return {
    key: input.key,
    facets,
    score,
    reasoning: input.reasoning ?? [],
    contradictions,
    graph,
    version: input.version ?? LEAD_MODEL_VERSION,
    builtAt: input.builtAt,
  };
}

/** Derived, consumer-facing reshape. Reads decided values only — never recomputes. */
export function projectLead(u: LeadUnderstanding, projectedAt: string): LeadProjection {
  const scores = {} as Record<ScoreDimension, number | null>;
  for (const d of SCORE_DIMENSIONS) scores[d] = u.score.dimensions[d].value;

  const facetConfidence = {} as Record<LeadFacetName, number>;
  for (const name of LEAD_FACET_NAMES) facetConfidence[name] = u.facets[name].confidence;

  const topContradictions = [...u.contradictions]
    .sort((a, b) => Number(a.resolved) - Number(b.resolved)) // unresolved first
    .slice(0, 5);

  return {
    key: u.key,
    version: u.version,
    identity: u.facets.identity.value as IdentityValue | null,
    scores,
    overallScore: u.score.overall,
    confidence: u.score.confidence,
    facetConfidence,
    topContradictions,
    projectedAt,
  };
}
