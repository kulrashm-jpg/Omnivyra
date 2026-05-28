/**
 * Phase 7 — Explanation consistency composer.
 *
 * Previous phases attached origin traces, alignment decision traces, drift
 * info, cluster info, etc. Each is rendered separately in the UI, which
 * creates the risk of mutually contradictory explanations (e.g., "ranks
 * highly for company alignment" alongside "low company alignment score").
 *
 * This composer derives ALL 7 explanation sections from ONE canonical source
 * — the recommendation itself plus the foundation — and runs a contradiction
 * check before returning the result.
 *
 * The reasoningSourceHash makes it possible to detect whether an explanation
 * was generated from the same recommendation snapshot or a stale one.
 */

import type {
  ConfidenceBand,
  LongFormPrimaryUse,
  LongFormRecommendation,
  RecommendationConfidence,
  RecommendationExplanation,
  RecommendationSuitability,
} from './longFormRecommendationTypes';
import type { CompanyContextFoundation } from './companyContextFoundation';

function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function bandLabel(band: ConfidenceBand): string {
  return band === 'exceptional' ? 'exceptional confidence'
    : band === 'high' ? 'high confidence'
    : band === 'medium' ? 'medium confidence'
    : 'low confidence';
}

function primaryUseLabel(use: LongFormPrimaryUse): string {
  return use.replace(/_/g, ' ');
}

interface CompositionInput {
  recommendation: LongFormRecommendation;
  foundation: CompanyContextFoundation;
  confidence?: RecommendationConfidence;
  suitability?: RecommendationSuitability;
  /** Siblings in the same batch — used for "why this differs". */
  siblings: LongFormRecommendation[];
}

export function composeRecommendationExplanation(input: CompositionInput): RecommendationExplanation {
  const { recommendation: r, foundation, confidence, suitability, siblings } = input;

  // ── Canonical source: every section reads from this. ─────────────────
  const canonical = {
    title: r.recommendationTitle,
    angle: r.editorialAngle,
    mode: r.contentAlignmentMode,
    contentType: r.recommendedContentType,
    stage: r.targetBuyerStage,
    archetype: r.narrativeArchetype ?? 'uncategorized',
    cluster: r.familyClusterLabel ?? null,
    shape: r.narrativeShape ?? 'other',
    icp: r.whyThisFitsCompany.icpProblemMapping,
    capability: r.whyThisFitsCompany.capabilityConnection,
    origin: r.whyThisFitsCompany.businessContextOrigin,
    summary: r.whyThisFitsCompany.summary,
    narrative: r.strategicNarrative,
    primaryAngle: r.recommendedContentDirection.primaryAngle,
    operationalProof: r.recommendedContentDirection.operationalProof,
    avoid: r.recommendedContentDirection.avoidPatterns,
    scores: {
      alignment: r.companyAlignmentScore,
      authority: r.authorityBuildingScore,
      commercial: r.commercialRelevanceScore,
      operational: r.operationalDepthScore,
      seo: r.seoOpportunityScore,
      overall: r.overallRecommendationStrength,
    },
    novelty: r.recommendationNoveltyScore ?? null,
    shapeUniqueness: r.narrativeShapeUniquenessScore ?? null,
    confidenceScore: confidence?.recommendationConfidenceScore ?? null,
    confidenceBand: confidence?.confidenceBand ?? null,
    primaryUse: suitability?.recommendedPrimaryUse ?? null,
    secondaryUses: suitability?.recommendedSecondaryUses ?? [],
    foundationCategory: foundation.businessIdentity.companyCategory ?? 'this category',
    foundationPositioning: foundation.businessIdentity.positioning ?? 'the company positioning',
    foundationTransformation: foundation.strategicPov.transformationNarrative ?? 'the desired operational outcome',
    foundationPopulatedSections: foundation.populatedSections.length,
  };

  // ── Section composers ─────────────────────────────────────────────────

  const whyThisMatters = `This recommendation addresses ${canonical.icp || 'a defined ICP problem'} for ${canonical.foundationCategory}, by anchoring the narrative in ${canonical.capability || 'a concrete operational capability'}.`;

  const whyThisCompany = `It emerges directly from the company's ${canonical.foundationPositioning} positioning. Origin trace: ${canonical.origin || 'derived from populated foundation sections'}.`;

  const whyThisIcp = `Targets ${canonical.stage}-stage buyers via "${canonical.icp || 'a specific ICP pain'}". The piece keeps that pain as the through-line rather than addressing a generic audience.`;

  const whyThisNow = (() => {
    if (canonical.confidenceBand === 'exceptional') {
      return `All confidence contributors are strong (${bandLabel(canonical.confidenceBand)}); high-trust window for this topic.`;
    }
    if (canonical.confidenceBand === 'low') {
      return `Surface with a low-confidence label — context or novelty are below the threshold. Consider strengthening the company profile first.`;
    }
    return `${bandLabel(canonical.confidenceBand ?? 'medium')} — recommend producing now while the foundation supports it.`;
  })();

  const whyThisDiffers = (() => {
    const sameArchetype = siblings.filter((s) => s.recommendationId !== r.recommendationId && s.narrativeArchetype === r.narrativeArchetype);
    const sameStage = siblings.filter((s) => s.recommendationId !== r.recommendationId && s.targetBuyerStage === r.targetBuyerStage);
    const sameType = siblings.filter((s) => s.recommendationId !== r.recommendationId && s.recommendedContentType === r.recommendedContentType);
    const distinct: string[] = [];
    if (sameArchetype.length === 0 && canonical.archetype !== 'uncategorized') distinct.push(`only card with archetype "${canonical.archetype.replace(/_/g, ' ')}"`);
    if (sameStage.length === 0) distinct.push(`only card targeting ${canonical.stage}`);
    if (sameType.length === 0) distinct.push(`only ${canonical.contentType} card`);
    if (distinct.length === 0) {
      return `Differentiated within the batch by editorial angle: "${canonical.angle.slice(0, 110)}"`;
    }
    return `Differentiated by being the ${distinct.join('; ')}.`;
  })();

  const whyThisRanksHighly = (() => {
    const ordered = [
      { name: 'company alignment', v: canonical.scores.alignment, weight: 0.32 },
      { name: 'authority building', v: canonical.scores.authority, weight: 0.22 },
      { name: 'commercial relevance', v: canonical.scores.commercial, weight: 0.20 },
      { name: 'operational depth', v: canonical.scores.operational, weight: 0.16 },
      { name: 'SEO opportunity', v: canonical.scores.seo, weight: 0.10 },
    ];
    const sorted = [...ordered].sort((a, b) => (b.v * b.weight) - (a.v * a.weight));
    const top = sorted[0];
    return `Overall strength ${canonical.scores.overall}; primary driver is ${top.name} at ${top.v} (weight ${top.weight}). Lower-weight SEO score (${canonical.scores.seo}) intentionally has the smallest pull.`;
  })();

  const whyThisIsOperationallyValuable = (() => {
    if (canonical.operationalProof.length === 0) {
      return `Operational depth score is ${canonical.scores.operational}. The recommendation has no proof items attached, so the value here is editorial framing rather than execution-ready detail.`;
    }
    return `Operational depth ${canonical.scores.operational}. Proof items: ${canonical.operationalProof.slice(0, 2).map((p) => `"${p.slice(0, 80)}"`).join('; ')}.${canonical.primaryUse ? ` Best suited for ${primaryUseLabel(canonical.primaryUse)}.` : ''}`;
  })();

  // ── Contradiction detection ───────────────────────────────────────────
  const contradictions: string[] = [];

  if (canonical.scores.alignment < 40 && /high(ly)? aligned|strong(ly)? aligned|excellent company alignment/i.test(whyThisCompany)) {
    contradictions.push('whyThisCompany describes strong alignment while companyAlignmentScore is below 40.');
  }
  if (canonical.scores.operational < 40 && /operationally valuable|deep operational/i.test(whyThisIsOperationallyValuable) && canonical.operationalProof.length === 0) {
    contradictions.push('whyThisIsOperationallyValuable claims operational value while operationalDepth is low AND no proof items exist.');
  }
  if (canonical.confidenceBand === 'low' && /high-trust|strong confidence/i.test(whyThisNow)) {
    contradictions.push('whyThisNow claims high trust while confidenceBand is low.');
  }
  if (canonical.archetype === 'uncategorized' && /only card with archetype/i.test(whyThisDiffers)) {
    contradictions.push('whyThisDiffers credits the archetype while archetype is uncategorized.');
  }

  // ── Reasoning source hash (stable for the same canonical state). ──────
  const reasoningSourceHash = `rs_${stableHash(JSON.stringify(canonical))}`;

  return {
    whyThisMatters,
    whyThisCompany,
    whyThisIcp,
    whyThisNow,
    whyThisDiffers,
    whyThisRanksHighly,
    whyThisIsOperationallyValuable,
    reasoningSourceHash,
    contradictions,
  };
}
