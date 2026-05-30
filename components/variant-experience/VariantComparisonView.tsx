/**
 * VariantComparisonView
 *
 * Side-by-side comparison of V1 / V2 / V3 for a single strategy.
 * Shows the renderer's headline / branding / density / CTA profile
 * strings PLUS performance metrics when leaderboard data exists.
 *
 * Pure presentational. Consumes `variants.catalog` + variant
 * leaderboard rows from the strategy-analytics endpoint.
 */

import React from 'react';
import type { VariantDefinition } from './useVariantApi';

export type VariantComparisonRow = {
  variant: VariantDefinition;
  /** Optional performance metrics — null when no engagement data yet. */
  metrics: null | {
    engagementRate: number;
    saveRate: number;
    shareRate: number;
    sampleSize: number;
  };
  /** Optional render profile strings — populated when the asset's
   *  `applied_render_strategy` envelope is available. */
  profiles?: {
    typography?: string;
    branding?: string;
    density?: string;
    cta?: string;
  };
};

function pct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

type Props = {
  strategyId: string;
  rows: VariantComparisonRow[];
  className?: string;
};

export const VariantComparisonView: React.FC<Props> = ({ strategyId, rows, className }) => {
  if (!rows || rows.length === 0) {
    return (
      <div className={className ?? 'rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500'}>
        No variants declared for {strategyId}.
      </div>
    );
  }
  return (
    <section className={className ?? 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm'}>
      <header className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Comparison · {strategyId}
        </p>
        <h3 className="mt-1 text-base font-semibold text-gray-900">
          V1 · V2 · V3 side-by-side
        </h3>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.variant.variant_id}
            className="flex h-full flex-col rounded-lg border border-gray-200 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {row.variant.variant_family.toUpperCase()}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-gray-900">
                  {row.variant.display_name}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-600">
              {row.variant.description}
            </p>
            <dl className="mt-3 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <dt className="font-semibold uppercase tracking-wider text-gray-500">Headline</dt>
                <dd className="text-gray-700">{row.profiles?.typography ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-semibold uppercase tracking-wider text-gray-500">Branding</dt>
                <dd className="text-gray-700">{row.profiles?.branding ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-semibold uppercase tracking-wider text-gray-500">Density</dt>
                <dd className="text-gray-700">{row.profiles?.density ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-semibold uppercase tracking-wider text-gray-500">CTA</dt>
                <dd className="text-gray-700">{row.profiles?.cta ?? '—'}</dd>
              </div>
            </dl>
            <div className="mt-auto border-t border-dashed border-gray-200 pt-2">
              {row.metrics ? (
                <dl className="grid grid-cols-2 gap-1 text-[11px]">
                  <div>
                    <dt className="font-semibold uppercase tracking-wider text-gray-500">Engagement</dt>
                    <dd className="font-semibold text-gray-800">{pct(row.metrics.engagementRate)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wider text-gray-500">Samples</dt>
                    <dd className="font-semibold text-gray-800">{Math.round(row.metrics.sampleSize)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wider text-gray-500">Saves</dt>
                    <dd className="font-semibold text-gray-800">{pct(row.metrics.saveRate)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wider text-gray-500">Shares</dt>
                    <dd className="font-semibold text-gray-800">{pct(row.metrics.shareRate)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-[11px] italic text-gray-500">No engagement data yet</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
