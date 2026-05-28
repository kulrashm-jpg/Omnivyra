/**
 * Phase 4 — Planner → generation continuity analyzer.
 *
 * The handoff layer ensured the planner INPUT preserved recommendation intent.
 * This analyzer checks the planner's OUTPUT (ContentPlan) — sections, titles,
 * goals, key points, framework, evidence plan — also preserves it.
 *
 * Six preservation axes:
 *   • strategicSequencing   — sections cover the strategic arc (problem → solution → application)
 *   • editorialIntent       — title/excerpt echo the recommendation's editorial angle
 *   • operationalLogic      — section depth/goals reference operational proof items
 *   • terminologyIntegrity  — domain vocabulary survives into section text
 *   • capabilityEmphasis    — the recommended capability is named/echoed across sections
 *   • buyerStageContinuity  — section depth matches buyer stage expectations
 *
 * Five detection types:
 *   • PLANNER_SIMPLIFICATION   — section depth_requirement uses softer language
 *   • NARRATIVE_FLATTENING     — sections lost the staged progression
 *   • STRATEGIC_DILUTION       — strategic terminology absent from plan
 *   • OPERATIONAL_ABSTRACTION  — operational proof not echoed in section goals
 *   • CAPABILITY_SUPPRESSION   — capability missing from sections
 */

import type {
  LongFormRecommendation,
  PlannerContinuityDetectionType,
  PlannerGenerationContinuityResult,
  TargetBuyerStage,
} from './longFormRecommendationTypes';
import type { ContentPlan } from '../../../lib/content/longFormPlanningEngine';

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
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

function planText(plan: ContentPlan): string {
  return [
    plan.title,
    plan.excerpt,
    plan.key_insights.join(' '),
    plan.sections.map((s) => `${s.section_title} ${s.section_goal} ${s.unique_angle} ${s.key_points.join(' ')} ${s.depth_requirement}`).join(' '),
    plan.framework?.name ?? '',
    (plan.framework?.components ?? []).join(' '),
    (plan.faq ?? []).map((q) => `${q.question} ${q.answer}`).join(' '),
    (plan.evidence_plan ?? []).join(' '),
  ].join(' ');
}

// ────────────────────────────────────────────────────────────────────────────
// Per-axis scoring
// ────────────────────────────────────────────────────────────────────────────

/**
 * Strategic sequencing — a healthy plan covers a staged arc (context →
 * framework/application → examples → insight). We check section content types.
 */
function scoreStrategicSequencing(plan: ContentPlan): number {
  if (plan.sections.length === 0) return 0;
  const types = plan.sections.map((s) => String(s.content_type ?? '').toLowerCase());
  const hasExplanation = types.some((t) => /explanation|context/.test(t));
  const hasFrameworkOrApplication = types.some((t) => /framework|application/.test(t));
  const hasExampleOrCase = types.some((t) => /example|case_study|case/.test(t));
  const hasInsight = types.some((t) => /insight|opinion/.test(t)) || plan.sections.some((s) => s.requires_opinionated_insight);
  const present = [hasExplanation, hasFrameworkOrApplication, hasExampleOrCase, hasInsight].filter(Boolean).length;
  return pct(present / 4);
}

function scoreEditorialIntent(plan: ContentPlan, recommendation: LongFormRecommendation): number {
  const target = [plan.title, plan.excerpt, plan.key_insights.join(' ')].join(' ');
  const fromAngle = tokenOverlapRatio(recommendation.editorialAngle, target);
  const fromTitleSeed = tokenOverlapRatio(recommendation.recommendationTitle, target);
  return pct(Math.max(fromAngle, fromTitleSeed * 0.8));
}

function scoreOperationalLogic(plan: ContentPlan, recommendation: LongFormRecommendation): number {
  const proof = recommendation.recommendedContentDirection.operationalProof;
  if (proof.length === 0) return 100;
  const plannerHaystack = plan.sections
    .map((s) => `${s.section_goal} ${s.unique_angle} ${s.key_points.join(' ')} ${s.depth_requirement}`)
    .join(' ');
  let preserved = 0;
  for (const item of proof) {
    if (tokenOverlapRatio(item, plannerHaystack) >= 0.25) preserved += 1;
  }
  return pct(preserved / proof.length);
}

function scoreTerminologyIntegrity(
  plan: ContentPlan,
  domainVocabulary: string[],
  strategicTerminology: string[],
): number {
  const all = [...domainVocabulary, ...strategicTerminology];
  if (all.length === 0) return 100;
  const plannerLower = planText(plan).toLowerCase();
  let preserved = 0;
  for (const term of all) {
    if (term.trim().length === 0) { preserved += 1; continue; }
    if (plannerLower.includes(term.toLowerCase())) preserved += 1;
  }
  return pct(preserved / all.length);
}

function scoreCapabilityEmphasis(plan: ContentPlan, recommendation: LongFormRecommendation): number {
  const capability = recommendation.whyThisFitsCompany.capabilityConnection;
  if (capability.trim().length < 10) return 100;
  // Token-overlap based: the recommendation and the plan often phrase the
  // capability slightly differently ("decision-level traces" vs "decision traces"),
  // so an exact substring match is over-strict. We measure (a) overall token
  // coverage across the full plan and (b) section-level echo.
  const overallOverlap = tokenOverlapRatio(capability, planText(plan));
  const sectionHits = plan.sections.filter((s) =>
    tokenOverlapRatio(capability, `${s.section_goal} ${s.unique_angle} ${(s.key_points ?? []).join(' ')}`) >= 0.25,
  ).length;
  // Base score = overall token coverage scaled (60% if all tokens present).
  const base = Math.min(60, overallOverlap * 100 * 0.7);
  // Bonus for echoing the capability across multiple sections.
  const echo = Math.min(40, sectionHits * 10);
  return pct((base + echo) / 100);
}

function scoreBuyerStageContinuity(plan: ContentPlan, stage: TargetBuyerStage): number {
  const targets = plan.sections.map((s) => Number(s.word_target ?? 0)).filter((n) => n > 0);
  if (targets.length === 0) return 70;
  const total = targets.reduce((a, b) => a + b, 0);
  // Awareness sections short; decision/expansion sections longer & meatier.
  const expected = stage === 'awareness' ? [800, 1400]
    : stage === 'consideration' ? [1000, 1800]
    : stage === 'evaluation' ? [1200, 2200]
    : stage === 'decision' ? [1400, 2600]
    : [1600, 3200];
  const [min, max] = expected;
  if (total >= min && total <= max) return 100;
  if (total < min) {
    const ratio = total / min;
    return pct(ratio);
  }
  // total > max — diminishing returns
  return pct(Math.max(0.5, max / total));
}

// ────────────────────────────────────────────────────────────────────────────
// Detections
// ────────────────────────────────────────────────────────────────────────────

const SOFT_LANGUAGE = [
  'might consider','could think about','generally','sometimes','often',
  'in general','high-level','overview','introduction to','basics of',
];

function detect(
  preserved: PlannerGenerationContinuityResult['preserved'],
  plan: ContentPlan,
  recommendation: LongFormRecommendation,
): PlannerGenerationContinuityResult['detections'] {
  const out: PlannerGenerationContinuityResult['detections'] = [];

  // PLANNER_SIMPLIFICATION
  const depthBlob = plan.sections.map((s) => s.depth_requirement ?? '').join(' ').toLowerCase();
  const softHits = SOFT_LANGUAGE.filter((p) => depthBlob.includes(p));
  if (softHits.length >= 2 || preserved.operationalLogic < 50) {
    out.push({
      type: 'PLANNER_SIMPLIFICATION',
      detail: softHits.length > 0
        ? `Soft language detected in section depth_requirement: ${softHits.slice(0, 3).join(', ')}.`
        : `Operational logic preservation only ${preserved.operationalLogic}%.`,
      severity: preserved.operationalLogic < 35 ? 'high' : 'medium',
    });
  }

  // NARRATIVE_FLATTENING
  if (preserved.strategicSequencing < 60) {
    out.push({
      type: 'NARRATIVE_FLATTENING',
      detail: `Plan lost the staged progression — strategic sequencing ${preserved.strategicSequencing}%. Sections appear to be a flat list.`,
      severity: preserved.strategicSequencing < 40 ? 'high' : 'medium',
    });
  }

  // STRATEGIC_DILUTION
  if (preserved.terminologyIntegrity < 50) {
    out.push({
      type: 'STRATEGIC_DILUTION',
      detail: `Domain/strategic terminology preserved only ${preserved.terminologyIntegrity}% — plan replaced specific terms with generics.`,
      severity: preserved.terminologyIntegrity < 30 ? 'high' : 'medium',
    });
  }

  // OPERATIONAL_ABSTRACTION
  if (preserved.operationalLogic < 60 && recommendation.recommendedContentDirection.operationalProof.length > 0) {
    out.push({
      type: 'OPERATIONAL_ABSTRACTION',
      detail: `Operational proof items not echoed in section goals (${preserved.operationalLogic}%). Plan abstracted away the concrete steps.`,
      severity: preserved.operationalLogic < 40 ? 'high' : 'medium',
    });
  }

  // CAPABILITY_SUPPRESSION
  if (preserved.capabilityEmphasis < 50) {
    out.push({
      type: 'CAPABILITY_SUPPRESSION',
      detail: `Capability "${recommendation.whyThisFitsCompany.capabilityConnection.slice(0, 80)}" suppressed in plan (${preserved.capabilityEmphasis}%).`,
      severity: preserved.capabilityEmphasis < 30 ? 'high' : 'medium',
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export function analyzePlannerGenerationContinuity(input: {
  recommendation: LongFormRecommendation;
  contentPlan: ContentPlan;
  domainVocabulary?: string[];
  strategicTerminology?: string[];
}): PlannerGenerationContinuityResult {
  const preserved = {
    strategicSequencing: scoreStrategicSequencing(input.contentPlan),
    editorialIntent: scoreEditorialIntent(input.contentPlan, input.recommendation),
    operationalLogic: scoreOperationalLogic(input.contentPlan, input.recommendation),
    terminologyIntegrity: scoreTerminologyIntegrity(
      input.contentPlan,
      input.domainVocabulary ?? [],
      input.strategicTerminology ?? [],
    ),
    capabilityEmphasis: scoreCapabilityEmphasis(input.contentPlan, input.recommendation),
    buyerStageContinuity: scoreBuyerStageContinuity(input.contentPlan, input.recommendation.targetBuyerStage),
  };

  const plannerGenerationContinuityScore = Math.round(
    preserved.strategicSequencing * 0.18
    + preserved.editorialIntent * 0.16
    + preserved.operationalLogic * 0.20
    + preserved.terminologyIntegrity * 0.14
    + preserved.capabilityEmphasis * 0.20
    + preserved.buyerStageContinuity * 0.12,
  );

  return {
    plannerGenerationContinuityScore,
    preserved,
    detections: detect(preserved, input.contentPlan, input.recommendation),
  };
}

export type { PlannerContinuityDetectionType };
