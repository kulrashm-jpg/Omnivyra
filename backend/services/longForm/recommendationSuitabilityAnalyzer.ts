/**
 * Phase 5 — Recommendation suitability analyzer.
 *
 * Not every recommendation is good for every purpose. A high-SEO topic with
 * weak authority signal is fine for discoverability but a poor authority play.
 * A deep operational case study is fantastic for credibility but bad for TOFU.
 *
 * For each recommendation we compute a fit score (0–100) per long-form
 * primary use and derive:
 *   • recommendedPrimaryUse  — the highest-fit use
 *   • recommendedSecondaryUses — other uses with fit ≥ SECONDARY_THRESHOLD
 *   • unsuitableFor — uses with fit < UNSUITABLE_THRESHOLD
 *   • primaryUseRationale — one-sentence explanation
 *
 * Deterministic, no LLM.
 */

import type {
  LongFormPrimaryUse,
  LongFormRecommendation,
  RecommendationSuitability,
} from './longFormRecommendationTypes';
import { LONG_FORM_PRIMARY_USES } from './longFormRecommendationTypes';

const SECONDARY_THRESHOLD = 65;
const UNSUITABLE_THRESHOLD = 35;

interface FitInputs {
  alignment: number;
  authority: number;
  commercial: number;
  operational: number;
  seo: number;
  novelty: number;
  shapeUniqueness: number;
  archetype: LongFormRecommendation['narrativeArchetype'];
  shape: LongFormRecommendation['narrativeShape'];
  contentType: LongFormRecommendation['recommendedContentType'];
  stage: LongFormRecommendation['targetBuyerStage'];
  driftRisk: LongFormRecommendation['genericityRiskLevel'];
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ────────────────────────────────────────────────────────────────────────────
// Per-use fit functions
// ────────────────────────────────────────────────────────────────────────────

function fitLongFormEducational(i: FitInputs): number {
  // Strong for: high operational + commercial; content types that explain
  // (guide, blog, newsletter). Stage-agnostic but TOFU helps.
  const typeBonus = i.contentType === 'guide' ? 14 : i.contentType === 'blog' || i.contentType === 'newsletter' ? 8 : 0;
  const stageBonus = i.stage === 'awareness' || i.stage === 'consideration' ? 8 : 0;
  return clamp100(i.operational * 0.40 + i.alignment * 0.20 + i.authority * 0.20 + i.commercial * 0.10 + typeBonus + stageBonus);
}

function fitAuthorityBuilding(i: FitInputs): number {
  const typeBonus = i.contentType === 'whitepaper' || i.contentType === 'article' ? 14 : i.contentType === 'guide' ? 8 : 0;
  const archetypeBonus =
    i.archetype === 'authority_positioning' ? 12
    : i.archetype === 'category_definition' || i.archetype === 'transformation_path' ? 8
    : 0;
  const shapePenalty = i.shape === 'ultimate_guide' || i.shape === 'best_practices' ? -10 : 0;
  return clamp100(i.authority * 0.40 + i.alignment * 0.25 + i.novelty * 0.15 + i.shapeUniqueness * 0.10 + typeBonus + archetypeBonus + shapePenalty);
}

function fitSeoLedDiscoverability(i: FitInputs): number {
  const shapeBonus =
    i.shape === 'how_to' ? 10
    : i.shape === 'what_is' ? 10
    : i.shape === 'comparison' ? 8
    : i.shape === 'framework_first' ? 5
    : 0;
  const typeBonus = i.contentType === 'blog' || i.contentType === 'guide' ? 8 : 0;
  const driftPenalty = i.driftRisk === 'high' ? -15 : 0;
  return clamp100(i.seo * 0.45 + i.alignment * 0.15 + i.operational * 0.15 + i.commercial * 0.10 + shapeBonus + typeBonus + driftPenalty);
}

function fitStrategicPositioning(i: FitInputs): number {
  const archetypeBonus =
    i.archetype === 'authority_positioning' ? 10
    : i.archetype === 'category_definition' ? 12
    : i.archetype === 'comparative_decision' ? 6
    : 0;
  return clamp100(i.alignment * 0.40 + i.authority * 0.25 + i.novelty * 0.15 + i.commercial * 0.10 + archetypeBonus);
}

function fitConversionAssist(i: FitInputs): number {
  const stageBonus =
    i.stage === 'decision' ? 14
    : i.stage === 'evaluation' ? 12
    : i.stage === 'consideration' ? 6
    : 0;
  const typeBonus = i.contentType === 'case-study' ? 14 : i.contentType === 'whitepaper' ? 6 : 0;
  return clamp100(i.commercial * 0.40 + i.alignment * 0.25 + i.operational * 0.15 + stageBonus + typeBonus);
}

function fitThoughtLeadership(i: FitInputs): number {
  const shapeBonus = i.shape === 'opinion_take' || i.shape === 'framework_first' ? 12 : 0;
  const archetypeBonus =
    i.archetype === 'authority_positioning' || i.archetype === 'category_definition' || i.archetype === 'transformation_path'
      ? 10
      : 0;
  const typeBonus = i.contentType === 'article' || i.contentType === 'newsletter' || i.contentType === 'whitepaper' ? 8 : 0;
  return clamp100(i.authority * 0.40 + i.novelty * 0.25 + i.shapeUniqueness * 0.15 + shapeBonus + archetypeBonus + typeBonus);
}

function fitOperationalDeepDive(i: FitInputs): number {
  const typeBonus = i.contentType === 'guide' || i.contentType === 'case-study' ? 12 : i.contentType === 'whitepaper' ? 6 : 0;
  const archetypeBonus =
    i.archetype === 'observability' || i.archetype === 'orchestration' || i.archetype === 'workflow_fragmentation' || i.archetype === 'evaluation_maturity'
      ? 10
      : 0;
  return clamp100(i.operational * 0.50 + i.authority * 0.20 + i.alignment * 0.15 + typeBonus + archetypeBonus);
}

const FIT_FUNCTIONS: Record<LongFormPrimaryUse, (i: FitInputs) => number> = {
  long_form_educational: fitLongFormEducational,
  authority_building: fitAuthorityBuilding,
  seo_led_discoverability: fitSeoLedDiscoverability,
  strategic_positioning: fitStrategicPositioning,
  conversion_assist: fitConversionAssist,
  thought_leadership: fitThoughtLeadership,
  operational_deep_dive: fitOperationalDeepDive,
};

function rationaleFor(use: LongFormPrimaryUse, i: FitInputs): string {
  switch (use) {
    case 'long_form_educational':
      return `Operational depth ${i.operational} and content type ${i.contentType} fit an educational long-form piece for ${i.stage}-stage readers.`;
    case 'authority_building':
      return `Authority score ${i.authority} with ${i.archetype ?? 'uncategorized'} archetype positions this as authority-building.`;
    case 'seo_led_discoverability':
      return `SEO opportunity ${i.seo} combined with ${i.shape ?? 'unknown'} title shape favors discoverability.`;
    case 'strategic_positioning':
      return `Company alignment ${i.alignment} and authority ${i.authority} make this a strategic-positioning piece.`;
    case 'conversion_assist':
      return `Commercial relevance ${i.commercial} at ${i.stage} stage suits a conversion-assist piece.`;
    case 'thought_leadership':
      return `Novelty ${i.novelty} and shape uniqueness ${i.shapeUniqueness} support a thought-leadership angle.`;
    case 'operational_deep_dive':
      return `Operational depth ${i.operational} with ${i.archetype ?? 'uncategorized'} archetype calls for an operational deep dive.`;
  }
}

export function analyzeRecommendationSuitability(
  recommendation: LongFormRecommendation,
): RecommendationSuitability {
  const inputs: FitInputs = {
    alignment: recommendation.companyAlignmentScore,
    authority: recommendation.authorityBuildingScore,
    commercial: recommendation.commercialRelevanceScore,
    operational: recommendation.operationalDepthScore,
    seo: recommendation.seoOpportunityScore,
    novelty: recommendation.recommendationNoveltyScore ?? 80,
    shapeUniqueness: recommendation.narrativeShapeUniquenessScore ?? 80,
    archetype: recommendation.narrativeArchetype,
    shape: recommendation.narrativeShape,
    contentType: recommendation.recommendedContentType,
    stage: recommendation.targetBuyerStage,
    driftRisk: recommendation.genericityRiskLevel,
  };

  const useFitScores = {} as Record<LongFormPrimaryUse, number>;
  for (const use of LONG_FORM_PRIMARY_USES) {
    useFitScores[use] = FIT_FUNCTIONS[use](inputs);
  }

  // Pick primary = highest fit.
  let primary: LongFormPrimaryUse = LONG_FORM_PRIMARY_USES[0];
  for (const use of LONG_FORM_PRIMARY_USES) {
    if (useFitScores[use] > useFitScores[primary]) primary = use;
  }

  const secondary = LONG_FORM_PRIMARY_USES.filter((u) => u !== primary && useFitScores[u] >= SECONDARY_THRESHOLD);
  const unsuitable = LONG_FORM_PRIMARY_USES.filter((u) => useFitScores[u] < UNSUITABLE_THRESHOLD);

  return {
    recommendedPrimaryUse: primary,
    recommendedSecondaryUses: secondary,
    unsuitableFor: unsuitable,
    useFitScores,
    primaryUseRationale: rationaleFor(primary, inputs),
  };
}
