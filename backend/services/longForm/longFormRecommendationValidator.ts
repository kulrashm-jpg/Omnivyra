/**
 * Phase 6 — Validation rules.
 *
 * Hard-reject a recommendation if ANY of the following hold:
 *   1. Topic could belong equally to any random SaaS company.
 *   2. Company-context influence is superficial.
 *   3. Recommendation only mirrors keyword phrasing of the seed topic.
 *   4. Editorial angle lacks operational specificity.
 *   5. Strategic narrative is absent (when required by mode).
 *   6. No clear ICP mapping exists.
 *
 * Plus mode floor: companyAlignmentScore must clear ALIGNMENT_MODE_RULES[mode].minCompanyAlignment.
 * Plus drift detection: genericityRiskLevel === 'high' is always a hard reject.
 */

import type { CompanyContextFoundation } from './companyContextFoundation';
import type { RecommendationCandidate } from './longFormRecommendationScoring';
import {
  type ContentAlignmentMode,
  type DriftDetectionResult,
  type LongFormRecommendation,
  type RecommendationScoreBreakdown,
  ALIGNMENT_MODE_RULES,
} from './longFormRecommendationTypes';

export type RejectionRule =
  | 'GENERIC_SAAS_FIT'
  | 'SUPERFICIAL_CONTEXT'
  | 'KEYWORD_MIRROR'
  | 'NO_OPERATIONAL_SPECIFICITY'
  | 'MISSING_STRATEGIC_NARRATIVE'
  | 'NO_ICP_MAPPING'
  | 'BELOW_MODE_FLOOR'
  | 'GENERIC_DRIFT';

export interface ValidationResult {
  passed: boolean;
  rejections: Array<{ rule: RejectionRule; detail: string }>;
}

const GENERIC_SAAS_PHRASES = [
  'streamline your workflow',
  'boost productivity',
  'unlock growth',
  'maximize roi',
  'transform your business',
  'leverage ai',
  'scale efficiently',
  'best practices for',
  'top tips for',
  'how to get started with',
];

function containsAny(haystack: string, needles: string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n)) return n;
  }
  return null;
}

function checkGenericSaasFit(candidate: RecommendationCandidate): { ok: boolean; detail: string } {
  const hit = containsAny(
    [candidate.recommendationTitle, candidate.editorialAngle].join(' '),
    GENERIC_SAAS_PHRASES,
  );
  if (hit) {
    return { ok: false, detail: `Title/angle contains generic SaaS phrase: "${hit}".` };
  }
  return { ok: true, detail: '' };
}

function checkSuperficialContext(
  candidate: RecommendationCandidate,
  foundation: CompanyContextFoundation,
  scores: RecommendationScoreBreakdown,
): { ok: boolean; detail: string } {
  // "Superficial" = companyAlignmentScore below a floor relative to populated
  // sections. If the foundation is rich but score is low, context didn't bite.
  const expectedFloor = Math.min(70, 30 + foundation.populatedSections.length * 8);
  if (scores.companyAlignmentScore < expectedFloor) {
    return {
      ok: false,
      detail: `companyAlignmentScore=${scores.companyAlignmentScore} below contextual floor=${expectedFloor} for ${foundation.populatedSections.length} populated sections.`,
    };
  }
  // Whythisfits should reference at least one capability or ICP token.
  const why = [
    candidate.whyThisFitsCompany.capabilityConnection,
    candidate.whyThisFitsCompany.icpProblemMapping,
  ].join(' ').toLowerCase();
  const hasCapabilityRef = foundation.capabilityMapping.workflowCategories.concat(foundation.capabilityMapping.enables)
    .some((c) => c && why.includes(c.toLowerCase()));
  const hasIcpRef = foundation.marketUnderstanding.icps
    .some((i) => i && why.includes(i.toLowerCase()));
  if (!hasCapabilityRef && !hasIcpRef && foundation.populatedSections.length >= 3) {
    return {
      ok: false,
      detail: 'whyThisFitsCompany does not reference any concrete capability or ICP from the foundation.',
    };
  }
  return { ok: true, detail: '' };
}

function checkKeywordMirror(candidate: RecommendationCandidate): { ok: boolean; detail: string } {
  if (!candidate.seedTopic) return { ok: true, detail: '' };
  const seedNorm = candidate.seedTopic.toLowerCase().trim();
  const titleNorm = candidate.recommendationTitle.toLowerCase().trim();
  if (!seedNorm || !titleNorm) return { ok: true, detail: '' };
  // Mirror = title is essentially seed plus a generic prefix/suffix.
  if (titleNorm === seedNorm) {
    return { ok: false, detail: `Title is identical to seed topic "${candidate.seedTopic}".` };
  }
  const seedTokens = seedNorm.split(/\s+/).filter(Boolean);
  const titleTokens = titleNorm.split(/\s+/).filter(Boolean);
  const seedSet = new Set(seedTokens);
  const extra = titleTokens.filter((t) => !seedSet.has(t));
  if (titleTokens.length > 0 && extra.length / titleTokens.length < 0.25) {
    return {
      ok: false,
      detail: `Title mirrors seed: only ${extra.length}/${titleTokens.length} tokens add net-new phrasing.`,
    };
  }
  return { ok: true, detail: '' };
}

function checkOperationalSpecificity(
  candidate: RecommendationCandidate,
  scores: RecommendationScoreBreakdown,
  mode: ContentAlignmentMode,
): { ok: boolean; detail: string } {
  const rule = ALIGNMENT_MODE_RULES[mode];
  if (rule.allowsLowOperationalDepth) return { ok: true, detail: '' };

  if (scores.operationalDepthScore < 50) {
    return {
      ok: false,
      detail: `operationalDepthScore=${scores.operationalDepthScore} (< 50). Mode ${mode} requires concrete operational proof.`,
    };
  }
  if (candidate.recommendedContentDirection.operationalProof.length < 2) {
    return {
      ok: false,
      detail: 'recommendedContentDirection.operationalProof has fewer than 2 concrete items.',
    };
  }
  return { ok: true, detail: '' };
}

function checkStrategicNarrative(
  candidate: RecommendationCandidate,
  mode: ContentAlignmentMode,
): { ok: boolean; detail: string } {
  const rule = ALIGNMENT_MODE_RULES[mode];
  if (!rule.requiresStrategicNarrative) return { ok: true, detail: '' };
  const narrative = candidate.strategicNarrative?.trim() ?? '';
  if (narrative.length < 40) {
    return {
      ok: false,
      detail: `strategicNarrative too thin (${narrative.length} chars; min 40 for mode ${mode}).`,
    };
  }
  return { ok: true, detail: '' };
}

function checkIcpMapping(candidate: RecommendationCandidate): { ok: boolean; detail: string } {
  const icp = candidate.whyThisFitsCompany.icpProblemMapping?.trim() ?? '';
  if (icp.length < 25) {
    return {
      ok: false,
      detail: `icpProblemMapping too thin (${icp.length} chars; min 25).`,
    };
  }
  return { ok: true, detail: '' };
}

function checkModeFloor(
  scores: RecommendationScoreBreakdown,
  mode: ContentAlignmentMode,
): { ok: boolean; detail: string } {
  const rule = ALIGNMENT_MODE_RULES[mode];
  if (scores.companyAlignmentScore < rule.minCompanyAlignment) {
    return {
      ok: false,
      detail: `companyAlignmentScore=${scores.companyAlignmentScore} below mode floor=${rule.minCompanyAlignment} for ${mode}.`,
    };
  }
  return { ok: true, detail: '' };
}

function checkDrift(drift: DriftDetectionResult): { ok: boolean; detail: string } {
  if (drift.isGenericDrift || drift.riskLevel === 'high') {
    return { ok: false, detail: drift.reason };
  }
  return { ok: true, detail: '' };
}

export function validateRecommendationCandidate(input: {
  candidate: RecommendationCandidate;
  foundation: CompanyContextFoundation;
  scores: RecommendationScoreBreakdown;
  drift: DriftDetectionResult;
  mode: ContentAlignmentMode;
}): ValidationResult {
  const { candidate, foundation, scores, drift, mode } = input;
  const rejections: ValidationResult['rejections'] = [];

  const checks: Array<{ rule: RejectionRule; result: { ok: boolean; detail: string } }> = [
    { rule: 'GENERIC_SAAS_FIT', result: checkGenericSaasFit(candidate) },
    { rule: 'SUPERFICIAL_CONTEXT', result: checkSuperficialContext(candidate, foundation, scores) },
    { rule: 'KEYWORD_MIRROR', result: checkKeywordMirror(candidate) },
    { rule: 'NO_OPERATIONAL_SPECIFICITY', result: checkOperationalSpecificity(candidate, scores, mode) },
    { rule: 'MISSING_STRATEGIC_NARRATIVE', result: checkStrategicNarrative(candidate, mode) },
    { rule: 'NO_ICP_MAPPING', result: checkIcpMapping(candidate) },
    { rule: 'BELOW_MODE_FLOOR', result: checkModeFloor(scores, mode) },
    { rule: 'GENERIC_DRIFT', result: checkDrift(drift) },
  ];

  for (const { rule, result } of checks) {
    if (!result.ok) rejections.push({ rule, detail: result.detail });
  }

  return { passed: rejections.length === 0, rejections };
}

/**
 * Top-level validator for a finalized LongFormRecommendation. Convenience
 * wrapper used by the API + UI to re-validate already-stored recommendations.
 */
export function validateFinalizedRecommendation(
  recommendation: LongFormRecommendation,
  foundation: CompanyContextFoundation,
  drift: DriftDetectionResult,
  seedTopic?: string,
): ValidationResult {
  const candidate: RecommendationCandidate = {
    recommendationTitle: recommendation.recommendationTitle,
    editorialAngle: recommendation.editorialAngle,
    contentAlignmentMode: recommendation.contentAlignmentMode,
    targetBuyerStage: recommendation.targetBuyerStage,
    strategicNarrative: recommendation.strategicNarrative,
    whyThisFitsCompany: recommendation.whyThisFitsCompany,
    recommendedContentDirection: recommendation.recommendedContentDirection,
    seedTopic,
  };
  const scores: RecommendationScoreBreakdown = {
    companyAlignmentScore: recommendation.companyAlignmentScore,
    commercialRelevanceScore: recommendation.commercialRelevanceScore,
    authorityBuildingScore: recommendation.authorityBuildingScore,
    operationalDepthScore: recommendation.operationalDepthScore,
    seoOpportunityScore: recommendation.seoOpportunityScore,
    overallRecommendationStrength: recommendation.overallRecommendationStrength,
  };
  return validateRecommendationCandidate({
    candidate,
    foundation,
    scores,
    drift,
    mode: recommendation.contentAlignmentMode,
  });
}
