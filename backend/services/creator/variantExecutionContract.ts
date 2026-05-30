/**
 * Variant Execution Contract.
 *
 * Canonical request / result types that connect Creator / Writer /
 * Campaign UI surfaces to the existing strategy + variant analytics
 * stack. The contract is BACKEND-FIRST: UI surfaces send a
 * `VariantExecutionRequest`, the planner returns a
 * `VariantExecutionResult` with one `VariantSelectionDecision` per
 * variant the caller must actually generate.
 *
 * The planner does NOT generate assets — it produces the structured
 * plan the existing `creatorAssetRenderer` pipeline consumes. This
 * preserves every governance / QA / moderation / approval gate that
 * already lives downstream of generation (PHASE 15 contract).
 *
 * Pure types + a thin set of guards. No behavior. No I/O.
 */

import type { AnalyticsContentType } from './strategyAnalyticsRegistry';
import type { StrategyTimeWindow } from './strategyPerformanceAggregator';
import type { VariantDefinition, VariantFamily } from './variantRegistry';

/* ── Modes ───────────────────────────────────────────────────────── */

export type VariantExecutionMode =
  | 'single_variant'
  | 'best_variant'
  | 'top_3_variants'
  | 'experiment';

export const VARIANT_EXECUTION_MODES: ReadonlyArray<VariantExecutionMode> = [
  'single_variant',
  'best_variant',
  'top_3_variants',
  'experiment',
];

export function isVariantExecutionMode(value: unknown): value is VariantExecutionMode {
  return typeof value === 'string'
    && (VARIANT_EXECUTION_MODES as ReadonlyArray<string>).includes(value);
}

/* ── Request shape ──────────────────────────────────────────────── */

/**
 * Canonical caller input. Surfaces (Creator / Writer / Campaign)
 * normalize their UI selection into this shape before calling the
 * planner.
 */
export type VariantExecutionRequest = {
  /** Required. Org scope for analytics + operator-control lookups. */
  companyId: string;
  /** Optional — restricts winner / analytics lookups to a campaign. */
  campaignId?: string | null;
  /** Optional — restricts winner / analytics lookups to a platform. */
  platform?: string | null;
  /** Optional — restricts winner / analytics lookups to a creator. */
  creatorId?: string | null;
  /** Required. Parent purpose strategy id (e.g. 'image:quote-image'). */
  strategyId: string;
  /** Required. Determines fan-out shape (1 / 1 / 3 / 3 decisions). */
  mode: VariantExecutionMode;
  /** When `mode === 'single_variant'`, the caller MAY pin a specific
   *  variant via id OR family. Ignored in other modes. When both are
   *  null in single_variant mode, the planner falls back to V1. */
  variantId?: string | null;
  variantFamily?: VariantFamily | null;
  /** Optional rolling window for winner / analytics resolution. */
  window?: StrategyTimeWindow;
  /** Optional — content type lane (for guardrail validation). */
  contentType?: AnalyticsContentType;
  /** Operator-supplied free-form correlation id — surfaced on the
   *  resulting experiment tracker entry so dashboards can link a
   *  generation run back to the request that triggered it. */
  correlationId?: string | null;
};

/* ── Selection decision ─────────────────────────────────────────── */

/**
 * One decision per asset that must be generated. The caller hands
 * this off to the existing `creatorAssetRenderer` pipeline as
 * `media_bundle.metadata.variant_id` + `variant_family` (the renderer
 * already reads these from input metadata — see Purpose-Aware Variant
 * Exploration phase 4).
 */
export type VariantSelectionDecision = {
  /** Rank within the result (1-indexed). */
  rank: number;
  /** Variant definition the renderer should apply. */
  variant: VariantDefinition;
  /** Why this variant was selected — surfaced in preview + dashboard. */
  reasoning: string;
  /** Source of the selection:
   *   - 'caller_pinned'       — the request named the variant
   *   - 'winner_engine'       — the variant winner engine produced the choice
   *   - 'baseline_fallback'   — fallback to V1 when no winner declared
   *   - 'experiment_fan_out'  — produced by experiment / top-3 fan-out
   *   - 'operator_forced'     — operator controls forced this choice */
  source:
    | 'caller_pinned'
    | 'winner_engine'
    | 'baseline_fallback'
    | 'experiment_fan_out'
    | 'operator_forced';
};

/* ── Result shape ───────────────────────────────────────────────── */

export type VariantExecutionResult = {
  /** Resolved execution mode (after operator-control overrides). May
   *  differ from `request.mode` when the operator has disabled
   *  experiment mode etc. — see `appliedOverrides`. */
  resolvedMode: VariantExecutionMode;
  /** Parent strategy id from the request, echoed back. */
  strategyId: string;
  /** One decision per asset to generate. Always >= 1, capped by
   *  `MAX_VARIANTS_PER_STRATEGY` (3) for top_3 / experiment modes. */
  decisions: VariantSelectionDecision[];
  /** When the planner produced an `experiment` fan-out, this is the
   *  tracker id the experiment was registered under. Null for
   *  single / best / top_3 modes. */
  experimentId: string | null;
  /** Operator-control overrides actually applied to this request. */
  appliedOverrides: ReadonlyArray<
    | 'experiment_disabled'
    | 'variant_exploration_disabled'
    | 'forced_baseline_v1'
    | 'forced_winning_variant'
  >;
  /** Operator-readable rationale of the high-level mode decision —
   *  separate from per-decision reasoning. */
  modeRationale: string;
};

/* ── Guard helpers ──────────────────────────────────────────────── */

/**
 * Validate a request before handing it to the planner. Returns
 * `null` when valid; otherwise a concrete error code the API layer
 * MUST return as a 400.
 */
export function validateVariantExecutionRequest(
  request: VariantExecutionRequest | null | undefined,
):
  | null
  | {
      code:
        | 'company_id_required'
        | 'strategy_id_required'
        | 'invalid_mode'
        | 'invalid_variant_family';
      message: string;
    } {
  if (!request) return { code: 'company_id_required', message: 'companyId is required' };
  if (!request.companyId || typeof request.companyId !== 'string') {
    return { code: 'company_id_required', message: 'companyId is required' };
  }
  if (!request.strategyId || typeof request.strategyId !== 'string') {
    return { code: 'strategy_id_required', message: 'strategyId is required' };
  }
  if (!isVariantExecutionMode(request.mode)) {
    return { code: 'invalid_mode', message: `mode must be one of ${VARIANT_EXECUTION_MODES.join(', ')}` };
  }
  if (request.variantFamily != null
      && request.variantFamily !== 'v1'
      && request.variantFamily !== 'v2'
      && request.variantFamily !== 'v3') {
    return { code: 'invalid_variant_family', message: "variantFamily must be 'v1' | 'v2' | 'v3' | null" };
  }
  return null;
}
