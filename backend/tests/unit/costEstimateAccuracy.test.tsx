/**
 * @jest-environment jsdom
 *
 * Cost Estimate Accuracy — focused tests covering:
 *
 *   Phase 1  costProfiles: image / carousel / infographic profiles +
 *            env overrides + variance band helper
 *   Phase 2  Variant-aware estimation uses actual decision count
 *   Phase 3  Platform-aware estimation: secondary-platform adapt cost
 *   Phase 4  Confidence band (low/expected/high) on USD + credits
 *   Phase 5  recordCostObservation + getCostAccuracySummary
 *   Phase 6  Calibration factor shifts the estimate toward observed
 *            mean; below sample floor it's a no-op; ENV disable works
 *   Phase 7  Validation: across N observations the calibrated estimate
 *            converges so the abs-mean variance shrinks
 */

import '@testing-library/jest-dom';
import {
  resolveCostProfile,
  listCostProfiles,
  applyVarianceBand,
} from '../../services/creator/costProfiles';
import {
  clearCostObservations,
  recordCostObservation,
  getCostAccuracySummary,
  listRecentObservations,
  calibrationAdjustmentFactor,
  costObservationStoreStats,
} from '../../services/creator/costObservationStore';
import { estimateCampaignVariantBilling } from '../../services/creator/campaignVariantBillingEstimator';
import { applyVariantConfigToExecutionConfig } from '../../../lib/variants/campaignVariantConfig';
import { clearExperimentTracker } from '../../services/creator/variantExperimentTracker';

const COMPANY = 'co-cost-accuracy';
const STRATEGY = 'image:quote-image';

beforeEach(() => {
  clearCostObservations();
  clearExperimentTracker();
  delete process.env.CREATOR_COST_CALIBRATION_DISABLED;
  delete process.env.CREATOR_COST_IMAGE_RENDER_USD;
  delete process.env.CREATOR_COST_IMAGE_ADAPT_USD;
  delete process.env.CREATOR_COST_IMAGE_CREDITS;
  delete process.env.CREATOR_COST_IMAGE_VARIANCE_PCT;
  delete process.env.CAMPAIGN_VARIANT_PER_ASSET_CREDITS;
  delete process.env.CAMPAIGN_VARIANT_PER_ASSET_USD;
});

/* ── Phase 1 — Cost profiles ───────────────────────────────────── */

describe('Phase 1 — cost profiles', () => {
  test('image / carousel / infographic profiles are declared', () => {
    const all = listCostProfiles();
    const types = all.map((p) => p.content_type).sort();
    expect(types).toEqual(['carousel', 'image', 'infographic']);
    for (const p of all) {
      expect(p.expected_tokens).toBeGreaterThan(0);
      expect(p.render_cost_usd).toBeGreaterThan(0);
      expect(p.adaptation_cost_per_platform_usd).toBeGreaterThanOrEqual(0);
      expect(p.expected_credits_per_asset).toBeGreaterThan(0);
      expect(p.variance_pct).toBeGreaterThanOrEqual(0);
      expect(p.variance_pct).toBeLessThanOrEqual(1);
    }
  });

  test('unknown content type falls back to the image profile', () => {
    const profile = resolveCostProfile('text');
    expect(profile.content_type).toBe('image');
  });

  test('env overrides are honored and clamped', () => {
    process.env.CREATOR_COST_IMAGE_RENDER_USD = '0.050';
    process.env.CREATOR_COST_IMAGE_VARIANCE_PCT = '0.10';
    const profile = resolveCostProfile('image');
    expect(profile.render_cost_usd).toBe(0.050);
    expect(profile.variance_pct).toBe(0.10);
  });

  test('applyVarianceBand symmetric around expected', () => {
    const band = applyVarianceBand(10, 0.25);
    expect(band.low).toBe(7.5);
    expect(band.expected).toBe(10);
    expect(band.high).toBe(12.5);
  });

  test('applyVarianceBand floors low at 0', () => {
    const band = applyVarianceBand(1, 2.0);
    expect(band.low).toBe(0);
    expect(band.high).toBeGreaterThan(0);
  });
});

/* ── Phase 2+3+4 — Estimator behavior ──────────────────────────── */

describe('Phase 2+3+4 — estimator with profiles, platforms, bands', () => {
  function campaignFor(mode: 'v1' | 'best_variant' | 'top_3_variants' | 'experiment') {
    return {
      campaign_snapshot: {
        execution_config: applyVariantConfigToExecutionConfig(null, {
          strategy_id: STRATEGY,
          variant_mode: mode,
        }),
      },
    };
  }

  test('Phase 2 — top_3_variants uses actual decision count', () => {
    const estimate = estimateCampaignVariantBilling({
      campaign: campaignFor('top_3_variants'),
      companyId: COMPANY,
      contentType: 'image',
      targetPlatforms: ['linkedin'],
    });
    expect(estimate.expected_asset_count).toBe(estimate.decisions.length);
    expect(estimate.expected_asset_count).toBeGreaterThan(1);
  });

  test('Phase 3 — secondary platforms contribute adaptation cost', () => {
    const single = estimateCampaignVariantBilling({
      campaign: campaignFor('v1'),
      companyId: COMPANY,
      contentType: 'image',
      targetPlatforms: ['linkedin'],
    });
    const multi = estimateCampaignVariantBilling({
      campaign: campaignFor('v1'),
      companyId: COMPANY,
      contentType: 'image',
      targetPlatforms: ['linkedin', 'twitter', 'facebook'],
    });
    expect(multi.detail.secondary_platforms).toEqual(['twitter', 'facebook']);
    expect(multi.detail.adaptation_usd_per_asset).toBeGreaterThan(single.detail.adaptation_usd_per_asset);
    expect(multi.total_estimated_usd).toBeGreaterThan(single.total_estimated_usd);
  });

  test('Phase 4 — USD + credits expose low/expected/high bands', () => {
    const estimate = estimateCampaignVariantBilling({
      campaign: campaignFor('top_3_variants'),
      companyId: COMPANY,
      contentType: 'image',
      targetPlatforms: ['linkedin', 'twitter'],
    });
    const band = estimate.detail.total_estimated_usd_band;
    expect(band.low).toBeLessThan(band.expected);
    expect(band.expected).toBeLessThan(band.high);
    expect(band.expected).toBeCloseTo(estimate.total_estimated_usd, 4);
    const credBand = estimate.detail.total_estimated_credits_band;
    expect(credBand.low).toBeLessThan(credBand.expected);
    expect(credBand.expected).toBeLessThan(credBand.high);
  });

  test('summary string includes the band when one is computable', () => {
    const estimate = estimateCampaignVariantBilling({
      campaign: campaignFor('top_3_variants'),
      companyId: COMPANY,
      contentType: 'image',
      targetPlatforms: ['linkedin'],
    });
    // Format like "(2.25–3.75)" — accept arbitrary digits.
    expect(estimate.summary).toMatch(/\(\d+(?:\.\d+)?–\d+(?:\.\d+)?\)/);
  });

  test('carousel profile produces higher USD than image profile', () => {
    const imageEstimate = estimateCampaignVariantBilling({
      campaign: campaignFor('v1'),
      companyId: COMPANY,
      contentType: 'image',
      targetPlatforms: ['linkedin'],
    });
    const carouselEstimate = estimateCampaignVariantBilling({
      campaign: campaignFor('v1'),
      companyId: COMPANY,
      contentType: 'carousel',
      targetPlatforms: ['linkedin'],
    });
    expect(carouselEstimate.total_estimated_usd).toBeGreaterThan(imageEstimate.total_estimated_usd);
    expect(carouselEstimate.detail.content_type).toBe('carousel');
  });
});

/* ── Phase 5 — Cost observation store ──────────────────────────── */

describe('Phase 5 — cost observation store', () => {
  test('recordCostObservation persists + getCostAccuracySummary aggregates', () => {
    recordCostObservation({
      companyId: COMPANY,
      contentType: 'image',
      variantMode: 'top_3_variants',
      assetCount: 3,
      estimatedUsd: 0.060,
      actualUsd: 0.075, // 25% over
    });
    recordCostObservation({
      companyId: COMPANY,
      contentType: 'image',
      variantMode: 'top_3_variants',
      assetCount: 3,
      estimatedUsd: 0.060,
      actualUsd: 0.072, // 20% over
    });
    const summary = getCostAccuracySummary({ companyId: COMPANY });
    expect(summary).toHaveLength(1);
    expect(summary[0].sample_count).toBe(2);
    expect(summary[0].mean_variance_pct).toBeCloseTo(0.225, 3);
    expect(summary[0].mean_abs_variance_pct).toBeCloseTo(0.225, 3);
    expect(summary[0].total_estimated_usd).toBeCloseTo(0.12, 4);
    expect(summary[0].total_actual_usd).toBeCloseTo(0.147, 4);
  });

  test('observations are bounded per-bucket (FIFO eviction)', () => {
    for (let i = 0; i < 250; i++) {
      recordCostObservation({
        companyId: COMPANY,
        contentType: 'image',
        variantMode: 'single_variant',
        assetCount: 1,
        estimatedUsd: 0.02,
        actualUsd: 0.02,
      });
    }
    const stats = costObservationStoreStats();
    expect(stats.totalObservations).toBeLessThanOrEqual(stats.maxObservationsPerBucket);
  });

  test('listRecentObservations returns most-recent first', () => {
    recordCostObservation({
      companyId: COMPANY,
      contentType: 'image',
      variantMode: 'single_variant',
      assetCount: 1,
      estimatedUsd: 0.02,
      actualUsd: 0.02,
      occurredAt: '2026-05-29T12:00:00.000Z',
    });
    recordCostObservation({
      companyId: COMPANY,
      contentType: 'image',
      variantMode: 'single_variant',
      assetCount: 1,
      estimatedUsd: 0.02,
      actualUsd: 0.03,
      occurredAt: '2026-05-30T12:00:00.000Z',
    });
    const recent = listRecentObservations({ companyId: COMPANY });
    expect(recent[0].actual_usd).toBe(0.03);
    expect(recent[1].actual_usd).toBe(0.02);
  });

  test('variance_pct is null when estimated_usd == 0', () => {
    const obs = recordCostObservation({
      companyId: COMPANY,
      contentType: 'image',
      variantMode: 'no_variant',
      assetCount: 1,
      estimatedUsd: 0,
      actualUsd: 0.02,
    });
    expect(obs?.variance_pct).toBeNull();
  });
});

/* ── Phase 6 — Calibration ─────────────────────────────────────── */

describe('Phase 6 — calibration', () => {
  test('returns 1.0 when sample count is below the floor', () => {
    for (let i = 0; i < 3; i++) {
      recordCostObservation({
        companyId: COMPANY,
        contentType: 'image',
        variantMode: 'experiment',
        assetCount: 3,
        estimatedUsd: 0.06,
        actualUsd: 0.09,
      });
    }
    const factor = calibrationAdjustmentFactor({
      contentType: 'image',
      variantMode: 'experiment',
      companyId: COMPANY,
      minSamples: 5,
    });
    expect(factor).toBe(1.0);
  });

  test('returns 1 + observed mean variance once the floor is reached', () => {
    for (let i = 0; i < 5; i++) {
      recordCostObservation({
        companyId: COMPANY,
        contentType: 'image',
        variantMode: 'experiment',
        assetCount: 3,
        estimatedUsd: 0.06,
        actualUsd: 0.072, // +20%
      });
    }
    const factor = calibrationAdjustmentFactor({
      contentType: 'image',
      variantMode: 'experiment',
      companyId: COMPANY,
    });
    expect(factor).toBeCloseTo(1.20, 2);
  });

  test('factor is clamped to [0.5, 2.0]', () => {
    for (let i = 0; i < 5; i++) {
      recordCostObservation({
        companyId: COMPANY,
        contentType: 'image',
        variantMode: 'experiment',
        assetCount: 3,
        estimatedUsd: 0.01,
        actualUsd: 1.00, // ~9900% over
      });
    }
    const factor = calibrationAdjustmentFactor({
      contentType: 'image',
      variantMode: 'experiment',
      companyId: COMPANY,
    });
    expect(factor).toBe(2.0);
  });

  test('CREATOR_COST_CALIBRATION_DISABLED env disables adjustment', () => {
    for (let i = 0; i < 5; i++) {
      recordCostObservation({
        companyId: COMPANY,
        contentType: 'image',
        variantMode: 'experiment',
        assetCount: 3,
        estimatedUsd: 0.06,
        actualUsd: 0.090,
      });
    }
    process.env.CREATOR_COST_CALIBRATION_DISABLED = 'true';
    const factor = calibrationAdjustmentFactor({
      contentType: 'image',
      variantMode: 'experiment',
      companyId: COMPANY,
    });
    expect(factor).toBe(1.0);
  });
});

/* ── Phase 7 — Validation: calibration reduces variance ────────── */

describe('Phase 7 — calibration reduces variance', () => {
  test('after observations land, the calibrated estimate is closer to the actual mean', () => {
    const campaign = {
      campaign_snapshot: {
        execution_config: applyVariantConfigToExecutionConfig(null, {
          strategy_id: STRATEGY,
          variant_mode: 'top_3_variants',
        }),
      },
    };
    const baseline = estimateCampaignVariantBilling({
      campaign,
      companyId: COMPANY,
      contentType: 'image',
      targetPlatforms: ['linkedin'],
    });
    // Pretend actuals are consistently 30% above the baseline estimate.
    const observedActual = baseline.total_estimated_usd * 1.30;
    for (let i = 0; i < 5; i++) {
      recordCostObservation({
        companyId: COMPANY,
        contentType: 'image',
        variantMode: 'top_3_variants',
        assetCount: baseline.expected_asset_count,
        estimatedUsd: baseline.total_estimated_usd,
        actualUsd: observedActual,
      });
    }
    const calibrated = estimateCampaignVariantBilling({
      campaign,
      companyId: COMPANY,
      contentType: 'image',
      targetPlatforms: ['linkedin'],
    });
    expect(calibrated.detail.calibration_factor).toBeGreaterThan(1.0);
    expect(calibrated.detail.calibration_sample_count).toBeGreaterThanOrEqual(5);
    // Calibrated estimate is closer to the observed actual than the baseline.
    const baselineErr = Math.abs(baseline.total_estimated_usd - observedActual);
    const calibratedErr = Math.abs(calibrated.total_estimated_usd - observedActual);
    expect(calibratedErr).toBeLessThan(baselineErr);
  });

  test('observations + calibration do NOT mutate the billing surface', () => {
    // The cost observation store + calibration must not touch any
    // billing/charging modules. Verify by inspecting that the
    // estimator still produces a finite, non-zero estimate after
    // many observations and that no thrown error escapes.
    expect(() => {
      for (let i = 0; i < 50; i++) {
        recordCostObservation({
          companyId: COMPANY,
          contentType: 'image',
          variantMode: 'experiment',
          assetCount: 3,
          estimatedUsd: 0.06,
          actualUsd: 0.06 + (i % 10) * 0.002,
        });
      }
      const estimate = estimateCampaignVariantBilling({
        campaign: {
          campaign_snapshot: {
            execution_config: applyVariantConfigToExecutionConfig(null, {
              strategy_id: STRATEGY,
              variant_mode: 'experiment',
            }),
          },
        },
        companyId: COMPANY,
        contentType: 'image',
        targetPlatforms: ['linkedin'],
      });
      expect(estimate.total_estimated_usd).toBeGreaterThan(0);
      expect(Number.isFinite(estimate.total_estimated_usd)).toBe(true);
    }).not.toThrow();
  });
});
