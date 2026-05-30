/**
 * Campaign Multi-Variant Fan-Out Runner (Campaign Multi-Variant
 * Execution Completion — Phase 2 + Phase 4 + Phase 5 + Phase 6).
 *
 * Single shared helper invoked by the two campaign-aware generation
 * entry points (Direct API + queue worker). Loops over the planner's
 * decisions, calling `runCreatorOrchestration` once per decision so:
 *
 *   single_variant  → 1 invocation
 *   best_variant    → 1 invocation
 *   top_3_variants  → N invocations (≤ 3)
 *   experiment      → N invocations (≤ 3)
 *
 * Each invocation receives its OWN `appliedVariant`, so the
 * orchestrator's existing variant-merge logic + generation telemetry
 * + `notifyExperimentAssetGenerated` fire per-asset. The fan-out
 * runner itself does NOT touch governance, scheduling, publishing,
 * analytics, or the renderer pipeline — it is a thin loop around
 * the canonical orchestrator.
 *
 * Backward compatibility (Phase 6):
 *   - When the resolved plan has exactly 1 decision (single_variant /
 *     best_variant) the runner returns the same single-asset shape
 *     callers already consume.
 *   - When the plan has > 1 decisions, the runner additionally
 *     populates `generated_assets[]` so multi-variant callers can
 *     iterate without breaking single-variant ones.
 *
 * Errors:
 *   - If ANY asset fails to generate, that decision is recorded with
 *     `ok=false` + reason and the runner continues with remaining
 *     decisions. Partial success returns; the caller decides how to
 *     surface partial failures.
 */

import {
  runCreatorOrchestration,
  type CreatorOrchestrationInput,
  type CreatorOrchestrationResult,
} from './creatorOrchestrator';
import type { CampaignVariantPlan } from './campaignVariantApplier';

export type CampaignFanOutAssetResult = {
  /** Rank from the planner — 1-indexed. */
  rank: number;
  variant_id: string;
  variant_family: string;
  strategy_id: string;
  /** When the plan was an `experiment` fan-out, this is the tracker
   *  id the asset belongs to. Null for non-experiment modes. */
  experiment_id: string | null;
  /** Reasoning string from the planner. */
  reasoning: string;
  /** Orchestrator output (success). */
  result: CreatorOrchestrationResult | null;
  /** When generation failed, this is the failure reason. */
  ok: boolean;
  error?: string;
};

export type CampaignFanOutResult = {
  /** Echoes the plan's mode (after operator-control resolution). */
  mode: CampaignVariantPlan['mode'];
  strategy_id: string;
  experiment_id: string | null;
  /** All assets attempted — successes + failures in order. */
  generated_assets: CampaignFanOutAssetResult[];
  /** Backward-compat — present iff at least one asset succeeded.
   *  Equal to `generated_assets[0]` on the legacy single-asset path. */
  generated_asset: CampaignFanOutAssetResult | null;
};

/**
 * Run the orchestrator once per decision in the plan. The base
 * `CreatorOrchestrationInput` is reused for every invocation; only
 * the `appliedVariant` field is overwritten per decision.
 *
 * Returns a `CampaignFanOutResult` carrying all attempted decisions.
 * Caller is responsible for deciding policy on partial failure
 * (e.g. retry, surface as warning, etc.). The fan-out runner never
 * throws — failures are captured per decision.
 */
export async function runCampaignVariantFanOut(input: {
  plan: CampaignVariantPlan;
  /** Base orchestrator input. `appliedVariant` is OVERWRITTEN per
   *  decision; all other fields pass through. */
  orchestratorInput: Omit<CreatorOrchestrationInput, 'appliedVariant'>;
}): Promise<CampaignFanOutResult> {
  const { plan, orchestratorInput } = input;
  const results: CampaignFanOutAssetResult[] = [];

  for (const decision of plan.decisions) {
    const appliedVariant = {
      strategy_id: plan.strategy_id,
      variant_id: decision.variant_id,
      variant_family: decision.variant_family,
    };
    try {
      const orchestrated = await runCreatorOrchestration({
        ...orchestratorInput,
        appliedVariant,
      });
      results.push({
        rank: decision.rank,
        variant_id: decision.variant_id,
        variant_family: decision.variant_family,
        strategy_id: plan.strategy_id,
        experiment_id: plan.experiment_id,
        reasoning: decision.reasoning,
        result: orchestrated,
        ok: true,
      });
    } catch (error) {
      results.push({
        rank: decision.rank,
        variant_id: decision.variant_id,
        variant_family: decision.variant_family,
        strategy_id: plan.strategy_id,
        experiment_id: plan.experiment_id,
        reasoning: decision.reasoning,
        result: null,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const firstSuccess = results.find((r) => r.ok) ?? null;
  return {
    mode: plan.mode,
    strategy_id: plan.strategy_id,
    experiment_id: plan.experiment_id,
    generated_assets: results,
    generated_asset: firstSuccess,
  };
}
