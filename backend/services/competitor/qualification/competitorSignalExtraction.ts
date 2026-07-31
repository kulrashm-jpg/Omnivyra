/**
 * COMPETITOR-TAXONOMY-P1 — Multi-signal qualification: pure signal extraction.
 *
 * Extracts the seven qualification signals the multi-signal model consumes, each a
 * deterministic value in [0, 1] plus a `coverage` in [0, 1] describing how much
 * evidence backs the signal (0 ⇒ abstain / no basis). Everything here is PURE and
 * OFFLINE (no I/O, no network, no embeddings) so it is safe to run in shadow on every
 * request and produces byte-stable results for calibration.
 *
 * Reuse-first: this module composes existing, exported platform primitives rather than
 * introducing new similarity math —
 *   • competitorEngineServiceModel: tokenizeCompetitorText, overlapRatio, roundDimension,
 *     inferSegment, candidateSignalText, buildCompanyCapabilityVector,
 *     buildCandidateCapabilityVector, capabilityVectorOverlap, normalizeCompetitorDomain
 *   • competitorEngineServiceEngineDiscovery: contextTokens (the market/product/target/
 *     geography/intent token grouping the live scorer already derives)
 *   • competitorTaxonomy: normalizeCompetitorCategory, categoryAffinity, classifyCategoryCoverage
 *   • signalClusterEngine: topicSimilarityScore (Jaccard) — for symmetric text similarity
 *   • themeDiversityGuard: computeTextSimilarity (Jaccard over raw strings)
 */

import {
  tokenizeCompetitorText,
  overlapRatio,
  roundDimension,
  inferSegment,
  candidateSignalText,
  buildCompanyCapabilityVector,
  buildCandidateCapabilityVector,
  capabilityVectorOverlap,
  normalizeCompetitorDomain,
  type CompanyCompetitiveContext,
  type CompetitorCandidate,
  type CompetitorSource,
} from '../../competitorEngineServiceModel';
import { contextTokens } from '../../competitorEngineServiceEngineDiscovery';
import {
  normalizeCompetitorCategory,
  categoryAffinity,
  classifyCategoryCoverage,
  type CategoryCoverage,
  type CategoryAffinity,
} from '../../competitorTaxonomy';
import { topicSimilarityScore } from '../../signalClusterEngine';
import { computeTextSimilarity } from '../../../utils/themeDiversityGuard';

/** The seven signals of the multi-signal qualification model. */
export type QualificationSignalKey =
  | 'semanticSimilarity'
  | 'productOverlap'
  | 'icpOverlap'
  | 'marketOverlap'
  | 'businessModelSimilarity'
  | 'serpEvidence'
  | 'taxonomyPrior';

export interface QualificationSignal {
  key: QualificationSignalKey;
  /** Evidence-derived strength in [0, 1]. */
  value: number;
  /** How much evidence backs this signal in [0, 1]; 0 ⇒ the signal abstains. */
  coverage: number;
  /** Human-readable, deterministic rationale for explainability. */
  explanation: string;
}

export interface ExtractedSignals {
  signals: Record<QualificationSignalKey, QualificationSignal>;
  taxonomyCoverage: CategoryCoverage;
  companyCategory: string;
  competitorCategory: string;
  affinity: CategoryAffinity;
}

// ── Company text surface (deterministic) ────────────────────────────────────
function companyText(context: CompanyCompetitiveContext): string {
  return [
    context.marketFocus,
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
    context.geography,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Semantic similarity — the P1 net-new signal. A deterministic, offline blend of three
 * complementary lenses so no single lexical artefact dominates:
 *   • symmetric token Jaccard over the full text surfaces (topicSimilarityScore)
 *   • raw-string Jaccard (computeTextSimilarity) — a second, independently-tokenized view
 *   • capability-vector soft-overlap (regex capability vocabulary) — concept-level, not word-level
 * Cosine-over-embeddings is deliberately avoided (network + cost + non-determinism); the
 * seam is left open for an embedding upgrade behind the same signal without touching callers.
 */
function extractSemanticSimilarity(
  context: CompanyCompetitiveContext,
  candidate: CompetitorCandidate,
  domain: string | null,
): QualificationSignal {
  const cText = companyText(context);
  const kText = candidateSignalText(candidate, domain);
  const jaccardTokens = topicSimilarityScore(cText, kText);
  const jaccardRaw = computeTextSimilarity(cText, kText);
  const capabilityOverlap = capabilityVectorOverlap(
    buildCompanyCapabilityVector(context),
    buildCandidateCapabilityVector(candidate),
  );
  const value = roundDimension(jaccardTokens * 0.4 + jaccardRaw * 0.25 + capabilityOverlap * 0.35);
  const coverage = cText.trim() && kText.trim() ? 1 : 0;
  return {
    key: 'semanticSimilarity',
    value,
    coverage,
    explanation: `semantic similarity ${value} (token Jaccard ${roundDimension(jaccardTokens)}, string Jaccard ${roundDimension(
      jaccardRaw,
    )}, capability overlap ${roundDimension(capabilityOverlap)})`,
  };
}

function extractProductOverlap(
  context: CompanyCompetitiveContext,
  candidateTokens: string[],
): QualificationSignal {
  const tokens = contextTokens(context);
  const value = roundDimension(overlapRatio(candidateTokens, tokens.product));
  return {
    key: 'productOverlap',
    value,
    coverage: tokens.product.length > 0 && candidateTokens.length > 0 ? 1 : 0,
    explanation: `product/offering overlap ${value} against ${tokens.product.length} company product tokens`,
  };
}

function extractIcpOverlap(
  context: CompanyCompetitiveContext,
  candidateTokens: string[],
): QualificationSignal {
  const tokens = contextTokens(context);
  const targetOverlap = overlapRatio(candidateTokens, tokens.target);
  const intentOverlap = overlapRatio(candidateTokens, tokens.intent);
  const value = roundDimension(targetOverlap * 0.7 + intentOverlap * 0.3);
  const coverage = (tokens.target.length > 0 || tokens.intent.length > 0) && candidateTokens.length > 0 ? 1 : 0;
  return {
    key: 'icpOverlap',
    value,
    coverage,
    explanation: `ICP overlap ${value} (target ${roundDimension(targetOverlap)}, intent ${roundDimension(intentOverlap)})`,
  };
}

function extractMarketOverlap(
  context: CompanyCompetitiveContext,
  candidateTokens: string[],
): QualificationSignal {
  const tokens = contextTokens(context);
  const marketOverlap = overlapRatio(candidateTokens, tokens.market);
  // Geography abstains rather than fabricating a match when the company states none.
  const hasGeography = tokens.geography.length > 0;
  const geographyOverlap = hasGeography ? overlapRatio(candidateTokens, tokens.geography) : 0;
  const value = hasGeography
    ? roundDimension(marketOverlap * 0.7 + geographyOverlap * 0.3)
    : roundDimension(marketOverlap);
  const coverage = tokens.market.length > 0 && candidateTokens.length > 0 ? 1 : 0;
  return {
    key: 'marketOverlap',
    value,
    coverage,
    explanation: `market overlap ${value} (market ${roundDimension(marketOverlap)}${
      hasGeography ? `, geography ${roundDimension(geographyOverlap)}` : ', geography abstained'
    })`,
  };
}

function extractBusinessModelSimilarity(
  context: CompanyCompetitiveContext,
  candidate: CompetitorCandidate,
): QualificationSignal {
  const companySegment = inferSegment(
    [context.targetCustomer, context.businessModel, context.marketFocus].filter(Boolean).join(' '),
  );
  const competitorSegment = inferSegment(
    [candidate.targetCustomer, candidate.businessModel, candidate.description, candidate.enrichment?.business_model]
      .filter(Boolean)
      .join(' '),
  );
  const bmText = computeTextSimilarity(
    [context.businessModel, context.marketFocus].filter(Boolean).join(' '),
    [candidate.businessModel, candidate.enrichment?.business_model, candidate.category].filter(Boolean).join(' '),
  );
  let value: number;
  if (companySegment && competitorSegment) {
    value = roundDimension((companySegment === competitorSegment ? 1 : 0.25) * 0.6 + bmText * 0.4);
  } else {
    value = roundDimension(bmText);
  }
  const coverage = companySegment && competitorSegment ? 1 : bmText > 0 ? 0.5 : 0;
  return {
    key: 'businessModelSimilarity',
    value,
    coverage,
    explanation: `business-model similarity ${value} (company segment ${companySegment ?? 'unknown'}, competitor segment ${
      competitorSegment ?? 'unknown'
    })`,
  };
}

const SERP_EVIDENCE_WEIGHT: Partial<Record<CompetitorSource, number>> = {
  user: 1,
  manual: 1,
  website: 0.85,
  social: 0.7,
  serp_live: 0.8,
  known_category_dataset: 0.65,
  market_substitute: 0.5,
  profile_ai: 0.3,
};

/**
 * SERP / provenance evidence — how strongly the candidate is externally attested. Reuses
 * the source taxonomy the live scorer already trusts; higher for live-SERP / user / website
 * discovery, lower for model-guessed candidates.
 */
function extractSerpEvidence(candidate: CompetitorCandidate): QualificationSignal {
  const base = SERP_EVIDENCE_WEIGHT[candidate.source] ?? 0.2;
  const hasSerp = (candidate.discoverySources ?? []).some((s) => String(s).toLowerCase().includes('serp'));
  const confidence = Number(candidate.confidenceScore ?? candidate.enrichment?.confidence_score ?? 0);
  const value = roundDimension(Math.max(base, hasSerp ? 0.8 : 0) * 0.75 + Math.min(1, Math.max(0, confidence)) * 0.25);
  return {
    key: 'serpEvidence',
    value,
    coverage: 1,
    explanation: `provenance evidence ${value} (source ${candidate.source}${hasSerp ? ', SERP-attested' : ''}, enrichment confidence ${roundDimension(
      confidence,
    )})`,
  };
}

/**
 * Taxonomy as a BOUNDED PRIOR — the P2 demotion. Taxonomy affinity contributes a small
 * directional prior (same > functional > substitute) but NEVER vetoes and NEVER dominates.
 * When the company's category is out of taxonomy coverage (an unseen industry), `coverage`
 * is 0 so the model down-weights the prior to nothing and decides on evidence alone —
 * removing the taxonomy-coverage dependency for unseen industries.
 */
function extractTaxonomyPrior(
  companyCategory: string,
  competitorCategory: string,
  affinity: CategoryAffinity,
  coverage: CategoryCoverage,
): QualificationSignal {
  const value = affinity === 'same' ? 0.9 : affinity === 'functional' ? 0.65 : 0.3;
  return {
    key: 'taxonomyPrior',
    value,
    coverage: coverage === 'in_coverage' ? 1 : 0,
    explanation: `taxonomy prior ${value} (${companyCategory} vs ${competitorCategory} ⇒ ${affinity}; coverage ${coverage})`,
  };
}

/**
 * Extract all seven signals for one candidate against the company context. Pure &
 * deterministic. Taxonomy coverage is measured on the COMPANY identity (the thing that
 * determines whether the taxonomy has any basis for this business at all).
 */
export function extractQualificationSignals(
  candidate: CompetitorCandidate,
  context: CompanyCompetitiveContext,
): ExtractedSignals {
  const domain = normalizeCompetitorDomain(candidate.domain ?? candidate.name);
  const candidateTokens = tokenizeCompetitorText(candidateSignalText(candidate, domain));

  const cText = companyText(context);
  const companyCategory = normalizeCompetitorCategory(context.marketFocus, cText);
  const competitorCategory = normalizeCompetitorCategory(candidate.category, candidateSignalText(candidate, domain));
  const affinity = categoryAffinity(companyCategory, competitorCategory);
  const taxonomyCoverage = classifyCategoryCoverage(context.marketFocus, cText);

  return {
    signals: {
      semanticSimilarity: extractSemanticSimilarity(context, candidate, domain),
      productOverlap: extractProductOverlap(context, candidateTokens),
      icpOverlap: extractIcpOverlap(context, candidateTokens),
      marketOverlap: extractMarketOverlap(context, candidateTokens),
      businessModelSimilarity: extractBusinessModelSimilarity(context, candidate),
      serpEvidence: extractSerpEvidence(candidate),
      taxonomyPrior: extractTaxonomyPrior(companyCategory, competitorCategory, affinity, taxonomyCoverage),
    },
    taxonomyCoverage,
    companyCategory,
    competitorCategory,
    affinity,
  };
}
