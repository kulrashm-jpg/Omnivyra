/**
 * Autonomous Creative Optimizer + Experimentation Engine + Auto-Ops
 * (Phases 3 + 6 + 8).
 *
 * Lightweight deterministic optimization layer that adjusts per-asset
 * planning + retry behavior based on aggregated telemetry signals
 * surfaced by `creatorPerformanceTelemetry`. NOT model training. NOT
 * ML inference. Pure heuristic adaptation.
 *
 * Cost-bounded everywhere (Phase 11):
 *   - max 1 active experiment per org (deterministic single-arm
 *     selection)
 *   - max 24 strategy weight adjustments cached per org
 *   - per-call optimization decisions cap at 4 directives
 *   - all autonomous behavior is reversible (weights nudge, never
 *     disable)
 *
 * Provider-agnostic. Pure (no DB, no fetch).
 */

import type { CreativeStrategyId } from './creativeDirectorEngine';
import {
  computeOrgStrategicMemory,
  computeHumanPreferenceSnapshot,
  type OrgStrategicMemory,
  type HumanPreferenceSnapshot,
} from './creatorPerformanceTelemetry';

/* ── Strategy weight directive ──────────────────────────────────────── */

export type StrategyWeightDirective = {
  strategy: CreativeStrategyId;
  weight: number; // 0 (suppress) → 1 (neutral) → 2 (favor)
  reason: string;
};

export type OptimizationDirective = {
  /** Composer mutation hints — these layer on top of the per-asset plan. */
  mutations: {
    promoteToPremium?: boolean;
    forceBrandAware?: boolean;
    suppressHumanPresence?: boolean;
    intensifyRealism?: boolean;
    intensifySuppression?: boolean;
  };
  /** Per-strategy weight nudges for variant selection. */
  strategyWeights: ReadonlyArray<StrategyWeightDirective>;
  /** Preferred emotional direction from learned signals. */
  preferredEmotionalDirection: string | null;
  /** Preferred realism profile from learned signals. */
  preferredRealismProfile: string | null;
  /** Audit envelope. */
  rationale: ReadonlyArray<string>;
};

/* ── Autonomous optimization ────────────────────────────────────────── */

const MAX_DIRECTIVES = 4;
const STRATEGY_WEIGHT_FLOOR = 0.25;     // never fully suppress a strategy
const STRATEGY_WEIGHT_CEILING = 2.0;
const POSITIVE_NUDGE = 0.4;
const NEGATIVE_NUDGE = -0.35;

export function computeOptimizationDirective(input: {
  companyId: string | null | undefined;
  /** Current per-asset plan (informational; the optimizer uses it
   *  only for diagnostics — actual strategy selection still flows
   *  through the planner). */
  currentStrategy?: CreativeStrategyId | null;
}): OptimizationDirective {
  const rationale: string[] = [];
  const mutations: OptimizationDirective['mutations'] = {};
  const strategyWeights: StrategyWeightDirective[] = [];

  if (!input.companyId) {
    rationale.push('no_company_id:neutral_directive');
    return { mutations, strategyWeights, preferredEmotionalDirection: null, preferredRealismProfile: null, rationale };
  }

  const memory = computeOrgStrategicMemory(input.companyId);
  const humanPrefs = computeHumanPreferenceSnapshot(input.companyId);

  if (!memory) {
    rationale.push('no_strategic_memory:neutral_directive');
    return { mutations, strategyWeights, preferredEmotionalDirection: null, preferredRealismProfile: null, rationale };
  }

  // Phase 3 — strategy weight nudges from telemetry.
  for (const eff of memory.topStrategies.slice(0, MAX_DIRECTIVES)) {
    if (eff.samples < 2) continue;
    let weight = 1.0;
    // Boost successful strategies.
    if (eff.successRate > 0.65) {
      weight = Math.min(STRATEGY_WEIGHT_CEILING, 1.0 + POSITIVE_NUDGE);
      strategyWeights.push({
        strategy: eff.strategy,
        weight,
        reason: `success_rate_${eff.successRate.toFixed(2)}_over_${eff.samples}_samples`,
      });
    }
    // Down-weight under-performing strategies (never below floor).
    else if (memory.underperformingStrategies.includes(eff.strategy)) {
      weight = Math.max(STRATEGY_WEIGHT_FLOOR, 1.0 + NEGATIVE_NUDGE);
      strategyWeights.push({
        strategy: eff.strategy,
        weight,
        reason: `underperforming_regen_rate_${eff.regenerationRate.toFixed(2)}_qa_${eff.averageQaScore.toFixed(0)}`,
      });
    }
  }

  // Phase 5 — human preference reinforcement.
  if (humanPrefs) {
    for (const preferred of humanPrefs.preferredStrategies.slice(0, 2)) {
      const existing = strategyWeights.find((w) => w.strategy === preferred);
      if (existing) {
        existing.weight = Math.min(STRATEGY_WEIGHT_CEILING, existing.weight + 0.15);
        existing.reason = `${existing.reason}; human_thumbs_up_reinforcement`;
      } else {
        strategyWeights.push({
          strategy: preferred,
          weight: Math.min(STRATEGY_WEIGHT_CEILING, 1.0 + 0.25),
          reason: 'human_thumbs_up_reinforcement',
        });
      }
    }
    for (const unfavored of humanPrefs.unfavoredStrategies.slice(0, 2)) {
      const existing = strategyWeights.find((w) => w.strategy === unfavored);
      if (existing) {
        existing.weight = Math.max(STRATEGY_WEIGHT_FLOOR, existing.weight - 0.2);
        existing.reason = `${existing.reason}; human_thumbs_down_dampening`;
      } else {
        strategyWeights.push({
          strategy: unfavored,
          weight: Math.max(STRATEGY_WEIGHT_FLOOR, 1.0 - 0.3),
          reason: 'human_thumbs_down_dampening',
        });
      }
    }
  }

  // Phase 8 — auto-corrective mutations.
  // When the org's average QA across strategies is low, mandate
  // realism intensification + brand-aware mode for the next render.
  const avgQa = memory.topStrategies.reduce((sum, s) => sum + s.averageQaScore, 0) / Math.max(1, memory.topStrategies.length);
  if (avgQa < 60 && memory.totalEvents >= 4) {
    mutations.intensifyRealism = true;
    mutations.promoteToPremium = true;
    rationale.push(`auto_corrective:low_avg_qa_${avgQa.toFixed(0)}`);
  }
  // When the org has a high regeneration rate, mandate suppression
  // intensification to address the most common cause.
  const avgRegenRate = memory.topStrategies.reduce((sum, s) => sum + s.regenerationRate, 0) / Math.max(1, memory.topStrategies.length);
  if (avgRegenRate > 0.4 && memory.totalEvents >= 4) {
    mutations.intensifySuppression = true;
    rationale.push(`auto_corrective:high_regen_rate_${avgRegenRate.toFixed(2)}`);
  }
  // When the org has a clear best emotional direction, mandate
  // brand-aware mode so the brand layer reinforces the preferred lane.
  if (memory.bestEmotionalDirection) {
    mutations.forceBrandAware = true;
    rationale.push(`auto_corrective:preferred_emotional_lane_${memory.bestEmotionalDirection}`);
  }

  rationale.push(`strategic_memory:${memory.totalEvents}_events`);
  if (humanPrefs && humanPrefs.thumbsUpCount + humanPrefs.thumbsDownCount > 0) {
    rationale.push(`human_signals:+${humanPrefs.thumbsUpCount}/-${humanPrefs.thumbsDownCount}`);
  }

  return {
    mutations,
    strategyWeights: strategyWeights.slice(0, MAX_DIRECTIVES),
    preferredEmotionalDirection: memory.bestEmotionalDirection,
    preferredRealismProfile: memory.bestRealismProfile,
    rationale,
  };
}

/* ── Phase 6 — Creative experimentation engine ──────────────────────── */

export type ExperimentArm = 'control' | 'variant';

export type ExperimentDefinition = {
  experimentId: string;
  companyId: string;
  hypothesis: string;
  controlStrategy: CreativeStrategyId;
  variantStrategy: CreativeStrategyId;
  maxSamples: number;
  startedAt: string;
};

export type ExperimentAssignment = {
  experimentId: string;
  arm: ExperimentArm;
  strategy: CreativeStrategyId;
  sampleIndex: number;
  reason: string;
};

/**
 * Bounded experiment registry — one active experiment per org. Future
 * surfaces can register multiple via a different orchestration layer,
 * but the autonomous optimizer treats experiments as MUTUALLY EXCLUSIVE
 * to keep variance interpretable and cost bounded.
 */
const ACTIVE_EXPERIMENTS = new Map<string, ExperimentDefinition>();
const EXPERIMENT_SAMPLE_COUNTS = new Map<string, { control: number; variant: number }>();
const EXPERIMENT_MAX_SAMPLES_DEFAULT = 24;

export function registerExperiment(definition: Omit<ExperimentDefinition, 'startedAt'>): ExperimentDefinition {
  const def: ExperimentDefinition = {
    ...definition,
    maxSamples: Math.min(EXPERIMENT_MAX_SAMPLES_DEFAULT, definition.maxSamples || EXPERIMENT_MAX_SAMPLES_DEFAULT),
    startedAt: new Date().toISOString(),
  };
  ACTIVE_EXPERIMENTS.set(def.companyId.trim().toLowerCase(), def);
  EXPERIMENT_SAMPLE_COUNTS.set(def.experimentId, { control: 0, variant: 0 });
  return def;
}

export function getActiveExperiment(companyId: string | null | undefined): ExperimentDefinition | null {
  if (!companyId) return null;
  return ACTIVE_EXPERIMENTS.get(companyId.trim().toLowerCase()) ?? null;
}

export function assignExperimentArm(companyId: string | null | undefined): ExperimentAssignment | null {
  const def = getActiveExperiment(companyId);
  if (!def) return null;
  const counts = EXPERIMENT_SAMPLE_COUNTS.get(def.experimentId);
  if (!counts) return null;
  const totalSamples = counts.control + counts.variant;
  if (totalSamples >= def.maxSamples) {
    return null; // experiment is at sample cap
  }
  // Deterministic balanced assignment: alternate arms to keep variance
  // tight on bounded sample sizes. Round-robin instead of random.
  const arm: ExperimentArm = counts.control <= counts.variant ? 'control' : 'variant';
  if (arm === 'control') counts.control++;
  else counts.variant++;
  return {
    experimentId: def.experimentId,
    arm,
    strategy: arm === 'control' ? def.controlStrategy : def.variantStrategy,
    sampleIndex: totalSamples,
    reason: `experiment_${def.experimentId}:arm_${arm}:sample_${totalSamples}`,
  };
}

export function clearAllExperiments(): void {
  ACTIVE_EXPERIMENTS.clear();
  EXPERIMENT_SAMPLE_COUNTS.clear();
}

/* ── Phase 8 — Autonomous operational behaviors ─────────────────────── */

export type AutonomousOperationOutcome = {
  action: 'auto_suppress_weak' | 'auto_promote_strong' | 'auto_retry_malformed' | 'auto_escalate_governance' | 'auto_reduce_failed_strategy' | 'none';
  reason: string;
};

export function decideAutonomousOperation(input: {
  qaScore: number;
  qaSeverity: 'pass' | 'warning' | 'fail' | 'reject';
  governanceScore: number;
  governanceRejected: boolean;
  aestheticBucket: 'premium' | 'good' | 'acceptable' | 'weak' | 'low';
}): AutonomousOperationOutcome {
  if (input.governanceRejected) {
    return { action: 'auto_escalate_governance', reason: 'governance_hard_reject' };
  }
  if (input.qaSeverity === 'reject') {
    return { action: 'auto_escalate_governance', reason: `qa_reject_at_${input.qaScore}` };
  }
  if (input.qaSeverity === 'fail') {
    return { action: 'auto_retry_malformed', reason: `qa_fail_at_${input.qaScore}` };
  }
  if (input.aestheticBucket === 'low' || input.aestheticBucket === 'weak') {
    return { action: 'auto_suppress_weak', reason: `aesthetic_bucket_${input.aestheticBucket}` };
  }
  if (input.governanceScore < 60) {
    return { action: 'auto_reduce_failed_strategy', reason: `governance_score_${input.governanceScore}` };
  }
  if (input.aestheticBucket === 'premium' && input.qaScore >= 80) {
    return { action: 'auto_promote_strong', reason: `premium_aesthetic_and_qa_${input.qaScore}` };
  }
  return { action: 'none', reason: 'all_signals_within_band' };
}
