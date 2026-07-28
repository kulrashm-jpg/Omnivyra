/**
 * Canonical Company Understanding builder — THE single owner (mirrors Program 1's `buildLead
 * Understanding`; adopts the ontology `buildCompanyUnderstanding` principle: PROJECT from the
 * already-derived profile, never fabricate). Deterministic (`builtAt` passed in). Reuses the shared
 * scoring + contradiction primitives — no forked logic.
 */

import type {
  CompanyUnderstanding, CompanyFacets, CompanyIdentityKey, CompanyContribution, CompanyWorldView,
  EvidenceRef, EvidenceSummaryValue,
} from './types';
import { COMPANY_FACET_NAMES, COMPANY_SCORE_DIMENSIONS } from './types';
import { facet, nullFacet, normalizeEvidence, countByKind, detectEvidenceContradictions, node, buildEntityGraph, combineScoresFor } from '../intelligence/canonical';
import type { ReasoningTrace, GraphEdge } from '../intelligence/canonical';

export const COMPANY_MODEL_VERSION = 1;

export interface BuildCompanyInput {
  key: CompanyIdentityKey;
  builtAt: string;
  facets?: Partial<CompanyFacets>;
  evidence?: EvidenceRef[];
  contributions?: CompanyContribution[];
  reasoning?: ReasoningTrace[];
  edges?: GraphEdge[];
  worldView?: CompanyWorldView;
}

function emptyFacets(): CompanyFacets {
  const f = {} as CompanyFacets;
  for (const name of COMPANY_FACET_NAMES) (f as any)[name] = nullFacet();
  return f;
}

/** THE single producer of CompanyUnderstanding. */
export function buildCompanyUnderstanding(input: BuildCompanyInput): CompanyUnderstanding {
  const evidence = normalizeEvidence(input.evidence ?? []);
  const contributions = input.contributions ?? [];
  const facets: CompanyFacets = { ...emptyFacets(), ...(input.facets ?? {}) };

  // Owner-derived worldView + evidenceSummary facets.
  if (input.worldView && Object.values(input.worldView).some(Boolean) && evidence.length) {
    facets.worldView = facet(input.worldView, evidence);
  }
  if (evidence.length) {
    const summary: EvidenceSummaryValue = { totalEvidence: evidence.length, freshestAt: evidence[0]?.observedAt };
    facets.evidenceSummary = facet(summary, evidence);
  }

  const score = combineScoresFor(COMPANY_SCORE_DIMENSIONS, contributions);
  const contradictions = detectEvidenceContradictions(evidence).sort((a, b) => a.id.localeCompare(b.id));
  const graph = buildEntityGraph(node('company', input.key.companyId), input.edges ?? []);

  return {
    key: input.key,
    facets,
    score,
    reasoning: input.reasoning ?? [],
    contradictions,
    graph,
    version: COMPANY_MODEL_VERSION,
    builtAt: input.builtAt,
  };
}
