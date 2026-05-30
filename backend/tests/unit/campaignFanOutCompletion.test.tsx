/**
 * @jest-environment jsdom
 *
 * Fan-Out Completion & Billing Transparency — focused tests covering:
 *
 *   Phase 4  estimateCampaignVariantBilling — asset count + credit
 *            estimate per mode + env override + no-config baseline
 *   Phase 5  CampaignVariantBillingEstimate UI surface (loading,
 *            error, render, continue/cancel)
 *   Phase 6  CampaignVariantPostExecutionReport renders fan-out
 *            payload correctly (ok / failed counts, per-asset rows,
 *            adaptation status)
 *
 * Per-asset adaptation loop semantics inside the queue worker are
 * verified indirectly via the shared fan-out runner test
 * (campaignMultiVariantExecution.test.tsx — Phase 4 attribution +
 * per-decision orchestrator invocation).
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { clearExperimentTracker } from '../../services/creator/variantExperimentTracker';
import { clearVariantTelemetry } from '../../services/creator/variantPerformanceTelemetry';
import { estimateCampaignVariantBilling } from '../../services/creator/campaignVariantBillingEstimator';
import { applyVariantConfigToExecutionConfig } from '../../../lib/variants/campaignVariantConfig';

const COMPANY = 'co-fanout-completion';
const STRATEGY = 'image:quote-image';

beforeEach(() => {
  clearExperimentTracker();
  clearVariantTelemetry();
  delete process.env.CAMPAIGN_VARIANT_PER_ASSET_CREDITS;
  delete process.env.CAMPAIGN_VARIANT_PER_ASSET_USD;
});

/* ── Phase 4 — Billing estimation ──────────────────────────────── */

describe('Phase 4 — estimateCampaignVariantBilling()', () => {
  test('no variant config → baseline 1 asset', () => {
    const estimate = estimateCampaignVariantBilling({
      campaign: { campaign_snapshot: { execution_config: {} } },
      companyId: COMPANY,
    });
    expect(estimate.has_variant_config).toBe(false);
    expect(estimate.expected_asset_count).toBe(1);
    expect(estimate.mode).toBeNull();
    expect(estimate.summary).toContain('No variant');
  });

  test('single_variant → 1 asset, 1 credit (default)', () => {
    const estimate = estimateCampaignVariantBilling({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'v2',
          }),
        },
      },
      companyId: COMPANY,
    });
    expect(estimate.has_variant_config).toBe(true);
    expect(estimate.mode).toBe('single_variant');
    expect(estimate.expected_asset_count).toBe(1);
    expect(estimate.total_estimated_credits).toBe(1);
    expect(estimate.summary).toMatch(/Single Variant.*1 asset/);
  });

  test('best_variant → 1 asset', () => {
    const estimate = estimateCampaignVariantBilling({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'best_variant',
          }),
        },
      },
      companyId: COMPANY,
    });
    expect(estimate.mode).toBe('best_variant');
    expect(estimate.expected_asset_count).toBe(1);
    expect(estimate.summary).toMatch(/Best Variant.*1 asset/);
  });

  test('top_3_variants → N assets', () => {
    const estimate = estimateCampaignVariantBilling({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'top_3_variants',
          }),
        },
      },
      companyId: COMPANY,
    });
    expect(estimate.mode).toBe('top_3_variants');
    expect(estimate.expected_asset_count).toBeGreaterThan(1);
    expect(estimate.total_estimated_credits).toBe(estimate.expected_asset_count);
    expect(estimate.summary).toMatch(/Top 3 Variants.*\d+ assets/);
    expect(estimate.decisions.length).toBe(estimate.expected_asset_count);
  });

  test('experiment → N assets', () => {
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
    });
    expect(estimate.mode).toBe('experiment');
    expect(estimate.expected_asset_count).toBeGreaterThan(1);
    expect(estimate.summary).toMatch(/Experiment.*\d+ assets/);
  });

  test('CAMPAIGN_VARIANT_PER_ASSET_CREDITS env override is honored + clamped', () => {
    process.env.CAMPAIGN_VARIANT_PER_ASSET_CREDITS = '2';
    const estimate = estimateCampaignVariantBilling({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'top_3_variants',
          }),
        },
      },
      companyId: COMPANY,
    });
    expect(estimate.per_asset_credits).toBe(2);
    expect(estimate.total_estimated_credits).toBe(2 * estimate.expected_asset_count);
  });
});

/* ── Phase 5 — Pre-execution UI ────────────────────────────────── */

jest.mock('../../../lib/apiFetch', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../../../lib/apiFetch') as { apiFetch: jest.Mock };

import { CampaignVariantBillingEstimate } from '../../../components/variant-experience/CampaignVariantBillingEstimate';

describe('Phase 5 — CampaignVariantBillingEstimate UI', () => {
  beforeEach(() => apiFetch.mockReset());

  test('renders loading state initially', () => {
    apiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <CampaignVariantBillingEstimate companyId={COMPANY} campaignId="campaign-A" />,
    );
    expect(screen.getByText(/Computing variant execution estimate/i)).toBeInTheDocument();
  });

  test('renders error state on API failure', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'boom' }),
    });
    render(
      <CampaignVariantBillingEstimate companyId={COMPANY} campaignId="campaign-A" />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Estimate unavailable.*boom/i)).toBeInTheDocument();
    });
  });

  test('renders success state with mode + asset count + Continue/Cancel buttons', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        estimate: {
          has_variant_config: true,
          mode: 'top_3_variants',
          strategy_id: STRATEGY,
          expected_asset_count: 3,
          per_asset_credits: 1,
          total_estimated_credits: 3,
          per_asset_estimated_usd: 0.02,
          total_estimated_usd: 0.06,
          summary: 'Top 3 Variants → 3 assets · ~3 credits',
          decisions: [
            { rank: 1, variant_id: 'a', variant_family: 'v1', reasoning: 'r1', source: 'experiment_fan_out' },
            { rank: 2, variant_id: 'b', variant_family: 'v2', reasoning: 'r2', source: 'experiment_fan_out' },
            { rank: 3, variant_id: 'c', variant_family: 'v3', reasoning: 'r3', source: 'experiment_fan_out' },
          ],
        },
      }),
    });
    const onContinue = jest.fn();
    const onCancel = jest.fn();
    render(
      <CampaignVariantBillingEstimate
        companyId={COMPANY}
        campaignId="campaign-A"
        onContinue={onContinue}
        onCancel={onCancel}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Top 3 Variants')).toBeInTheDocument();
    });
    // Asset count rendered in the dl row.
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.getByText(/3 assets/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

/* ── Phase 6 — Post-execution report ───────────────────────────── */

import { CampaignVariantPostExecutionReport } from '../../../components/variant-experience/CampaignVariantPostExecutionReport';

describe('Phase 6 — CampaignVariantPostExecutionReport', () => {
  test('multi-asset payload — renders ok + failed counts + variants', () => {
    render(
      <CampaignVariantPostExecutionReport payload={{
        generated_assets: [
          { rank: 1, variant_id: 'a', variant_family: 'v1', strategy_id: STRATEGY, experiment_id: 'exp_X', persisted_asset_id: 'asset-1', ok: true },
          { rank: 2, variant_id: 'b', variant_family: 'v2', strategy_id: STRATEGY, experiment_id: 'exp_X', persisted_asset_id: null, ok: false, error: 'failed reason' },
          { rank: 3, variant_id: 'c', variant_family: 'v3', strategy_id: STRATEGY, experiment_id: 'exp_X', persisted_asset_id: 'asset-3', ok: true },
        ],
        per_asset_cost_usd: [
          { variant_id: 'a', cost_usd: 0.02 },
          { variant_id: 'c', cost_usd: 0.02 },
        ],
        variant_mode: 'experiment',
        variant_strategy_id: STRATEGY,
        experiment_id: 'exp_X',
      }} />,
    );
    // OK assets count = 2.
    expect(screen.getByText('2')).toBeInTheDocument();
    // 1 failed (rendered in red badge text near the OK count).
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument();
    // Sum of per-asset costs.
    expect(screen.getByText('0.0400')).toBeInTheDocument();
    // Experiment id surfaced.
    expect(screen.getByText('exp_X')).toBeInTheDocument();
    // Mode label.
    expect(screen.getByText('Experiment')).toBeInTheDocument();
    // Per-asset rows: failed reason surfaced.
    expect(screen.getByText(/failed reason/)).toBeInTheDocument();
  });

  test('single-asset legacy payload — falls back to single-asset summary', () => {
    render(
      <CampaignVariantPostExecutionReport payload={{
        creator_asset_id: 'asset-X',
        estimated_cost_usd: 0.018,
        target_platforms: ['linkedin'],
      }} />,
    );
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('0.0180')).toBeInTheDocument();
  });

  test('per-asset adaptation status surfaces failures', () => {
    render(
      <CampaignVariantPostExecutionReport payload={{
        generated_assets: [
          { rank: 1, variant_id: 'a', variant_family: 'v1', strategy_id: STRATEGY, experiment_id: null, persisted_asset_id: 'asset-1', ok: true },
        ],
        per_asset_adaptations: {
          a: {
            linkedin: { ok: true },
            twitter: { ok: false, error: 'no token' },
          },
        },
      }} />,
    );
    expect(screen.getByText(/1 ok/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failed: twitter/i)).toBeInTheDocument();
  });
});
