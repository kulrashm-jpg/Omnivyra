/**
 * Campaign Variant Billing Estimator (Fan-Out Completion — Phase 4).
 *
 * Given a campaign's persisted variant_strategy, returns the
 * expected asset count + a coarse per-asset / total credit estimate
 * the UI can display BEFORE execution. The estimate is advisory:
 * actual billing flows through the existing per-orchestrator-
 * invocation charging wrappers (wirePhase2Route / withQueueBilling).
 *
 * STRICT SCOPE:
 *   - Pure read. No mutations.
 *   - Does NOT change the billing contract.
 *   - Does NOT charge anything.
 *   - Reuses the planner's mode→decision-count logic via
 *     `resolveCampaignVariantPlan`, so the asset count matches what
 *     the fan-out runner will actually execute.
 *
 * Per-asset cost defaults are sourced from environment overrides
 * when set:
 *   - CAMPAIGN_VARIANT_PER_ASSET_CREDITS  → integer credits / asset (default 1)
 *   - CAMPAIGN_VARIANT_PER_ASSET_USD      → USD cost / asset (default 0.02)
 *
 * Both are clamped to a sane range. The defaults match the BOLT
 * runtime's existing per-asset credit accounting (1 credit / asset).
 */

import {
  resolveCampaignVariantPlan,
  type CampaignVariantPlan,
  type ResolveCampaignVariantInput,
} from './campaignVariantApplier';
import {
  applyVarianceBand,
  resolveCostProfile,
  type CreatorCostProfile,
} from './costProfiles';
import { calibrationAdjustmentFactor } from './costObservationStore';

const DEFAULT_PER_ASSET_CREDITS = 1;
const DEFAULT_PER_ASSET_USD = 0.02;
const MIN_PER_ASSET_CREDITS = 0;
const MAX_PER_ASSET_CREDITS = 100;
const MIN_PER_ASSET_USD = 0;
const MAX_PER_ASSET_USD = 100;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function resolvePerAssetCredits(): number {
  const raw = process.env.CAMPAIGN_VARIANT_PER_ASSET_CREDITS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return clamp(n, MIN_PER_ASSET_CREDITS, MAX_PER_ASSET_CREDITS);
  }
  return DEFAULT_PER_ASSET_CREDITS;
}

function resolvePerAssetUsd(): number {
  const raw = process.env.CAMPAIGN_VARIANT_PER_ASSET_USD;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return clamp(n, MIN_PER_ASSET_USD, MAX_PER_ASSET_USD);
  }
  return DEFAULT_PER_ASSET_USD;
}

export type CampaignVariantBillingEstimate = {
  /** True when the campaign carries a persisted variant_strategy. */
  has_variant_config: boolean;
  /** Resolved planner mode. Null when there is no variant config. */
  mode: CampaignVariantPlan['mode'] | null;
  /** Resolved planner strategy id. Null when no config. */
  strategy_id: string | null;
  /** Number of assets the fan-out will generate. Always >= 1 when
   *  variant config exists; equal to 1 for non-variant campaigns. */
  expected_asset_count: number;
  /** Per-asset credit estimate (advisory). */
  per_asset_credits: number;
  /** Total credit estimate = per_asset_credits × expected_asset_count. */
  total_estimated_credits: number;
  /** Per-asset USD estimate (advisory) — uses the profile-aware
   *  calculation when a content_type is supplied. */
  per_asset_estimated_usd: number;
  /** Total USD estimate = per_asset_estimated_usd × expected_asset_count
   *  plus secondary-platform adaptation cost. */
  total_estimated_usd: number;
  /** Human-readable summary for confirmation dialogs.
   *  e.g. "Top 3 Variants → 3 assets · ~3 credits (2.4–3.1)" */
  summary: string;
  /** Per-decision preview so the UI can render variant-level details. */
  decisions: CampaignVariantPlan['decisions'];
  /**
   * Cost Estimate Accuracy — Phase 3 + 4.
   *
   * Detailed breakdown so callers can render the band + platform-aware
   * breakdown without having to recompute. Always present.
   */
  detail: {
    /** Echoes the content_type the estimate used. 'image' when the
     *  caller didn't specify a content_type. */
    content_type: CreatorCostProfile['content_type'];
    /** Primary platform considered for the estimate. Null when no
     *  platform list was supplied (estimate uses content-type
     *  baseline + variant fan-out only). */
    primary_platform: string | null;
    /** Secondary platforms — one adaptation_cost_per_platform_usd
     *  charge per secondary platform per asset. */
    secondary_platforms: string[];
    /** Per-asset USD cost of generation only (no adaptation). */
    generation_usd_per_asset: number;
    /** Per-asset USD cost of secondary-platform adaptation. */
    adaptation_usd_per_asset: number;
    /** Confidence band for the total USD estimate. */
    total_estimated_usd_band: { low: number; expected: number; high: number };
    /** Confidence band for the total credit estimate. */
    total_estimated_credits_band: { low: number; expected: number; high: number };
    /** Variance percentage the cost profile declares. */
    variance_pct: number;
    /** Calibration adjustment factor actually applied (1.0 = none).
     *  >1 means historical observations showed actuals running over;
     *  <1 means historical observations showed actuals running under. */
    calibration_factor: number;
    /** Sample size that fed the calibration factor. 0 when no
     *  observations were available. */
    calibration_sample_count: number;
  };
};

function summarize(
  mode: CampaignVariantPlan['mode'] | null,
  assetCount: number,
  credits: number,
  band?: { low: number; high: number } | null,
): string {
  const label =
    mode === 'experiment' ? 'Experiment'
      : mode === 'top_3_variants' ? 'Top 3 Variants'
        : mode === 'best_variant' ? 'Best Variant'
          : mode === 'single_variant' ? 'Single Variant'
            : 'No variant config';
  const assetWord = assetCount === 1 ? 'asset' : 'assets';
  const creditWord = credits === 1 ? 'credit' : 'credits';
  const bandStr = band
    ? ` (${formatBand(band.low)}–${formatBand(band.high)})`
    : '';
  return `${label} → ${assetCount} ${assetWord} · ~${credits} ${creditWord}${bandStr}`;
}

function formatBand(n: number): string {
  // Trim trailing zeros — "2.4" not "2.4000".
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export type EstimateCampaignVariantBillingInput = ResolveCampaignVariantInput & {
  /** Content type the campaign will generate. Drives the profile
   *  lookup (image / carousel / infographic). Defaults to 'image'. */
  contentType?: string | null;
  /** Target platforms for the run. The first entry is the primary
   *  platform (rendered by the orchestrator); the remainder incur
   *  adaptation cost. */
  targetPlatforms?: ReadonlyArray<string> | null;
};

/**
 * Returns the pre-execution billing estimate for a campaign's
 * variant configuration. When the campaign carries no variant
 * config, returns the no-op baseline (1 asset, 1 credit) so the UI
 * can still display "no variant config" prominently.
 *
 * Cost Estimate Accuracy — Phases 2, 3, 4, 6:
 *   - Phase 2 uses the planner's actual decision count
 *   - Phase 3 includes secondary-platform adaptation cost
 *   - Phase 4 returns low/expected/high confidence bands
 *   - Phase 6 multiplies the expected value by the calibration factor
 *     derived from historical observations (no-op when sample_count
 *     is below the calibration floor)
 */
export function estimateCampaignVariantBilling(
  input: EstimateCampaignVariantBillingInput,
): CampaignVariantBillingEstimate {
  const plan = resolveCampaignVariantPlan(input);
  const perAssetCreditsFlat = resolvePerAssetCredits();
  const perAssetUsdFlat = resolvePerAssetUsd();
  const profile = resolveCostProfile(input.contentType ?? 'image');

  const platforms = Array.isArray(input.targetPlatforms)
    ? input.targetPlatforms.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  const primaryPlatform = platforms[0] ?? null;
  const secondaryPlatforms = platforms.length > 1 ? platforms.slice(1) : [];

  // Phase 6 — calibration adjustment. Only applied when we have a
  // resolved mode (otherwise we'd bucket as 'no_variant').
  const calibratedMode = plan ? plan.mode : 'no_variant';
  const calibrationFactor = calibrationAdjustmentFactor({
    contentType: profile.content_type,
    variantMode: calibratedMode,
    companyId: input.companyId,
  });
  // Sample count behind the calibration factor (purely informational).
  const calibrationSampleCount = (() => {
    if (calibrationFactor === 1.0) return 0;
    const { getCostAccuracySummary } = require('./costObservationStore') as typeof import('./costObservationStore');
    const summary = getCostAccuracySummary({
      contentType: profile.content_type,
      variantMode: calibratedMode,
      companyId: input.companyId,
    });
    return summary[0]?.sample_count ?? 0;
  })();

  const generationUsdPerAsset = Number(
    (profile.render_cost_usd * calibrationFactor).toFixed(4),
  );
  const adaptationUsdPerAsset = Number(
    (profile.adaptation_cost_per_platform_usd * secondaryPlatforms.length).toFixed(4),
  );
  const perAssetEstimatedUsd = Number(
    (generationUsdPerAsset + adaptationUsdPerAsset).toFixed(4),
  );

  // Operator-facing credits = profile credits × calibration factor,
  // OR the legacy flat baseline when CAMPAIGN_VARIANT_PER_ASSET_CREDITS
  // is explicitly set (back-compat).
  const flatOverride = process.env.CAMPAIGN_VARIANT_PER_ASSET_CREDITS;
  const perAssetCredits = flatOverride
    ? perAssetCreditsFlat
    : Number((profile.expected_credits_per_asset * calibrationFactor).toFixed(4));

  if (!plan) {
    const expected = 1;
    const totalUsd = Number((perAssetEstimatedUsd * expected).toFixed(4));
    const totalCredits = Number((perAssetCredits * expected).toFixed(4));
    const usdBand = applyVarianceBand(totalUsd, profile.variance_pct);
    const creditsBand = applyVarianceBand(totalCredits, profile.variance_pct);
    return {
      has_variant_config: false,
      mode: null,
      strategy_id: null,
      expected_asset_count: expected,
      per_asset_credits: perAssetCredits,
      total_estimated_credits: totalCredits,
      per_asset_estimated_usd: perAssetEstimatedUsd,
      total_estimated_usd: totalUsd,
      summary: summarize(null, expected, totalCredits, { low: creditsBand.low, high: creditsBand.high }),
      decisions: [],
      detail: {
        content_type: profile.content_type,
        primary_platform: primaryPlatform,
        secondary_platforms: secondaryPlatforms,
        generation_usd_per_asset: generationUsdPerAsset,
        adaptation_usd_per_asset: adaptationUsdPerAsset,
        total_estimated_usd_band: usdBand,
        total_estimated_credits_band: creditsBand,
        variance_pct: profile.variance_pct,
        calibration_factor: calibrationFactor,
        calibration_sample_count: calibrationSampleCount,
      },
    };
  }

  const expected = plan.decisions.length;
  const totalCredits = Number((perAssetCredits * expected).toFixed(4));
  const totalUsd = Number((perAssetEstimatedUsd * expected).toFixed(4));
  // Back-compat: when the legacy flat-USD env override is set, use it
  // exactly so existing tests/operators get the same numbers.
  const usingFlatUsd = !!process.env.CAMPAIGN_VARIANT_PER_ASSET_USD;
  const finalPerAssetUsd = usingFlatUsd ? perAssetUsdFlat : perAssetEstimatedUsd;
  const finalTotalUsd = usingFlatUsd
    ? Number((perAssetUsdFlat * expected).toFixed(4))
    : totalUsd;
  const usdBand = applyVarianceBand(finalTotalUsd, profile.variance_pct);
  const creditsBand = applyVarianceBand(totalCredits, profile.variance_pct);

  return {
    has_variant_config: true,
    mode: plan.mode,
    strategy_id: plan.strategy_id,
    expected_asset_count: expected,
    per_asset_credits: perAssetCredits,
    total_estimated_credits: totalCredits,
    per_asset_estimated_usd: finalPerAssetUsd,
    total_estimated_usd: finalTotalUsd,
    summary: summarize(plan.mode, expected, totalCredits, { low: creditsBand.low, high: creditsBand.high }),
    decisions: plan.decisions,
    detail: {
      content_type: profile.content_type,
      primary_platform: primaryPlatform,
      secondary_platforms: secondaryPlatforms,
      generation_usd_per_asset: generationUsdPerAsset,
      adaptation_usd_per_asset: adaptationUsdPerAsset,
      total_estimated_usd_band: usdBand,
      total_estimated_credits_band: creditsBand,
      variance_pct: profile.variance_pct,
      calibration_factor: calibrationFactor,
      calibration_sample_count: calibrationSampleCount,
    },
  };
}
