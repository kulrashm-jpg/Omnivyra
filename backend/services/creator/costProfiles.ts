/**
 * Creator Content Cost Profiles (Cost Estimate Accuracy — Phase 1).
 *
 * Per content-type historical assumptions used by
 * `campaignVariantBillingEstimator` to produce a more accurate
 * pre-execution estimate than the previous flat per-asset baseline.
 *
 * STRICT scope:
 *   - PURE constants. No mutations. No network.
 *   - Does NOT change the billing contract — actual charging continues
 *     to flow through `wirePhase2Route` / `withQueueBilling` per
 *     orchestrator invocation.
 *   - Profiles are advisory. Operators can override individual values
 *     via env vars without redeploying the code.
 *
 * Each profile carries:
 *   - expected_tokens                 — coarse blueprint+render token volume
 *   - render_cost_usd                 — generation USD per asset
 *   - adaptation_cost_per_platform_usd — secondary-platform adapt USD per platform
 *   - expected_credits_per_asset      — operator-facing credit unit
 *   - variance_pct                    — uncertainty band for low/high estimates
 *
 * The variance is symmetric: low = expected × (1 − variance_pct),
 * high = expected × (1 + variance_pct).
 */

export type CreatorCostProfile = {
  /** Canonical content-type key. */
  content_type: 'image' | 'carousel' | 'infographic';
  /** Coarse token count for the generation step (blueprint + render
   *  prompt + adapt). Used by the diagnostics surface; not by
   *  charging. */
  expected_tokens: number;
  /** Expected per-asset generation USD (LLM + render). */
  render_cost_usd: number;
  /** Expected per-(asset, secondary-platform) adaptation USD. */
  adaptation_cost_per_platform_usd: number;
  /** Operator-facing credits per asset. */
  expected_credits_per_asset: number;
  /** Symmetric uncertainty band. 0.25 → ±25% confidence band. */
  variance_pct: number;
};

const BASE_PROFILES: ReadonlyArray<CreatorCostProfile> = [
  {
    content_type: 'image',
    expected_tokens: 2_500,
    render_cost_usd: 0.015,
    adaptation_cost_per_platform_usd: 0.003,
    expected_credits_per_asset: 1,
    variance_pct: 0.25,
  },
  {
    content_type: 'carousel',
    expected_tokens: 6_000,
    render_cost_usd: 0.040,
    adaptation_cost_per_platform_usd: 0.005,
    expected_credits_per_asset: 2,
    variance_pct: 0.30,
  },
  {
    content_type: 'infographic',
    expected_tokens: 4_000,
    render_cost_usd: 0.025,
    adaptation_cost_per_platform_usd: 0.004,
    expected_credits_per_asset: 1.5,
    variance_pct: 0.27,
  },
];

const profilesByKey = new Map<string, CreatorCostProfile>(
  BASE_PROFILES.map((p) => [p.content_type, p]),
);

/* ── Env overrides ─────────────────────────────────────────────── */

const MIN_USD = 0;
const MAX_USD = 100;
const MIN_CREDITS = 0;
const MAX_CREDITS = 1_000;
const MIN_VARIANCE = 0;
const MAX_VARIANCE = 1; // 100%

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readNumberEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolves the profile for a content type. Applies per-profile env
 * overrides when set. Falls back to the `image` profile for unknown
 * content types so the estimator can still produce a coarse answer
 * for guidance-only / text-only paths.
 *
 * Env override names (all optional):
 *   - CREATOR_COST_<TYPE>_RENDER_USD
 *   - CREATOR_COST_<TYPE>_ADAPT_USD
 *   - CREATOR_COST_<TYPE>_CREDITS
 *   - CREATOR_COST_<TYPE>_VARIANCE_PCT
 *
 * where <TYPE> ∈ { IMAGE, CAROUSEL, INFOGRAPHIC }.
 */
export function resolveCostProfile(contentType: string): CreatorCostProfile {
  const key = String(contentType || '').trim().toLowerCase();
  const base = profilesByKey.get(key) ?? profilesByKey.get('image')!;
  const envKey = base.content_type.toUpperCase();
  const renderUsd = readNumberEnv(`CREATOR_COST_${envKey}_RENDER_USD`);
  const adaptUsd = readNumberEnv(`CREATOR_COST_${envKey}_ADAPT_USD`);
  const credits = readNumberEnv(`CREATOR_COST_${envKey}_CREDITS`);
  const variance = readNumberEnv(`CREATOR_COST_${envKey}_VARIANCE_PCT`);
  return {
    content_type: base.content_type,
    expected_tokens: base.expected_tokens,
    render_cost_usd: renderUsd !== null ? clamp(renderUsd, MIN_USD, MAX_USD) : base.render_cost_usd,
    adaptation_cost_per_platform_usd: adaptUsd !== null
      ? clamp(adaptUsd, MIN_USD, MAX_USD)
      : base.adaptation_cost_per_platform_usd,
    expected_credits_per_asset: credits !== null
      ? clamp(credits, MIN_CREDITS, MAX_CREDITS)
      : base.expected_credits_per_asset,
    variance_pct: variance !== null ? clamp(variance, MIN_VARIANCE, MAX_VARIANCE) : base.variance_pct,
  };
}

/**
 * Returns all declared profiles (with env overrides applied). Used
 * by the diagnostics surface so operators can see the current
 * assumption set.
 */
export function listCostProfiles(): CreatorCostProfile[] {
  return BASE_PROFILES.map((p) => resolveCostProfile(p.content_type));
}

/**
 * Apply the configured variance band symmetrically around an
 * expected value. Clamps low to 0 so confidence bands never go
 * negative.
 */
export function applyVarianceBand(
  expected: number,
  variancePct: number,
): { low: number; expected: number; high: number } {
  const v = Math.max(0, Math.min(1, variancePct));
  return {
    low: Math.max(0, Number((expected * (1 - v)).toFixed(4))),
    expected: Number(expected.toFixed(4)),
    high: Number((expected * (1 + v)).toFixed(4)),
  };
}
