/**
 * CampaignVariantPostExecutionReport (Fan-Out Completion — Phase 6).
 *
 * Read-only result surface that consumes the response from a
 * fan-out-enabled generation call (either the Direct API or queue
 * worker output) and renders:
 *
 *   - Assets generated (ok / failed counts + per-asset rows)
 *   - Credits consumed (sum of per_asset_cost_usd entries +
 *     fallback to the legacy total when not present)
 *   - Variants generated (deduped variant_family list)
 *   - Experiment id (when present)
 *
 * STRICT SCOPE:
 *   - Display only. Does NOT mutate any record.
 *   - Single-asset callers can still pass the legacy response shape
 *     (no `generated_assets` field) — the report falls back to the
 *     single-asset summary so this component is safe to mount
 *     unconditionally.
 *   - Does NOT change billing — it just visualizes the response.
 */

import React from 'react';

export type CampaignVariantPostExecutionPayload = {
  /** Multi-asset shape (set when fan-out ran). */
  generated_assets?: Array<{
    rank: number;
    variant_id: string;
    variant_family: string;
    strategy_id: string;
    experiment_id: string | null;
    persisted_asset_id: string | null;
    ok: boolean;
    error?: string;
  }>;
  /** Multi-asset cost breakdown. */
  per_asset_cost_usd?: Array<{ variant_id: string | null; cost_usd: number }>;
  /** Per-asset secondary-platform adaptation status. */
  per_asset_adaptations?: Record<string, Record<string, {
    ok: boolean;
    error?: string;
  }>>;
  variant_mode?: 'single_variant' | 'best_variant' | 'top_3_variants' | 'experiment' | null;
  variant_strategy_id?: string | null;
  experiment_id?: string | null;
  /** Legacy single-asset fields. Always present. */
  estimated_cost_usd?: number;
  creator_asset_id?: string | null;
  target_platforms?: string[];
  /** Cost Estimate Accuracy — Phase 5. (estimated, actual, variance)
   *  pulled from the cost observation store. Absent when no
   *  observation was recorded. */
  cost_observation?: {
    occurredAt: string;
    content_type: string;
    variant_mode: string;
    asset_count: number;
    estimated_usd: number;
    actual_usd: number;
    variance_pct: number | null;
  } | null;
};

type Props = {
  payload: CampaignVariantPostExecutionPayload;
  className?: string;
};

export const CampaignVariantPostExecutionReport: React.FC<Props> = ({ payload, className }) => {
  const isFanOut = Array.isArray(payload.generated_assets) && payload.generated_assets.length > 0;
  const generated = payload.generated_assets ?? [];
  const okAssets = isFanOut ? generated.filter((a) => a.ok) : (payload.creator_asset_id ? [{
    rank: 1,
    variant_id: 'primary',
    variant_family: 'v1',
    strategy_id: payload.variant_strategy_id ?? '—',
    experiment_id: payload.experiment_id ?? null,
    persisted_asset_id: payload.creator_asset_id ?? null,
    ok: true,
  }] : []);
  const failedAssets = isFanOut ? generated.filter((a) => !a.ok) : [];
  const variantFamilies = Array.from(new Set(okAssets.map((a) => a.variant_family).filter(Boolean)));
  const totalCostUsd = (() => {
    if (Array.isArray(payload.per_asset_cost_usd) && payload.per_asset_cost_usd.length > 0) {
      return payload.per_asset_cost_usd.reduce((sum, e) => sum + (typeof e.cost_usd === 'number' ? e.cost_usd : 0), 0);
    }
    return typeof payload.estimated_cost_usd === 'number' ? payload.estimated_cost_usd : 0;
  })();
  const modeLabel = (() => {
    switch (payload.variant_mode) {
      case 'single_variant': return 'Single Variant';
      case 'best_variant': return 'Best Variant';
      case 'top_3_variants': return 'Top 3 Variants';
      case 'experiment': return 'Experiment';
      default: return null;
    }
  })();
  const container = className ?? 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm';

  return (
    <div className={container}>
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Execution report</h3>
        <p className="mt-1 text-xs text-gray-500">
          Summary of the assets generated and credits consumed for this run.
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-gray-500">Assets generated</dt>
        <dd className="font-semibold text-gray-900">
          {okAssets.length}
          {failedAssets.length > 0 ? (
            <span className="ml-2 text-xs font-medium text-rose-700">
              ({failedAssets.length} failed)
            </span>
          ) : null}
        </dd>
        <dt className="text-gray-500">Credits consumed</dt>
        <dd className="font-semibold text-gray-900">{totalCostUsd.toFixed(4)}</dd>
        {variantFamilies.length > 0 ? (
          <>
            <dt className="text-gray-500">Variants generated</dt>
            <dd className="font-medium text-gray-900">
              {variantFamilies.map((v) => v.toUpperCase()).join(', ')}
            </dd>
          </>
        ) : null}
        {payload.experiment_id ? (
          <>
            <dt className="text-gray-500">Experiment id</dt>
            <dd className="font-mono text-xs text-gray-700">{payload.experiment_id}</dd>
          </>
        ) : null}
        {modeLabel ? (
          <>
            <dt className="text-gray-500">Mode</dt>
            <dd className="font-medium text-gray-900">{modeLabel}</dd>
          </>
        ) : null}
        {payload.cost_observation ? (
          <>
            <dt className="text-gray-500">Estimated vs actual</dt>
            <dd className="font-mono text-xs text-gray-700">
              ${payload.cost_observation.estimated_usd.toFixed(4)} est ·
              ${payload.cost_observation.actual_usd.toFixed(4)} actual
              {payload.cost_observation.variance_pct !== null ? (
                <span className={`ml-2 font-semibold ${
                  Math.abs(payload.cost_observation.variance_pct) > 0.25
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}>
                  ({(payload.cost_observation.variance_pct * 100).toFixed(1)}% variance)
                </span>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
      {isFanOut ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
            Per-asset detail
          </p>
          <ul className="mt-1 space-y-1 text-xs text-gray-700">
            {generated.map((a) => (
              <li key={`${a.variant_id}:${a.rank}`} className="flex items-baseline gap-2">
                <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  a.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                }`}>
                  {a.ok ? 'OK' : 'FAIL'}
                </span>
                <span className="font-mono">{a.variant_family.toUpperCase()}</span>
                <span className="text-gray-500">·</span>
                <span className="font-mono text-[10px] text-gray-600">{a.variant_id}</span>
                {a.persisted_asset_id ? (
                  <>
                    <span className="text-gray-500">·</span>
                    <span className="font-mono text-[10px] text-gray-500">{a.persisted_asset_id}</span>
                  </>
                ) : null}
                {a.error ? (
                  <span className="text-rose-700">— {a.error}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {payload.per_asset_adaptations && Object.keys(payload.per_asset_adaptations).length > 0 ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
            Secondary-platform adaptation
          </p>
          <ul className="mt-1 space-y-1 text-xs text-gray-700">
            {Object.entries(payload.per_asset_adaptations).map(([variantId, byPlatform]) => {
              const failed = Object.entries(byPlatform).filter(([, status]) => !status.ok);
              const okCount = Object.values(byPlatform).filter((s) => s.ok).length;
              return (
                <li key={variantId}>
                  <span className="font-mono">{variantId}</span>
                  {' — '}
                  <span className="text-emerald-700">{okCount} ok</span>
                  {failed.length > 0 ? (
                    <span className="ml-2 text-rose-700">
                      {failed.length} failed: {failed.map(([p]) => p).join(', ')}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
