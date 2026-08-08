/**
 * Canonical Contact Understanding builder — THE single owner (mirrors the Program 1/2/3/5/6/7/8
 * builders). Deterministic (`builtAt` passed in). Reuses the shared facet/scoring/contradiction/graph
 * primitives — no forked logic. Projects only from what it is given; never fabricates a facet.
 *
 * The interpretation that produces facets (resolving a platform person from evidence) belongs upstream
 * in a producer, not here — exactly as `intentFromEvidence` sits upstream of `buildIntentUnderstanding`.
 * Phase 1 ships the canonical layer only, so no producer is wired.
 */

import type { ContactUnderstanding, ContactFacets, ContactIdentityKey, ContactContribution, EvidenceRef, ContactEvidenceSummaryValue } from './types';
import { CONTACT_FACET_NAMES, CONTACT_SCORE_DIMENSIONS } from './types';
import { facet, nullFacet, normalizeEvidence, detectEvidenceContradictions, node, buildEntityGraph, combineScoresFor } from '../intelligence/canonical';
import type { ReasoningTrace, GraphEdge } from '../intelligence/canonical';

export const CONTACT_MODEL_VERSION = 1;

export interface BuildContactInput {
  key: ContactIdentityKey;
  builtAt: string;
  facets?: Partial<ContactFacets>;
  evidence?: EvidenceRef[];
  contributions?: ContactContribution[];
  reasoning?: ReasoningTrace[];
  edges?: GraphEdge[];
}

function emptyFacets(): ContactFacets {
  const f = {} as ContactFacets;
  for (const name of CONTACT_FACET_NAMES) (f as any)[name] = nullFacet();
  return f;
}

/** THE single producer of ContactUnderstanding. */
export function buildContactUnderstanding(input: BuildContactInput): ContactUnderstanding {
  const evidence = normalizeEvidence(input.evidence ?? []);
  const contributions = input.contributions ?? [];
  const facets: ContactFacets = { ...emptyFacets(), ...(input.facets ?? {}) };

  if (evidence.length) {
    // `distinctSources` is counted rather than assumed: two facts from one platform are corroboration
    // of a single observer, which is a weaker claim than the same two facts from two observers.
    const summary: ContactEvidenceSummaryValue = {
      totalEvidence: evidence.length,
      freshestAt: evidence[0]?.observedAt,
      distinctSources: new Set(evidence.map((e) => e.source.system)).size,
    };
    facets.evidenceSummary = facet(summary, evidence);
  }

  const score = combineScoresFor(CONTACT_SCORE_DIMENSIONS, contributions);
  const contradictions = detectEvidenceContradictions(evidence).sort((a, b) => a.id.localeCompare(b.id));
  // Contact owns exactly one node — its own. Everything else it touches is a reference.
  const graph = buildEntityGraph(node('contact', input.key.contactId), input.edges ?? []);

  return {
    key: input.key,
    facets,
    score,
    reasoning: input.reasoning ?? [],
    contradictions,
    graph,
    version: CONTACT_MODEL_VERSION,
    builtAt: input.builtAt,
  };
}
