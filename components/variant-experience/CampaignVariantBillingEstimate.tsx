/**
 * CampaignVariantBillingEstimate (Fan-Out Completion — Phase 4 + 5).
 *
 * Read-only pre-execution surface that calls
 * `/api/creator-intelligence/campaign-variant-estimate` and displays:
 *
 *   - Expected asset count (1 / 1 / N / N for the four modes)
 *   - Estimated total credits + per-asset breakdown
 *   - Continue / Cancel buttons
 *
 * STRICT SCOPE:
 *   - Read-only client. Does NOT charge anything; does NOT trigger
 *     generation. The Continue button signals the parent surface to
 *     proceed; the parent owns the actual execution path.
 *   - No new billing contract. No new campaign contract.
 *   - When the campaign has no variant config persisted, displays a
 *     dimmed "no variant config — single asset" baseline.
 *
 * Usage:
 *
 *   <CampaignVariantBillingEstimate
 *     companyId={companyId}
 *     campaignId={campaignId}
 *     onContinue={() => triggerExecution()}
 *     onCancel={() => closeDialog()}
 *   />
 */

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/apiFetch';

export type CampaignVariantBillingEstimatePayload = {
  has_variant_config: boolean;
  mode: 'single_variant' | 'best_variant' | 'top_3_variants' | 'experiment' | null;
  strategy_id: string | null;
  expected_asset_count: number;
  per_asset_credits: number;
  total_estimated_credits: number;
  per_asset_estimated_usd: number;
  total_estimated_usd: number;
  summary: string;
  decisions: ReadonlyArray<{
    rank: number;
    variant_id: string;
    variant_family: string;
    reasoning: string;
    source: string;
  }>;
  /** Cost Estimate Accuracy — Phase 3+4+6. Always present. */
  detail?: {
    content_type: 'image' | 'carousel' | 'infographic';
    primary_platform: string | null;
    secondary_platforms: string[];
    generation_usd_per_asset: number;
    adaptation_usd_per_asset: number;
    total_estimated_usd_band: { low: number; expected: number; high: number };
    total_estimated_credits_band: { low: number; expected: number; high: number };
    variance_pct: number;
    calibration_factor: number;
    calibration_sample_count: number;
  };
};

type Props = {
  companyId: string;
  campaignId: string;
  /** Called when the operator confirms. Receives the estimate so the
   *  caller can audit-log the confirmed asset count. */
  onContinue?: (estimate: CampaignVariantBillingEstimatePayload) => void;
  /** Called when the operator dismisses. */
  onCancel?: () => void;
  className?: string;
};

export const CampaignVariantBillingEstimate: React.FC<Props> = ({
  companyId,
  campaignId,
  onContinue,
  onCancel,
  className,
}) => {
  const [estimate, setEstimate] = useState<CampaignVariantBillingEstimatePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const params = new URLSearchParams({ company_id: companyId, campaign_id: campaignId });
        const response = await apiFetch(`/api/creator-intelligence/campaign-variant-estimate?${params.toString()}`);
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !payload?.success) {
          setError(payload?.error || `Request failed (${response.status})`);
          setEstimate(null);
        } else {
          setEstimate(payload.estimate as CampaignVariantBillingEstimatePayload);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load estimate');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, campaignId]);

  const container = className ?? 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm';

  if (loading) {
    return (
      <div className={container}>
        <p className="text-sm text-gray-500">Computing variant execution estimate…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={container}>
        <p className="text-sm text-rose-700">Estimate unavailable: {error}</p>
      </div>
    );
  }
  if (!estimate) {
    return (
      <div className={container}>
        <p className="text-sm text-gray-500">No estimate available.</p>
      </div>
    );
  }

  const modeLabel = (() => {
    switch (estimate.mode) {
      case 'single_variant': return 'Single Variant';
      case 'best_variant': return 'Best Variant';
      case 'top_3_variants': return 'Top 3 Variants';
      case 'experiment': return 'Experiment';
      default: return 'No variant configuration';
    }
  })();

  return (
    <div className={container}>
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Execution estimate</h3>
        <p className="mt-1 text-xs text-gray-500">
          This run will generate the following assets and consume the credits
          shown below. Actual billing flows through the existing per-asset
          charging path.
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-gray-500">Mode</dt>
        <dd className="font-medium text-gray-900">{modeLabel}</dd>
        <dt className="text-gray-500">Estimated assets</dt>
        <dd className="font-semibold text-gray-900">{estimate.expected_asset_count}</dd>
        <dt className="text-gray-500">Estimated credits</dt>
        <dd className="font-semibold text-gray-900">
          {estimate.total_estimated_credits}
          <span className="ml-2 text-xs font-normal text-gray-500">
            ({estimate.per_asset_credits} per asset)
          </span>
          {estimate.detail?.total_estimated_credits_band ? (
            <span className="ml-2 text-xs font-medium text-gray-600">
              {estimate.detail.total_estimated_credits_band.low}–{estimate.detail.total_estimated_credits_band.high}
            </span>
          ) : null}
        </dd>
        {estimate.detail ? (
          <>
            <dt className="text-gray-500">Estimated USD</dt>
            <dd className="font-mono text-xs text-gray-700">
              ${estimate.total_estimated_usd.toFixed(4)}
              {estimate.detail.total_estimated_usd_band ? (
                <span className="ml-2 text-[10px] text-gray-500">
                  (${estimate.detail.total_estimated_usd_band.low.toFixed(4)}–
                  ${estimate.detail.total_estimated_usd_band.high.toFixed(4)})
                </span>
              ) : null}
            </dd>
            <dt className="text-gray-500">Generation / Adaptation</dt>
            <dd className="font-mono text-[11px] text-gray-700">
              ${estimate.detail.generation_usd_per_asset.toFixed(4)} gen
              + ${estimate.detail.adaptation_usd_per_asset.toFixed(4)} adapt
              <span className="ml-1 text-gray-500">per asset</span>
            </dd>
          </>
        ) : null}
        {estimate.strategy_id ? (
          <>
            <dt className="text-gray-500">Strategy</dt>
            <dd className="font-mono text-xs text-gray-700">{estimate.strategy_id}</dd>
          </>
        ) : null}
      </dl>
      {estimate.decisions.length > 0 ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
            Variants planned
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-gray-700">
            {estimate.decisions.map((d) => (
              <li key={d.variant_id}>
                <span className="font-mono">{d.variant_family.toUpperCase()}</span>
                {' — '}
                {d.reasoning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] font-medium text-gray-600">{estimate.summary}</p>
      {estimate.detail && estimate.detail.calibration_sample_count > 0 ? (
        <p className="mt-1 text-[10px] text-gray-500">
          Calibrated against {estimate.detail.calibration_sample_count}{' '}
          recent observation{estimate.detail.calibration_sample_count === 1 ? '' : 's'}
          {' '}(factor {estimate.detail.calibration_factor.toFixed(3)}).
        </p>
      ) : null}
      {(onContinue || onCancel) ? (
        <div className="mt-4 flex gap-2">
          {onContinue ? (
            <button
              type="button"
              onClick={() => onContinue(estimate)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            >
              Continue
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
