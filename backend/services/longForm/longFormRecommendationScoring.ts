/**
 * Phase 4 + 6 — Scoring and drift detection.
 *
 * Scoring is deterministic: takes a candidate (heuristic seed or
 * LLM-refined card) plus the CompanyContextFoundation and returns the
 * five alignment dimensions + the weighted overall strength.
 *
 * Drift detection compares a recommendation against what would be produced
 * with the foundation stripped. High similarity → GENERIC_DRIFT.
 */

import type { CompanyContextFoundation } from './companyContextFoundation';
import { stripCompanyContextFoundation } from './companyContextFoundation';
import {
  type ContentAlignmentMode,
  type DriftDetectionResult,
  type GenericityRiskLevel,
  type LongFormRecommendation,
  type RecommendationScoreBreakdown,
  type TargetBuyerStage,
  ALIGNMENT_MODE_RULES,
  SCORE_PRIORITY_WEIGHTS,
} from './longFormRecommendationTypes';

// ────────────────────────────────────────────────────────────────────────────
// Tokenization
// ────────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'by', 'at', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'as', 'from',
  'that', 'this', 'these', 'those', 'it', 'its', 'into', 'than', 'then', 'so',
  'how', 'what', 'why', 'when', 'where', 'who', 'which',
]);

function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function tokenSetFromFoundation(foundation: CompanyContextFoundation): Set<string> {
  const blobs = [
    foundation.businessIdentity.companyCategory,
    foundation.businessIdentity.positioning,
    ...foundation.businessIdentity.productServiceCategories,
    foundation.businessIdentity.operationalModel,
    foundation.marketUnderstanding.targetMarket,
    ...foundation.marketUnderstanding.icps,
    ...foundation.marketUnderstanding.marketPainPoints,
    ...foundation.marketUnderstanding.operationalFrictionAreas,
    foundation.strategicPov.transformationNarrative,
    foundation.strategicPov.philosophy,
    ...foundation.strategicPov.differentiation,
    ...foundation.strategicPov.preferredApproaches,
    ...foundation.capabilityMapping.enables,
    ...foundation.capabilityMapping.workflowCategories,
    ...foundation.capabilityMapping.executionLayers,
    ...foundation.capabilityMapping.measurableOutcomes,
    ...foundation.terminologyLayer.domainVocabulary,
    ...foundation.terminologyLayer.industryWording,
    ...foundation.terminologyLayer.strategicTerminology,
  ];
  const set = new Set<string>();
  for (const blob of blobs) {
    for (const t of tokenize(blob ?? '')) set.add(t);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((v) => {
    if (b.has(v)) inter += 1;
  });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ────────────────────────────────────────────────────────────────────────────
// Score components (each returns 0–100)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Candidate shape used during scoring — before observability fields are
 * attached. Engine builds this from heuristic seed + LLM refinement.
 */
export interface RecommendationCandidate {
  recommendationTitle: string;
  editorialAngle: string;
  contentAlignmentMode: ContentAlignmentMode;
  targetBuyerStage: TargetBuyerStage;
  strategicNarrative: string;
  whyThisFitsCompany: LongFormRecommendation['whyThisFitsCompany'];
  recommendedContentDirection: LongFormRecommendation['recommendedContentDirection'];
  /** Seed topic the LLM was asked to reframe — used for SEO scoring. */
  seedTopic?: string;
}

function clamp100(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function candidateText(candidate: RecommendationCandidate): string {
  return [
    candidate.recommendationTitle,
    candidate.editorialAngle,
    candidate.strategicNarrative,
    candidate.whyThisFitsCompany.summary,
    candidate.whyThisFitsCompany.icpProblemMapping,
    candidate.whyThisFitsCompany.capabilityConnection,
    candidate.whyThisFitsCompany.businessContextOrigin,
    candidate.recommendedContentDirection.primaryAngle,
    candidate.recommendedContentDirection.operationalProof.join(' '),
    candidate.recommendedContentDirection.avoidPatterns.join(' '),
  ].join(' ');
}

function scoreCompanyAlignment(
  candidate: RecommendationCandidate,
  foundation: CompanyContextFoundation,
): number {
  const cand = new Set(tokenize(candidateText(candidate)));
  const company = tokenSetFromFoundation(foundation);
  const overlapJ = jaccard(cand, company);

  // Capability connection is the strongest signal — give it a direct boost.
  const capabilityHit = foundation.capabilityMapping.workflowCategories.some((cat) =>
    candidate.whyThisFitsCompany.capabilityConnection.toLowerCase().includes(cat.toLowerCase()),
  ) || foundation.capabilityMapping.enables.some((cap) =>
    candidate.whyThisFitsCompany.capabilityConnection.toLowerCase().includes(cap.toLowerCase()),
  );
  const positioningHit = foundation.businessIdentity.positioning
    ? tokenize(foundation.businessIdentity.positioning).some((t) =>
        candidateText(candidate).toLowerCase().includes(t),
      )
    : false;

  return clamp100(overlapJ * 100 * 1.6 + (capabilityHit ? 18 : 0) + (positioningHit ? 12 : 0));
}

function scoreCommercialRelevance(
  candidate: RecommendationCandidate,
  foundation: CompanyContextFoundation,
): number {
  const stageWeights: Record<TargetBuyerStage, number> = {
    awareness: 55,
    consideration: 70,
    evaluation: 85,
    decision: 90,
    expansion: 75,
  };
  const base = stageWeights[candidate.targetBuyerStage] ?? 50;

  const maturityMatch =
    foundation.marketUnderstanding.buyerMaturity === 'unknown'
      ? 0
      : (foundation.marketUnderstanding.buyerMaturity === 'early' && candidate.targetBuyerStage === 'awareness') ||
        (foundation.marketUnderstanding.buyerMaturity === 'evaluation' &&
          (candidate.targetBuyerStage === 'consideration' || candidate.targetBuyerStage === 'evaluation')) ||
        (foundation.marketUnderstanding.buyerMaturity === 'committed' &&
          (candidate.targetBuyerStage === 'decision' || candidate.targetBuyerStage === 'expansion')) ||
        foundation.marketUnderstanding.buyerMaturity === 'mixed'
      ? 10
      : -5;

  const icpHit = foundation.marketUnderstanding.icps.some((icp) =>
    candidate.whyThisFitsCompany.icpProblemMapping.toLowerCase().includes(icp.toLowerCase()),
  )
    ? 12
    : 0;

  return clamp100(base + maturityMatch + icpHit);
}

function scoreAuthorityBuilding(
  candidate: RecommendationCandidate,
  foundation: CompanyContextFoundation,
): number {
  const diffHits = foundation.strategicPov.differentiation.filter((diff) =>
    candidateText(candidate).toLowerCase().includes(diff.toLowerCase()),
  ).length;
  const philosophyHit = foundation.strategicPov.philosophy
    && candidateText(candidate).toLowerCase().includes(foundation.strategicPov.philosophy.toLowerCase());

  const angleSpecificity = candidate.editorialAngle.length >= 80 ? 25 : candidate.editorialAngle.length >= 40 ? 12 : 0;
  const narrativeStrength = candidate.strategicNarrative.length >= 120 ? 25 : candidate.strategicNarrative.length >= 60 ? 14 : 0;

  return clamp100(35 + diffHits * 8 + (philosophyHit ? 10 : 0) + angleSpecificity + narrativeStrength);
}

function scoreOperationalDepth(
  candidate: RecommendationCandidate,
  foundation: CompanyContextFoundation,
): number {
  const proofCount = candidate.recommendedContentDirection.operationalProof.length;
  const proofRichness = candidate.recommendedContentDirection.operationalProof
    .reduce((sum, p) => sum + Math.min(40, p.length), 0);

  const workflowHits = foundation.capabilityMapping.workflowCategories.filter((wf) =>
    candidate.recommendedContentDirection.primaryAngle.toLowerCase().includes(wf.toLowerCase()) ||
    candidate.recommendedContentDirection.operationalProof.some((p) =>
      p.toLowerCase().includes(wf.toLowerCase()),
    ),
  ).length;

  const frictionHits = foundation.marketUnderstanding.operationalFrictionAreas.filter((f) =>
    candidateText(candidate).toLowerCase().includes(f.toLowerCase()),
  ).length;

  return clamp100(20 + proofCount * 10 + proofRichness * 0.3 + workflowHits * 8 + frictionHits * 6);
}

function scoreSeoOpportunity(candidate: RecommendationCandidate): number {
  // Heuristic — without live search-volume data we infer from title shape.
  // Penalize "ultimate guide", "everything you need", generic phrasings; reward
  // specific question/comparison/how-to framings.
  const title = candidate.recommendationTitle.toLowerCase();
  const genericPenalty =
    /(ultimate guide|everything you need|complete guide|the only \w+ guide|all about)/i.test(title) ? -25 : 0;
  const intentBoost =
    /(how to|what is|why|when to|vs\.|comparison|framework|playbook|checklist)/i.test(title) ? 18 : 0;
  const lengthFit = title.length >= 30 && title.length <= 70 ? 12 : 0;
  const seedMatch = candidate.seedTopic && title.includes(candidate.seedTopic.toLowerCase()) ? 10 : 0;
  return clamp100(45 + intentBoost + lengthFit + seedMatch + genericPenalty);
}

// ────────────────────────────────────────────────────────────────────────────
// Public scoring API
// ────────────────────────────────────────────────────────────────────────────

export function scoreRecommendationCandidate(
  candidate: RecommendationCandidate,
  foundation: CompanyContextFoundation,
): RecommendationScoreBreakdown {
  const companyAlignmentScore = scoreCompanyAlignment(candidate, foundation);
  const commercialRelevanceScore = scoreCommercialRelevance(candidate, foundation);
  const authorityBuildingScore = scoreAuthorityBuilding(candidate, foundation);
  const operationalDepthScore = scoreOperationalDepth(candidate, foundation);
  const seoOpportunityScore = scoreSeoOpportunity(candidate);

  // Apply mode weight to companyAlignment, then compute weighted overall.
  const modeRule = ALIGNMENT_MODE_RULES[candidate.contentAlignmentMode];
  const companyAlignmentWeighted = companyAlignmentScore * modeRule.companyWeight;

  const overallRecommendationStrength = clamp100(
    companyAlignmentWeighted * SCORE_PRIORITY_WEIGHTS.companyAlignmentScore +
      authorityBuildingScore * SCORE_PRIORITY_WEIGHTS.authorityBuildingScore +
      commercialRelevanceScore * SCORE_PRIORITY_WEIGHTS.commercialRelevanceScore +
      operationalDepthScore * SCORE_PRIORITY_WEIGHTS.operationalDepthScore +
      seoOpportunityScore * SCORE_PRIORITY_WEIGHTS.seoOpportunityScore,
  );

  return {
    companyAlignmentScore,
    commercialRelevanceScore,
    authorityBuildingScore,
    operationalDepthScore,
    seoOpportunityScore,
    overallRecommendationStrength,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 6 — Drift detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Drift detection: re-score the same candidate against a stripped foundation
 * (no company signals). If companyAlignment + capability/ICP hits do not
 * meaningfully collapse, the candidate could belong to any random SaaS — that
 * is GENERIC_DRIFT.
 *
 * No second LLM call. The "stripped regeneration" is simulated by re-scoring:
 * a truly company-specific candidate will lose most of its companyAlignment
 * boost when the foundation has nothing to match against.
 */
export function detectGenericDrift(
  candidate: RecommendationCandidate,
  foundation: CompanyContextFoundation,
  scoredWithFoundation: RecommendationScoreBreakdown,
): DriftDetectionResult {
  const strippedFoundation = stripCompanyContextFoundation(foundation);
  const strippedScores = scoreRecommendationCandidate(candidate, strippedFoundation);

  // Token overlap between candidate text and the live foundation. Low overlap
  // means the candidate text doesn't echo any company-specific vocabulary
  // even before scoring — strong drift signal.
  const candTokens = new Set(tokenize(candidateText(candidate)));
  const foundationTokens = tokenSetFromFoundation(foundation);
  const overlapJ = jaccard(candTokens, foundationTokens);

  const companyAlignmentDelta = scoredWithFoundation.companyAlignmentScore - strippedScores.companyAlignmentScore;
  const overallDelta = scoredWithFoundation.overallRecommendationStrength - strippedScores.overallRecommendationStrength;

  // Text similarity to "stripped" output approximated as 1 - overlap with foundation.
  const textSimilarityToStripped = Number((1 - overlapJ).toFixed(3));

  let riskLevel: GenericityRiskLevel;
  let isGenericDrift: boolean;
  let reason: string;

  if (companyAlignmentDelta < 8 && overallDelta < 5) {
    riskLevel = 'high';
    isGenericDrift = true;
    reason = `Stripping company foundation barely changed scores (Δalignment=${companyAlignmentDelta.toFixed(1)}, Δoverall=${overallDelta.toFixed(1)}). Recommendation could apply to any SaaS.`;
  } else if (companyAlignmentDelta < 18 || overlapJ < 0.05) {
    riskLevel = 'medium';
    isGenericDrift = false;
    reason = `Moderate company-context influence (Δalignment=${companyAlignmentDelta.toFixed(1)}, token overlap=${overlapJ.toFixed(2)}).`;
  } else {
    riskLevel = 'low';
    isGenericDrift = false;
    reason = `Company foundation has strong influence (Δalignment=${companyAlignmentDelta.toFixed(1)}, token overlap=${overlapJ.toFixed(2)}).`;
  }

  return { riskLevel, textSimilarityToStripped, isGenericDrift, reason };
}

/**
 * Combined utility used by the engine: score, drift-detect, attach to a
 * candidate, return the finalized LongFormRecommendation.
 */
export function finalizeCandidate(
  candidate: RecommendationCandidate,
  foundation: CompanyContextFoundation,
  partial: Omit<
    LongFormRecommendation,
    | 'companyAlignmentScore'
    | 'commercialRelevanceScore'
    | 'authorityBuildingScore'
    | 'operationalDepthScore'
    | 'seoOpportunityScore'
    | 'overallRecommendationStrength'
    | 'genericityRiskLevel'
  >,
): { recommendation: LongFormRecommendation; drift: DriftDetectionResult; scores: RecommendationScoreBreakdown } {
  const scores = scoreRecommendationCandidate(candidate, foundation);
  const drift = detectGenericDrift(candidate, foundation, scores);
  const recommendation: LongFormRecommendation = {
    ...partial,
    ...scores,
    genericityRiskLevel: drift.riskLevel,
  };
  return { recommendation, drift, scores };
}
