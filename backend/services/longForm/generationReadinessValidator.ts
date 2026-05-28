/**
 * Phase 2 — Generation readiness validator.
 *
 * Aggregates every available signal into 10 readiness dimensions, computes a
 * weighted overall score, and assigns a band:
 *   < 35  → blocked
 *   35–54 → weak
 *   55–74 → acceptable
 *   75–89 → strong
 *   ≥ 90  → exceptional
 *
 * `blocked` means generation MUST NOT proceed automatically. The execution
 * gate enforces this (Phase 3).
 *
 * Dimensions and their input sources:
 *
 *   1. continuityIntegrity            ← upstream continuity score (from handoff)
 *   2. semanticPreservation           ← upstream semantic continuity score
 *   3. strategicIntegrity             ← planner continuity preserved.strategicSequencing × editorial
 *   4. operationalSpecificity         ← planner continuity preserved.operationalLogic + recommendation.operationalDepth
 *   5. icpPreservation                ← upstream icpPreservation signal (from semantic analyzer)
 *   6. capabilityPreservation         ← planner continuity preserved.capabilityEmphasis
 *   7. narrativeFamilyPreservation    ← planner archetype match
 *   8. terminologyPreservation        ← planner continuity preserved.terminologyIntegrity
 *   9. inheritanceCompleteness        ← upstream inheritance score (from handoff)
 *  10. plannerCoherence               ← planner output well-formedness (sections, framework, faq, evidence)
 */

import type {
  GenerationReadinessAssessment,
  GenerationReadinessBand,
  LongFormRecommendation,
  PlannerGenerationContinuityResult,
} from './longFormRecommendationTypes';
import type { ContentPlan } from '../../../lib/content/longFormPlanningEngine';

const WEIGHTS = {
  continuityIntegrity: 0.10,
  semanticPreservation: 0.12,
  strategicIntegrity: 0.12,
  operationalSpecificity: 0.14,
  icpPreservation: 0.10,
  capabilityPreservation: 0.12,
  narrativeFamilyPreservation: 0.06,
  terminologyPreservation: 0.06,
  inheritanceCompleteness: 0.10,
  plannerCoherence: 0.08,
} as const;

const DIMENSION_FLOORS = {
  continuityIntegrity: 50,
  semanticPreservation: 50,
  strategicIntegrity: 50,
  operationalSpecificity: 55,
  icpPreservation: 50,
  capabilityPreservation: 50,
  narrativeFamilyPreservation: 40,
  terminologyPreservation: 40,
  inheritanceCompleteness: 60,
  plannerCoherence: 60,
} as const;

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function scorePlannerCoherence(plan: ContentPlan): number {
  let score = 30;
  if (plan.title && plan.title.length >= 20) score += 8;
  if (plan.excerpt && plan.excerpt.length >= 60) score += 6;
  if (plan.sections.length >= 4) score += 12;
  if (plan.sections.length >= 5) score += 4;
  if (plan.key_insights.length >= 3) score += 8;
  if (plan.framework?.name && plan.framework.components?.length >= 3) score += 10;
  if ((plan.faq?.length ?? 0) >= 4) score += 8;
  if ((plan.evidence_plan?.length ?? 0) >= 2) score += 6;
  // Penalize duplicate section goals (loose check).
  const goals = new Set(plan.sections.map((s) => (s.section_goal ?? '').toLowerCase().slice(0, 40)));
  if (goals.size < plan.sections.length) score -= 12;
  return clamp100(score);
}

function scoreNarrativeFamilyPreservation(
  recommendation: LongFormRecommendation,
  plan: ContentPlan,
): number {
  // Re-detect archetype proxy on the plan's title + excerpt + first sections.
  if (!recommendation.narrativeArchetype || recommendation.narrativeArchetype === 'uncategorized') return 75;
  const planLower = `${plan.title} ${plan.excerpt} ${plan.sections.slice(0, 3).map((s) => `${s.section_title} ${s.unique_angle}`).join(' ')}`.toLowerCase();
  // Coarse keyword test per archetype family.
  const archetypeKeywords: Record<string, string[]> = {
    observability: ['observability', 'telemetry', 'monitoring', 'tracing', 'visibility'],
    governance: ['governance', 'policy', 'compliance', 'audit'],
    workflow_fragmentation: ['fragmented', 'silo', 'scattered', 'fragmentation', 'workflow'],
    evaluation_maturity: ['evaluation', 'eval', 'benchmark', 'regression'],
    orchestration: ['orchestrate', 'orchestration', 'coordination', 'pipeline'],
    operational_efficiency: ['efficiency', 'productivity', 'cycle time', 'cost'],
    scaling_bottleneck: ['scale', 'scaling', 'bottleneck', 'throughput'],
    ai_adoption_risk: ['risk', 'hallucination', 'safety', 'adoption'],
    transformation_path: ['transformation', 'journey', 'migration', 'shift'],
    authority_positioning: ['authority', 'leadership', 'definitive'],
    comparative_decision: [' vs ', 'versus', 'comparison'],
    category_definition: ['what is', 'category', 'introducing', 'new model'],
  };
  const words = archetypeKeywords[recommendation.narrativeArchetype] ?? [];
  const matchCount = words.filter((w) => planLower.includes(w)).length;
  if (matchCount === 0) return 25;
  if (matchCount === 1) return 55;
  return clamp100(70 + Math.min(30, matchCount * 8));
}

function bandFor(score: number): GenerationReadinessBand {
  if (score < 35) return 'blocked';
  if (score < 55) return 'weak';
  if (score < 75) return 'acceptable';
  if (score < 90) return 'strong';
  return 'exceptional';
}

export interface AssessGenerationReadinessInput {
  recommendation: LongFormRecommendation;
  contentPlan: ContentPlan;
  upstream: {
    continuityScore: number;
    semanticContinuityScore: number;
    icpEntityPreservation: number;
    inheritanceCompletenessScore: number;
  };
  plannerContinuity: PlannerGenerationContinuityResult;
}

export function assessGenerationReadiness(
  input: AssessGenerationReadinessInput,
): GenerationReadinessAssessment {
  const dimensionScores: GenerationReadinessAssessment['dimensionScores'] = {
    continuityIntegrity: clamp100(input.upstream.continuityScore),
    semanticPreservation: clamp100(input.upstream.semanticContinuityScore),
    strategicIntegrity: clamp100(
      input.plannerContinuity.preserved.strategicSequencing * 0.6
      + input.plannerContinuity.preserved.editorialIntent * 0.4,
    ),
    operationalSpecificity: clamp100(
      input.plannerContinuity.preserved.operationalLogic * 0.6
      + input.recommendation.operationalDepthScore * 0.4,
    ),
    icpPreservation: clamp100(input.upstream.icpEntityPreservation),
    capabilityPreservation: input.plannerContinuity.preserved.capabilityEmphasis,
    narrativeFamilyPreservation: scoreNarrativeFamilyPreservation(input.recommendation, input.contentPlan),
    terminologyPreservation: input.plannerContinuity.preserved.terminologyIntegrity,
    inheritanceCompleteness: clamp100(input.upstream.inheritanceCompletenessScore),
    plannerCoherence: scorePlannerCoherence(input.contentPlan),
  };

  let weighted = 0;
  (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach((k) => {
    weighted += dimensionScores[k] * WEIGHTS[k];
  });
  const generationReadinessScore = clamp100(weighted);

  const failingDimensions: GenerationReadinessAssessment['failingDimensions'] = [];
  (Object.keys(DIMENSION_FLOORS) as Array<keyof typeof DIMENSION_FLOORS>).forEach((k) => {
    if (dimensionScores[k] < DIMENSION_FLOORS[k]) {
      failingDimensions.push({
        dimension: k,
        score: dimensionScores[k],
        minimumRequired: DIMENSION_FLOORS[k],
      });
    }
  });

  return {
    generationReadinessScore,
    readinessBand: bandFor(generationReadinessScore),
    dimensionScores,
    failingDimensions,
  };
}

export { DIMENSION_FLOORS };
