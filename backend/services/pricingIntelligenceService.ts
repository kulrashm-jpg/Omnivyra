/**
 * Pricing Intelligence Service
 *
 * Pure-math + DB helpers for the Phase 6 margin optimization loop. The weekly
 * job orchestrates; this service owns the formulas, guardrails, and config.
 *
 * Margin math:
 *   margin_usd     = credits_value_usd - api_cost_usd
 *   margin_percent = margin_usd / credits_value_usd  (null if credits_value_usd = 0)
 *
 * Recommended multiplier:
 *   actual > 0  → current × (target_optimal / actual)   clamped to [0.5×, 5×]
 *   actual ≤ 0  → current × 1.25                       (aggressive boost)
 *
 * Guardrails (applied on the PROPOSAL, not the recommendation):
 *   max per-update increase: +25%
 *   max per-update decrease: −20%
 *
 * This means recommendations can diverge from proposals — the queue surfaces
 * both so an admin sees the full picture.
 */

// ── Config (env-overridable) ──────────────────────────────────────────────────

export const TARGET_MIN_MARGIN     = Number(process.env.TARGET_MIN_MARGIN     ?? '0.20');
export const TARGET_MAX_MARGIN     = Number(process.env.TARGET_MAX_MARGIN     ?? '0.60');
export const TARGET_OPTIMAL_MARGIN = Number(process.env.TARGET_OPTIMAL_MARGIN ?? '0.40');

export const DEVIATION_THRESHOLD   = Number(process.env.PRICING_DEVIATION_PCT ?? '0.20'); // 20%
export const MAX_MULTIPLIER_INCREASE_PCT = Number(process.env.PRICING_MAX_INCREASE_PCT ?? '0.25');
export const MAX_MULTIPLIER_DECREASE_PCT = Number(process.env.PRICING_MAX_DECREASE_PCT ?? '0.20');

const RECOMMENDED_CLAMP_LOW  = 0.5;  // half of current
const RECOMMENDED_CLAMP_HIGH = 5.0;  // 5× of current

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface MarginAnalysis {
  action_key:              string;
  model_name:              string | null;
  total_api_cost_usd:      number;
  total_credits_value_usd: number;
  margin_usd:              number;
  /** null when no credit-bearing rows exist (can't compute margin) */
  margin_percent:          number | null;
  event_count:             number;
}

export interface MultiplierRecommendation {
  current_multiplier:       number;
  /** null when no adjustment warranted (margin in band or no credit signal) */
  recommended_multiplier:   number | null;
  /** proposed = recommended, clamped by the per-update guardrails */
  proposed_multiplier:      number | null;
  deviation_flag:           boolean;
  band: 'in_band' | 'underpriced' | 'overpriced' | 'no_signal';
  reason: string;
}

// ── Pure math ─────────────────────────────────────────────────────────────────

export function computeMarginPercent(apiCostUsd: number, creditsValueUsd: number): number | null {
  if (!Number.isFinite(creditsValueUsd) || creditsValueUsd <= 0) return null;
  const margin = creditsValueUsd - apiCostUsd;
  return margin / creditsValueUsd;
}

/**
 * Classify a margin vs the three thresholds.
 * Returns the band and whether an adjustment is warranted.
 */
export function classifyMargin(marginPercent: number | null): MultiplierRecommendation['band'] {
  if (marginPercent == null) return 'no_signal';
  if (marginPercent < TARGET_MIN_MARGIN) return 'underpriced';
  if (marginPercent > TARGET_MAX_MARGIN) return 'overpriced';
  return 'in_band';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Compute the recommended + proposed multiplier given the current multiplier
 * and observed margin. Pure function; no DB access.
 */
export function computeMultiplierRecommendation(
  currentMultiplier: number,
  marginPercent: number | null,
): MultiplierRecommendation {
  const band = classifyMargin(marginPercent);

  if (band === 'in_band' || band === 'no_signal') {
    return {
      current_multiplier:     currentMultiplier,
      recommended_multiplier: null,
      proposed_multiplier:    null,
      deviation_flag:         false,
      band,
      reason: band === 'in_band'
        ? `Margin within target band [${TARGET_MIN_MARGIN}, ${TARGET_MAX_MARGIN}]`
        : 'No credit-bearing rows to compute margin',
    };
  }

  // Compute raw recommendation.
  // If margin is ≤ 0 (we're losing money per call), target/actual is
  // undefined or negative — fall back to an aggressive boost capped by
  // the guardrail. If margin is positive, scale current by the ratio.
  let raw: number;
  if (marginPercent == null || marginPercent <= 0) {
    raw = currentMultiplier * (1 + MAX_MULTIPLIER_INCREASE_PCT);
  } else {
    raw = currentMultiplier * (TARGET_OPTIMAL_MARGIN / marginPercent);
  }

  // Clamp the recommendation to a sane range around current (defensive).
  const recommended = clamp(
    raw,
    currentMultiplier * RECOMMENDED_CLAMP_LOW,
    currentMultiplier * RECOMMENDED_CLAMP_HIGH,
  );

  // Apply per-update guardrails to produce the PROPOSED multiplier.
  const maxUp   = currentMultiplier * (1 + MAX_MULTIPLIER_INCREASE_PCT);
  const maxDown = currentMultiplier * (1 - MAX_MULTIPLIER_DECREASE_PCT);
  const proposed = clamp(recommended, maxDown, maxUp);

  // Deviation flag: recommendation differs from current by > 20%.
  const deviationRatio = currentMultiplier > 0
    ? Math.abs(recommended - currentMultiplier) / currentMultiplier
    : 0;
  const deviationFlag = deviationRatio > DEVIATION_THRESHOLD;

  const reason =
    band === 'underpriced'
      ? `Margin ${(marginPercent! * 100).toFixed(1)}% below target ${(TARGET_MIN_MARGIN * 100).toFixed(0)}%`
      : `Margin ${(marginPercent! * 100).toFixed(1)}% above target ${(TARGET_MAX_MARGIN * 100).toFixed(0)}%`;

  return {
    current_multiplier:     currentMultiplier,
    recommended_multiplier: recommended,
    proposed_multiplier:    proposed,
    deviation_flag:         deviationFlag,
    band,
    reason,
  };
}
