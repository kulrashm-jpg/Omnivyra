/**
 * Campaign Variant Applier (Final Corrective Pass — P1-1).
 *
 * Reads the campaign's persisted `execution_config.variant_strategy`
 * (when present), resolves it to a planner request via the shared
 * `campaignConfigToPlannerInput` + `readVariantConfigFromAnyCampaignShape`
 * helpers, calls `planVariantExecution`, and returns the FIRST
 * resolved variant ready to feed into the creator orchestrator.
 *
 * STRICT SCOPE:
 *   - Activates the persisted variant config; does NOT introduce a
 *     new generation pipeline.
 *   - When no variant config exists, returns null so callers can
 *     fall through to default behavior (zero behavior change).
 *   - Modes:
 *       single_variant  → uses the v1/v2/v3 pinned variant
 *       best_variant    → uses winner-engine resolution
 *       top_3_variants  → uses the planner's first decision
 *                          (callers that fan out should re-call the
 *                          planner directly; the orchestrator currently
 *                          generates one asset per call)
 *       experiment      → uses the planner's first decision AND
 *                          registers an experiment tracker entry
 *                          (handled inside the planner)
 *
 *   - Best-effort: any error returns null and the caller's default
 *     path is preserved.
 */

import { readVariantConfigFromAnyCampaignShape } from '../../../lib/variants/campaignVariantConfig';
import { campaignConfigToPlannerInput } from '../../../components/variant-experience/CampaignVariantModeField';
import { planVariantExecution } from './variantExecutionPlanner';
import type {
  VariantExecutionMode,
  VariantExecutionRequest,
  VariantExecutionResult,
  VariantSelectionDecision,
} from './variantExecutionContract';

export type AppliedCampaignVariant = {
  strategy_id: string;
  variant_id: string;
  variant_family: string;
  /** Mode the campaign config requested (after operator-control resolution). */
  resolved_mode: VariantExecutionResult['resolvedMode'];
  /** When the planner registered an experiment tracker entry, this is its id. */
  experiment_id: string | null;
};

/**
 * Multi-decision plan output (Campaign Multi-Variant Execution
 * Completion — Phase 1). Returned by `resolveCampaignVariantPlan`
 * so the campaign runner can fan out one orchestrator call per
 * decision.
 *
 * Decision count by resolved mode:
 *   - single_variant   → 1
 *   - best_variant     → 1
 *   - top_3_variants   → N (≤ 3)
 *   - experiment       → N (≤ 3)
 */
export type CampaignVariantPlan = {
  strategy_id: string;
  mode: VariantExecutionMode;
  decisions: ReadonlyArray<{
    rank: number;
    variant_id: string;
    variant_family: string;
    reasoning: string;
    source: VariantSelectionDecision['source'];
  }>;
  /** Tracker id when the planner registered an experiment fan-out. */
  experiment_id: string | null;
};

export type ResolveCampaignVariantInput = {
  /** Any campaign-like shape recognized by
   *  `readVariantConfigFromAnyCampaignShape` — typically the row
   *  returned by `/api/campaigns?type=campaign&campaignId=…`. May
   *  also be a `campaign_snapshot` envelope directly. */
  campaign: unknown;
  /** Org scope — required for analytics + operator-control lookups. */
  companyId: string;
  /** Campaign id — optional; threaded through for tracker scoping. */
  campaignId?: string | null;
  /** Optional — platform for winner-engine resolution. */
  platform?: string | null;
  /** Optional — creator id for winner-engine resolution. */
  creatorId?: string | null;
};

/**
 * Resolves the campaign's persisted variant_strategy into a concrete
 * variant the orchestrator can apply. Returns null when:
 *
 *   - the campaign has no variant_strategy persisted
 *   - the persisted config is malformed
 *   - the planner produces zero decisions (unknown strategy)
 *   - any internal error fires (best-effort contract)
 */
export function resolveCampaignAppliedVariant(
  input: ResolveCampaignVariantInput,
): AppliedCampaignVariant | null {
  const plan = resolveCampaignVariantPlan(input);
  if (!plan) return null;
  const first = plan.decisions[0];
  if (!first) return null;
  return {
    strategy_id: plan.strategy_id,
    variant_id: first.variant_id,
    variant_family: first.variant_family,
    resolved_mode: plan.mode,
    experiment_id: plan.experiment_id,
  };
}

/**
 * Resolves the campaign's persisted variant_strategy into the FULL
 * set of variant decisions the runner should generate. Returns null
 * when no variant config is persisted, malformed, or the planner
 * produced zero decisions.
 *
 * Campaign Multi-Variant Execution Completion — Phase 1. This is the
 * canonical multi-decision entry point. Single-decision callers can
 * keep using `resolveCampaignAppliedVariant` (which delegates here
 * and returns the first decision for backward compatibility).
 *
 * The campaign runner is expected to loop over `decisions` and call
 * the orchestrator once per entry. Each invocation will:
 *
 *   - merge the per-decision variant envelope into media_bundle.metadata
 *   - record a generation telemetry sample
 *   - fire `notifyExperimentAssetGenerated` (when the tracker has a
 *     matching entry)
 *
 * Mode → decision count:
 *
 *   - single_variant   → 1 (pinned v1/v2/v3 or operator-forced)
 *   - best_variant     → 1 (winner-engine resolved)
 *   - top_3_variants   → ≤ 3 (registered as `tracking_type='tracking'`)
 *   - experiment       → ≤ 3 (registered as `tracking_type='experiment'`)
 */
export function resolveCampaignVariantPlan(
  input: ResolveCampaignVariantInput,
): CampaignVariantPlan | null {
  try {
    if (!input.companyId) return null;
    const persisted = readVariantConfigFromAnyCampaignShape(input.campaign);
    if (!persisted) return null;
    const plannerInput = campaignConfigToPlannerInput(persisted);
    if (!plannerInput.strategyId) return null;
    const request: VariantExecutionRequest = {
      companyId: input.companyId,
      campaignId: input.campaignId ?? null,
      platform: input.platform ?? null,
      creatorId: input.creatorId ?? null,
      strategyId: plannerInput.strategyId,
      mode: plannerInput.mode,
      variantFamily: plannerInput.variantFamily,
    };
    const result = planVariantExecution(request);
    if (result.decisions.length === 0) return null;
    return {
      strategy_id: result.strategyId,
      mode: result.resolvedMode,
      decisions: result.decisions.map((d) => ({
        rank: d.rank,
        variant_id: d.variant.variant_id,
        variant_family: d.variant.variant_family,
        reasoning: d.reasoning,
        source: d.source,
      })),
      experiment_id: result.experimentId,
    };
  } catch {
    return null;
  }
}
