/**
 * Phase 2 — Planner inheritance contract.
 *
 * The planner MUST inherit the recommendation's strategic intent. This module
 * checks each of the 9 inheritance elements against the planning input and
 * reports per-element preservation + an aggregate completeness score.
 *
 * Elements (from spec):
 *   • strategic_narrative
 *   • editorial_angle
 *   • operational_framing
 *   • icp_framing
 *   • capability_emphasis
 *   • narrative_family
 *   • avoid_patterns
 *   • terminology_emphasis
 *   • content_mode_intent
 *
 * Threshold for `passed`: configurable, defaults to 70. Below the threshold
 * the caller should warn or reject.
 */

import type {
  InheritanceElement,
  LongFormRecommendation,
  PlannerInheritanceContractResult,
} from './longFormRecommendationTypes';
import { INHERITANCE_ELEMENTS } from './longFormRecommendationTypes';
import type {
  EditorialContextBlock,
  PlanningInputPartial,
} from './longFormPlanningAdapter';

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'was','were','be','been','being','as','from','that','this','these','those','it','its',
]);

function tokens(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function tokenOverlapRatio(source: string, target: string): number {
  if (!source.trim()) return 1;
  const a = new Set(tokens(source));
  if (a.size === 0) return 1;
  const t = new Set(tokens(target));
  let hits = 0;
  a.forEach((tok) => { if (t.has(tok)) hits += 1; });
  return hits / a.size;
}

function pct(ratio: number): number {
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

// ────────────────────────────────────────────────────────────────────────────
// Per-element checks
// ────────────────────────────────────────────────────────────────────────────

function checkStrategicNarrative(rec: LongFormRecommendation, planningInput: PlanningInputPartial, ctx?: EditorialContextBlock) {
  const source = rec.strategicNarrative;
  if (!source.trim()) return { score: 100, preserved: true, detail: 'Recommendation had no strategic narrative — nothing to inherit.' };
  const target = [ctx?.strategicNarrative ?? '', planningInput.seoContext, planningInput.intent].join(' ');
  const score = pct(tokenOverlapRatio(source, target));
  return {
    score,
    preserved: score >= 50,
    detail: score >= 70 ? 'Strategic narrative preserved.' : score >= 50 ? 'Strategic narrative partially preserved — review tokens kept.' : 'Strategic narrative materially weakened or dropped.',
  };
}

function checkEditorialAngle(rec: LongFormRecommendation, planningInput: PlanningInputPartial, ctx?: EditorialContextBlock) {
  const source = rec.editorialAngle;
  if (!source.trim()) return { score: 100, preserved: true, detail: 'No editorial angle to inherit.' };
  const target = [planningInput.intent, ctx?.editorialAngle ?? '', planningInput.topic].join(' ');
  const score = pct(tokenOverlapRatio(source, target));
  return {
    score,
    preserved: score >= 50,
    detail: score >= 70 ? 'Editorial angle preserved.' : 'Editorial angle weakened.',
  };
}

function checkOperationalFraming(rec: LongFormRecommendation, _planningInput: PlanningInputPartial, ctx?: EditorialContextBlock) {
  const proof = rec.recommendedContentDirection.operationalProof;
  if (proof.length === 0) return { score: 100, preserved: true, detail: 'Recommendation had no operational proof — nothing to inherit.' };
  const targetProof = ctx?.recommendedContentDirection.operationalProof ?? [];
  if (targetProof.length === 0) {
    return { score: 0, preserved: false, detail: 'editorialContext.recommendedContentDirection.operationalProof is empty.' };
  }
  // For each source proof item, find any target item with ≥ 30% token overlap.
  let preserved = 0;
  for (const item of proof) {
    if (targetProof.some((t) => tokenOverlapRatio(item, t) >= 0.30)) preserved += 1;
  }
  const score = Math.round((preserved / proof.length) * 100);
  return {
    score,
    preserved: score >= 50,
    detail: `${preserved}/${proof.length} operational proof items preserved.`,
  };
}

function checkIcpFraming(rec: LongFormRecommendation, planningInput: PlanningInputPartial, ctx?: EditorialContextBlock) {
  const source = rec.whyThisFitsCompany.icpProblemMapping;
  if (source.length < 20) return { score: 100, preserved: true, detail: 'No substantive ICP mapping to inherit.' };
  const target = [
    ctx?.whyThisFitsCompany.icpProblemMapping ?? '',
    ctx?.icpContext.market ?? '',
    (ctx?.icpContext.icps ?? []).join(' '),
    (ctx?.icpContext.painPoints ?? []).join(' '),
    planningInput.topic,
    planningInput.seoContext,
  ].join(' ');
  const score = pct(tokenOverlapRatio(source, target));
  return {
    score,
    preserved: score >= 50,
    detail: score >= 70 ? 'ICP framing preserved.' : score >= 50 ? 'ICP framing partially weakened.' : 'ICP framing eroded.',
  };
}

function checkCapabilityEmphasis(rec: LongFormRecommendation, planningInput: PlanningInputPartial, ctx?: EditorialContextBlock) {
  const source = rec.whyThisFitsCompany.capabilityConnection;
  if (source.length < 15) return { score: 100, preserved: true, detail: 'No capability connection to inherit.' };
  const target = [
    ctx?.whyThisFitsCompany.capabilityConnection ?? '',
    ctx?.capabilityEmphasis.primaryCapability ?? '',
    ctx?.capabilityEmphasis.workflowCategory ?? '',
    planningInput.topic,
    planningInput.intent,
  ].join(' ');
  const score = pct(tokenOverlapRatio(source, target));
  return {
    score,
    preserved: score >= 50,
    detail: score >= 70 ? 'Capability emphasis preserved.' : 'Capability emphasis weakened.',
  };
}

function checkNarrativeFamily(rec: LongFormRecommendation, _planningInput: PlanningInputPartial, ctx?: EditorialContextBlock) {
  const sourceArchetype = rec.narrativeArchetype ?? 'uncategorized';
  const targetArchetype = ctx?.narrativeFamily.archetype ?? 'uncategorized';
  if (sourceArchetype === 'uncategorized' && targetArchetype === 'uncategorized') {
    return { score: 80, preserved: true, detail: 'No specific narrative family to inherit.' };
  }
  if (sourceArchetype === targetArchetype) {
    return { score: 100, preserved: true, detail: `Narrative family preserved (${sourceArchetype}).` };
  }
  return {
    score: 0,
    preserved: false,
    detail: `Narrative family changed: ${sourceArchetype} → ${targetArchetype}.`,
  };
}

function checkAvoidPatterns(rec: LongFormRecommendation, _planningInput: PlanningInputPartial, ctx?: EditorialContextBlock) {
  const source = rec.recommendedContentDirection.avoidPatterns;
  if (source.length === 0) return { score: 100, preserved: true, detail: 'No avoid patterns to inherit.' };
  const target = ctx?.recommendedContentDirection.avoidPatterns ?? [];
  if (target.length === 0) {
    return { score: 0, preserved: false, detail: 'Avoid patterns were stripped from planning input.' };
  }
  // Tolerant — as long as ≥ 50% of source patterns are preserved (token overlap ≥ 50%), pass.
  let preserved = 0;
  for (const p of source) {
    if (target.some((t) => tokenOverlapRatio(p, t) >= 0.50)) preserved += 1;
  }
  const score = Math.round((preserved / source.length) * 100);
  return {
    score,
    preserved: score >= 50,
    detail: `${preserved}/${source.length} avoid patterns preserved.`,
  };
}

function checkTerminologyEmphasis(_rec: LongFormRecommendation, _planningInput: PlanningInputPartial, ctx?: EditorialContextBlock) {
  const domainVocab = ctx?.terminologyEmphasis.domainVocabulary ?? [];
  const strategicTerms = ctx?.terminologyEmphasis.strategicTerminology ?? [];
  const total = domainVocab.length + strategicTerms.length;
  if (total === 0) {
    return { score: 60, preserved: true, detail: 'No terminology emphasis was attached — neutral signal.' };
  }
  return { score: 100, preserved: true, detail: `${total} terminology emphasis terms attached.` };
}

function checkContentModeIntent(rec: LongFormRecommendation, _planningInput: PlanningInputPartial, ctx?: EditorialContextBlock) {
  if (!ctx) return { score: 0, preserved: false, detail: 'editorialContext is missing entirely.' };
  if (ctx.alignmentMode !== rec.contentAlignmentMode) {
    return {
      score: 0,
      preserved: false,
      detail: `Mode mismatch: recommendation=${rec.contentAlignmentMode} planner=${ctx.alignmentMode}.`,
    };
  }
  return { score: 100, preserved: true, detail: `Mode preserved (${rec.contentAlignmentMode}).` };
}

const CHECKERS: Record<InheritanceElement, (rec: LongFormRecommendation, p: PlanningInputPartial, ctx?: EditorialContextBlock) => { score: number; preserved: boolean; detail: string }> = {
  strategic_narrative: checkStrategicNarrative,
  editorial_angle: checkEditorialAngle,
  operational_framing: checkOperationalFraming,
  icp_framing: checkIcpFraming,
  capability_emphasis: checkCapabilityEmphasis,
  narrative_family: checkNarrativeFamily,
  avoid_patterns: checkAvoidPatterns,
  terminology_emphasis: checkTerminologyEmphasis,
  content_mode_intent: checkContentModeIntent,
};

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export function evaluatePlannerInheritanceContract(input: {
  recommendation: LongFormRecommendation;
  planningInput: PlanningInputPartial;
  editorialContext?: EditorialContextBlock;
  passingThreshold?: number;
}): PlannerInheritanceContractResult {
  const ctx = input.editorialContext ?? input.planningInput.editorialContext;
  const threshold = input.passingThreshold ?? 70;

  const elementStatus = {} as PlannerInheritanceContractResult['elementStatus'];
  const breaches: string[] = [];

  let totalScore = 0;
  for (const element of INHERITANCE_ELEMENTS) {
    const status = CHECKERS[element](input.recommendation, input.planningInput, ctx);
    elementStatus[element] = status;
    totalScore += status.score;
    if (!status.preserved) breaches.push(`${element}: ${status.detail}`);
  }

  const inheritanceCompletenessScore = Math.round(totalScore / INHERITANCE_ELEMENTS.length);
  const passed = inheritanceCompletenessScore >= threshold && breaches.length === 0;

  return {
    inheritanceCompletenessScore,
    elementStatus,
    passed,
    breaches,
  };
}
