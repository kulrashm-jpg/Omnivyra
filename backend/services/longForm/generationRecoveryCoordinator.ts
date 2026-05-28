/**
 * Phase 5 — Generation recovery coordinator.
 *
 * Maps gate failures + planner-continuity detections to targeted recovery
 * strategies. Strategies should rebuild only what's broken — full pipeline
 * restart is the last resort.
 *
 * Strategies (ordered cheapest first):
 *   1. terminology_reinforcement       — cheapest, no LLM
 *   2. operational_proof_restoration   — cheap, re-injection
 *   3. icp_re_anchoring                — cheap, re-injection
 *   4. capability_emphasis_restoration — cheap, re-injection
 *   5. strategic_narrative_restoration — medium, planner-prompt edit
 *   6. recommendation_rehydration      — medium, re-derive editorial context
 *   7. planner_regeneration            — expensive, re-runs the planner
 */

import type {
  GenerationGateDecision,
  GenerationReadinessAssessment,
  PlannerGenerationContinuityResult,
  RecoveryAttemptPlan,
  RecoveryAttemptStep,
  RecoveryRecommendationItem,
  RecoveryStrategy,
} from './longFormRecommendationTypes';

// ────────────────────────────────────────────────────────────────────────────
// Strategy metadata
// ────────────────────────────────────────────────────────────────────────────

interface StrategyMeta {
  estimatedLikelihoodOfSuccess: 'low' | 'medium' | 'high';
  estimatedCost: 'low' | 'medium' | 'high';
  recovers: string[]; // dimensions / detection types it can recover
}

const STRATEGY_META: Record<RecoveryStrategy, StrategyMeta> = {
  terminology_reinforcement: {
    estimatedLikelihoodOfSuccess: 'high',
    estimatedCost: 'low',
    recovers: ['terminologyPreservation', 'STRATEGIC_DILUTION'],
  },
  operational_proof_restoration: {
    estimatedLikelihoodOfSuccess: 'high',
    estimatedCost: 'low',
    recovers: ['operationalSpecificity', 'OPERATIONAL_ABSTRACTION', 'PLANNER_SIMPLIFICATION'],
  },
  icp_re_anchoring: {
    estimatedLikelihoodOfSuccess: 'high',
    estimatedCost: 'low',
    recovers: ['icpPreservation', 'ICP_EROSION'],
  },
  capability_emphasis_restoration: {
    estimatedLikelihoodOfSuccess: 'high',
    estimatedCost: 'low',
    recovers: ['capabilityPreservation', 'CAPABILITY_SUPPRESSION'],
  },
  strategic_narrative_restoration: {
    estimatedLikelihoodOfSuccess: 'medium',
    estimatedCost: 'medium',
    recovers: ['strategicIntegrity', 'narrativeFamilyPreservation', 'NARRATIVE_FLATTENING'],
  },
  recommendation_rehydration: {
    estimatedLikelihoodOfSuccess: 'medium',
    estimatedCost: 'medium',
    recovers: ['continuityIntegrity', 'semanticPreservation', 'inheritanceCompleteness'],
  },
  planner_regeneration: {
    estimatedLikelihoodOfSuccess: 'medium',
    estimatedCost: 'high',
    recovers: ['plannerCoherence', 'strategicIntegrity', 'operationalSpecificity', 'capabilityPreservation', 'terminologyPreservation'],
  },
};

const FAILING_DIMENSION_TO_STRATEGIES: Record<string, RecoveryStrategy[]> = {
  continuityIntegrity: ['recommendation_rehydration', 'planner_regeneration'],
  semanticPreservation: ['recommendation_rehydration', 'planner_regeneration'],
  strategicIntegrity: ['strategic_narrative_restoration', 'planner_regeneration'],
  operationalSpecificity: ['operational_proof_restoration', 'planner_regeneration'],
  icpPreservation: ['icp_re_anchoring', 'recommendation_rehydration'],
  capabilityPreservation: ['capability_emphasis_restoration', 'planner_regeneration'],
  narrativeFamilyPreservation: ['strategic_narrative_restoration', 'planner_regeneration'],
  terminologyPreservation: ['terminology_reinforcement', 'planner_regeneration'],
  inheritanceCompleteness: ['recommendation_rehydration', 'planner_regeneration'],
  plannerCoherence: ['planner_regeneration'],
};

const DETECTION_TO_STRATEGIES: Record<string, RecoveryStrategy[]> = {
  PLANNER_SIMPLIFICATION: ['operational_proof_restoration', 'planner_regeneration'],
  NARRATIVE_FLATTENING: ['strategic_narrative_restoration', 'planner_regeneration'],
  STRATEGIC_DILUTION: ['terminology_reinforcement', 'strategic_narrative_restoration'],
  OPERATIONAL_ABSTRACTION: ['operational_proof_restoration', 'planner_regeneration'],
  CAPABILITY_SUPPRESSION: ['capability_emphasis_restoration', 'planner_regeneration'],
};

const STRATEGY_ORDER: RecoveryStrategy[] = [
  'terminology_reinforcement',
  'operational_proof_restoration',
  'icp_re_anchoring',
  'capability_emphasis_restoration',
  'strategic_narrative_restoration',
  'recommendation_rehydration',
  'planner_regeneration',
];

// ────────────────────────────────────────────────────────────────────────────
// Recovery builder
// ────────────────────────────────────────────────────────────────────────────

export interface BuildRecoveryInput {
  readiness: GenerationReadinessAssessment;
  plannerContinuity: PlannerGenerationContinuityResult;
  gateDecision: GenerationGateDecision;
}

export interface BuildRecoveryResult {
  recoveryRecommendations: RecoveryRecommendationItem[];
  recoveryAttemptPlan: RecoveryAttemptPlan;
}

function reasonForStrategy(strategy: RecoveryStrategy, targets: string[]): string {
  switch (strategy) {
    case 'terminology_reinforcement':
      return `Re-inject domain + strategic terminology so the planner section text echoes the recommendation vocabulary. Targets: ${targets.join(', ')}.`;
    case 'operational_proof_restoration':
      return `Append recommendation operational proof items to each section's depth_requirement and unique_angle. Targets: ${targets.join(', ')}.`;
    case 'icp_re_anchoring':
      return `Re-anchor sections to the recommendation's ICP problem mapping. Targets: ${targets.join(', ')}.`;
    case 'capability_emphasis_restoration':
      return `Force the recommended capability into every section's section_goal. Targets: ${targets.join(', ')}.`;
    case 'strategic_narrative_restoration':
      return `Restore the recommendation's strategic narrative arc into the planner prompt. Targets: ${targets.join(', ')}.`;
    case 'recommendation_rehydration':
      return `Re-derive the editorial context from the original recommendation foundation. Targets: ${targets.join(', ')}.`;
    case 'planner_regeneration':
      return `Re-run the planner with stricter constraints. Targets: ${targets.join(', ')}.`;
  }
}

export function buildRecoveryPlan(input: BuildRecoveryInput): BuildRecoveryResult {
  const failingDims = input.readiness.failingDimensions.map((d) => String(d.dimension));
  const detectionTypes = input.plannerContinuity.detections
    .filter((d) => d.severity === 'high' || d.severity === 'medium')
    .map((d) => d.type);

  // 1. Collect candidate strategies with target lists.
  const candidates = new Map<RecoveryStrategy, Set<string>>();

  for (const dim of failingDims) {
    const strategies = FAILING_DIMENSION_TO_STRATEGIES[dim] ?? [];
    for (const s of strategies) {
      if (!candidates.has(s)) candidates.set(s, new Set());
      candidates.get(s)!.add(dim);
    }
  }
  for (const det of detectionTypes) {
    const strategies = DETECTION_TO_STRATEGIES[det] ?? [];
    for (const s of strategies) {
      if (!candidates.has(s)) candidates.set(s, new Set());
      candidates.get(s)!.add(det);
    }
  }

  if (candidates.size === 0) {
    // No failures — empty plan.
    return {
      recoveryRecommendations: [],
      recoveryAttemptPlan: { attempts: [], totalEstimatedCost: 'low', fallbackToFullPipeline: false },
    };
  }

  // 2. Build RecoveryRecommendationItem[].
  const recommendations: RecoveryRecommendationItem[] = STRATEGY_ORDER
    .filter((s) => candidates.has(s))
    .map((s) => {
      const targets = Array.from(candidates.get(s)!);
      const meta = STRATEGY_META[s];
      return {
        strategy: s,
        targetDimensions: targets,
        reason: reasonForStrategy(s, targets),
        estimatedLikelihoodOfSuccess: meta.estimatedLikelihoodOfSuccess,
        estimatedCost: meta.estimatedCost,
      };
    });

  // 3. Build a layered attempt plan: low-cost first, with skipIf conditions
  //    so the next step can short-circuit once readiness is restored.
  const attempts: RecoveryAttemptStep[] = [];
  let order = 1;
  // Deduplicate the targets union of cheap fixes so each is tried before any
  // expensive strategy.
  const remainingTargets = new Set<string>();
  candidates.forEach((set) => set.forEach((t) => remainingTargets.add(t)));

  for (const rec of recommendations) {
    if (rec.estimatedCost === 'high') continue;
    const willRecover = rec.targetDimensions.filter((t) => remainingTargets.has(t));
    if (willRecover.length === 0) continue;
    attempts.push({
      order: order++,
      strategy: rec.strategy,
      expectedDimensionsRecovered: willRecover,
      skipIfConditionsMet: ['readinessBand >= acceptable', 'no critical detections remaining'],
    });
    willRecover.forEach((t) => remainingTargets.delete(t));
  }

  // Add a planner_regeneration fallback only if cheap strategies don't cover
  // everything (e.g. plannerCoherence requires the planner to be re-run).
  const needsPlannerRegen = remainingTargets.size > 0
    || failingDims.includes('plannerCoherence')
    || recommendations.some((r) => r.strategy === 'planner_regeneration');
  if (needsPlannerRegen) {
    attempts.push({
      order: order++,
      strategy: 'planner_regeneration',
      expectedDimensionsRecovered: Array.from(new Set([...remainingTargets, ...(failingDims.includes('plannerCoherence') ? ['plannerCoherence'] : [])])),
      skipIfConditionsMet: ['previous attempts restored readinessBand to strong'],
    });
  }

  // 4. Aggregate cost.
  const totalCost: BuildRecoveryResult['recoveryAttemptPlan']['totalEstimatedCost'] = (() => {
    if (attempts.some((a) => STRATEGY_META[a.strategy].estimatedCost === 'high')) return 'high';
    if (attempts.some((a) => STRATEGY_META[a.strategy].estimatedCost === 'medium')) return 'medium';
    return 'low';
  })();

  return {
    recoveryRecommendations: recommendations,
    recoveryAttemptPlan: {
      attempts,
      totalEstimatedCost: totalCost,
      fallbackToFullPipeline: input.gateDecision.generationBlockReasons.some((r) => r.severity === 'critical')
        && input.readiness.readinessBand === 'blocked',
    },
  };
}
