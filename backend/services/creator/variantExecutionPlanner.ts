/**
 * Variant Execution Planner.
 *
 * Pure orchestrator. Takes a `VariantExecutionRequest` from any UI
 * surface (Creator / Writer / Campaign), resolves the appropriate
 * `VariantSelectionDecision[]` using:
 *
 *   - `variantRegistry`            — the 48-entry roster
 *   - `variantWinnerEngine`        — for `best_variant` mode
 *   - `variantInsightsEngine`      — for experiment-mode rationale
 *   - `variantOperatorControls`    — operator-level overrides
 *   - `variantExperimentTracker`   — registers fan-out runs
 *
 * Does NOT generate assets. The result is a structured plan the
 * existing creator pipeline already knows how to consume (each
 * decision carries a `VariantDefinition` whose `variant_id` +
 * `variant_family` flow into `media_bundle.metadata` and from there
 * into the renderer's variant overlay path).
 *
 * Pure-ish (uses the in-memory tracker + analytics aggregators).
 * No DB. No network. No new dependencies.
 */

import {
  type VariantExecutionMode,
  type VariantExecutionRequest,
  type VariantExecutionResult,
  type VariantSelectionDecision,
} from './variantExecutionContract';
import {
  listVariantsForStrategy,
  resolveVariant,
  resolveVariantByFamily,
  type VariantDefinition,
  type VariantFamily,
} from './variantRegistry';
import { resolveVariantStrategyProfile } from './variantStrategyProfiles';
import { detectVariantWinner } from './variantWinnerEngine';
import {
  getVariantOperatorControls,
  type VariantOperatorControls,
} from './variantOperatorControls';
import { registerExperiment } from './variantExperimentTracker';
import { recordVariantTimingSample } from './variantPerformanceTelemetry';

/* ── Planner ─────────────────────────────────────────────────── */

export function planVariantExecution(request: VariantExecutionRequest): VariantExecutionResult {
  // Phase 8 — planner duration is measured around the synchronous
  // planning body. The winner-engine call inside `planBestVariant`
  // is also timed separately so each contributes to its own
  // telemetry category.
  const plannerStartedAt = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  const controls = getVariantOperatorControls(request.companyId);
  const { resolvedMode, appliedOverrides, modeRationale } = resolveMode(request, controls);

  // Resolve the candidate variants for the strategy upfront — every
  // mode path consumes this set.
  const allVariants = listVariantsForStrategy(request.strategyId);
  if (allVariants.length === 0) {
    return {
      resolvedMode,
      strategyId: request.strategyId,
      decisions: [],
      experimentId: null,
      appliedOverrides,
      modeRationale: `${modeRationale} (no variants declared for this strategy — caller must use the strategy directly)`,
    };
  }

  let decisions: VariantSelectionDecision[] = [];
  let experimentId: string | null = null;

  switch (resolvedMode) {
    case 'single_variant':
      decisions = [planSingleVariant(request, controls, allVariants)];
      break;
    case 'best_variant':
      decisions = [planBestVariant(request)];
      break;
    case 'top_3_variants':
      decisions = planTop3(request, allVariants);
      break;
    case 'experiment': {
      decisions = planExperiment(allVariants);
      const registered = registerExperiment({
        companyId: request.companyId,
        campaignId: request.campaignId ?? null,
        strategyId: request.strategyId,
        mode: 'experiment',
        trackingType: 'experiment',
        variantIds: decisions.map((d) => ({
          variant_id: d.variant.variant_id,
          variant_family: d.variant.variant_family,
        })),
        correlationId: request.correlationId ?? null,
      });
      experimentId = registered.experiment_id;
      break;
    }
  }

  // Final Corrective Pass — P2-4. Register lightweight 'tracking'
  // entries for non-experiment modes so health surfaces reflect ALL
  // generation activity. These records carry `tracking_type='tracking'`
  // and are excluded from experiment-only winner / A/B analytics.
  if (resolvedMode !== 'experiment' && decisions.length > 0) {
    try {
      registerExperiment({
        companyId: request.companyId,
        campaignId: request.campaignId ?? null,
        strategyId: request.strategyId,
        mode: resolvedMode,
        trackingType: 'tracking',
        variantIds: decisions.map((d) => ({
          variant_id: d.variant.variant_id,
          variant_family: d.variant.variant_family,
        })),
        correlationId: request.correlationId ?? null,
      });
    } catch {
      // Best-effort — tracker registration must never block the planner.
    }
  }

  const plannerEndedAt = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  recordVariantTimingSample('planner', plannerEndedAt - plannerStartedAt, true, {
    mode: resolvedMode,
    decisions: decisions.length,
  });
  return {
    resolvedMode,
    strategyId: request.strategyId,
    decisions,
    experimentId,
    appliedOverrides,
    modeRationale,
  };
}

/* ── Mode resolution ────────────────────────────────────────── */

function resolveMode(
  request: VariantExecutionRequest,
  controls: VariantOperatorControls,
): {
  resolvedMode: VariantExecutionMode;
  appliedOverrides: VariantExecutionResult['appliedOverrides'];
  modeRationale: string;
} {
  type Override = VariantExecutionResult['appliedOverrides'][number];
  const overrides: Override[] = [];
  let resolved: VariantExecutionMode = request.mode;
  let rationale = `Executing in ${request.mode} mode as requested by the caller.`;

  // forceBaselineV1 is the most restrictive — wins outright.
  if (controls.forceBaselineV1 || controls.variantExplorationDisabled) {
    overrides.push(controls.forceBaselineV1 ? 'forced_baseline_v1' : 'variant_exploration_disabled');
    resolved = 'single_variant';
    rationale = controls.forceBaselineV1
      ? 'Operator forced V1 baseline — every request collapses to a single V1 decision.'
      : 'Variant exploration is disabled — falling back to V1 baseline.';
    return { resolvedMode: resolved, appliedOverrides: overrides, modeRationale: rationale };
  }

  // forceWinningVariant promotes any mode to best_variant.
  if (controls.forceWinningVariant) {
    overrides.push('forced_winning_variant');
    resolved = 'best_variant';
    rationale = 'Operator forced winning-variant mode — using the analytics winner engine.';
    return { resolvedMode: resolved, appliedOverrides: overrides, modeRationale: rationale };
  }

  // experimentModeDisabled downgrades only the experiment mode.
  if (request.mode === 'experiment' && controls.experimentModeDisabled) {
    overrides.push('experiment_disabled');
    resolved = 'top_3_variants';
    rationale = 'Experiment mode is disabled — fanning out as top-3 instead.';
  }

  return { resolvedMode: resolved, appliedOverrides: overrides, modeRationale: rationale };
}

/* ── Per-mode planners ──────────────────────────────────────── */

function planSingleVariant(
  request: VariantExecutionRequest,
  controls: VariantOperatorControls,
  allVariants: ReadonlyArray<VariantDefinition>,
): VariantSelectionDecision {
  // 1. Operator override: forced V1.
  if (controls.forceBaselineV1 || controls.variantExplorationDisabled) {
    const baseline = pickBaseline(allVariants);
    return {
      rank: 1,
      variant: baseline,
      reasoning: 'Operator forced baseline V1.',
      source: 'operator_forced',
    };
  }
  // 2. Caller pinned variant_id.
  if (request.variantId) {
    const pinned = resolveVariant(request.variantId);
    if (pinned && pinned.strategy_id === request.strategyId) {
      return {
        rank: 1,
        variant: pinned,
        reasoning: `Caller pinned ${pinned.display_name}.`,
        source: 'caller_pinned',
      };
    }
  }
  // 3. Caller pinned variant_family.
  if (request.variantFamily) {
    const pinned = resolveVariantByFamily(request.strategyId, request.variantFamily);
    if (pinned) {
      return {
        rank: 1,
        variant: pinned,
        reasoning: `Caller pinned variant family ${request.variantFamily.toUpperCase()} (${pinned.display_name}).`,
        source: 'caller_pinned',
      };
    }
  }
  // 4. No pin — fall back to V1 baseline.
  const baseline = pickBaseline(allVariants);
  return {
    rank: 1,
    variant: baseline,
    reasoning: 'No variant pinned by caller — using V1 baseline.',
    source: 'baseline_fallback',
  };
}

function planBestVariant(request: VariantExecutionRequest): VariantSelectionDecision {
  const winnerStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const winner = detectVariantWinner({
    strategyId: request.strategyId,
    companyId: request.companyId,
    campaignId: request.campaignId,
    platform: request.platform,
    creatorId: request.creatorId,
    window: request.window ?? '30d',
  });
  const winnerEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  recordVariantTimingSample('winner_engine', winnerEnd - winnerStart, true, {
    strategy_id: request.strategyId,
    declared: !winner.insufficientData,
  });
  if (winner.winner) {
    const variant = resolveVariant(winner.winner.variant_id);
    if (variant) {
      const deltaPct = winner.delta !== null
        ? `${(winner.delta * 100).toFixed(1)}%`
        : 'n/a';
      return {
        rank: 1,
        variant,
        reasoning: `Winning variant by ${winner.metric} (Δ=${deltaPct} over runner-up, ${winner.confidence} confidence, n=${Math.round(winner.sampleSize)}).`,
        source: 'winner_engine',
      };
    }
  }
  // No declared winner — fall back to V1 baseline.
  const variants = listVariantsForStrategy(request.strategyId);
  const baseline = pickBaseline(variants);
  return {
    rank: 1,
    variant: baseline,
    reasoning: `No declared winner yet (${winner.insufficientReason ?? 'insufficient data'}) — using V1 baseline.`,
    source: 'baseline_fallback',
  };
}

function planTop3(
  request: VariantExecutionRequest,
  allVariants: ReadonlyArray<VariantDefinition>,
): VariantSelectionDecision[] {
  // Try to surface the winner annotation when one exists, so the
  // operator can see which of the three is currently winning.
  const winner = detectVariantWinner({
    strategyId: request.strategyId,
    companyId: request.companyId,
    campaignId: request.campaignId,
    platform: request.platform,
    creatorId: request.creatorId,
    window: request.window ?? '30d',
  });

  return allVariants.map((variant, idx) => {
    const profile = resolveVariantStrategyProfile(variant.variant_id);
    let reasoning = profile?.reasoning ?? variant.description;
    if (winner.winner && winner.winner.variant_id === variant.variant_id) {
      reasoning += ' (current leader)';
    } else if (winner.runner_up && winner.runner_up.variant_id === variant.variant_id) {
      reasoning += ' (current runner-up)';
    }
    return {
      rank: idx + 1,
      variant,
      reasoning,
      source: 'experiment_fan_out',
    };
  });
}

function planExperiment(allVariants: ReadonlyArray<VariantDefinition>): VariantSelectionDecision[] {
  return allVariants.map((variant, idx) => {
    const profile = resolveVariantStrategyProfile(variant.variant_id);
    return {
      rank: idx + 1,
      variant,
      reasoning: profile?.reasoning ?? variant.description,
      source: 'experiment_fan_out',
    };
  });
}

/* ── Helpers ─────────────────────────────────────────────────── */

function pickBaseline(variants: ReadonlyArray<VariantDefinition>): VariantDefinition {
  // V1 is the canonical baseline by convention. Fall back to the
  // first declared variant if V1 is missing (shouldn't happen given
  // the registry enforces V1/V2/V3 parity, but the fallback keeps
  // the planner robust).
  return variants.find((v) => v.variant_family === 'v1') ?? variants[0];
}

/* ── Re-exports ──────────────────────────────────────────────── */

export type { VariantExecutionRequest, VariantExecutionResult, VariantSelectionDecision, VariantExecutionMode, VariantFamily };
