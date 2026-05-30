/**
 * VariantExperienceEntryCard
 *
 * Drop-in CTA card that the Creator + Writer surfaces embed to
 * expose variant planning. Renders a compact variant-mode picker
 * + a "Plan variants" button. The planner result is handed to the
 * embedder via the required `onPlanComplete` callback.
 *
 * Intentionally MINIMAL footprint — no behavior leaks into the
 * embedding surface beyond the explicit callback. The CTA is
 * additive: hiding it leaves legacy generation flows byte-identical.
 *
 * P2-3 cleanup: `onPlanComplete` was previously optional with two
 * fallback off-ramp CTAs ("Open dashboard →" / "Continue in
 * dashboard →"). All production callers supply the handler, so the
 * off-ramp branches were never reachable. Both branches removed
 * and the prop is now required. Navigation to the standalone
 * Variant Experience page is available through the main nav
 * (P2-2 — Campaigns → Variant Experience).
 */

import React, { useState } from 'react';
import {
  VariantModeSelector,
  uiOptionToExecutionPayload,
  type VariantModeOption,
} from './VariantModeSelector';
import { useOperatorControls, useVariantPlanner, type VariantExecutionResult } from './useVariantApi';

type Props = {
  companyId: string;
  strategyId: string;
  /** Optional context passed through to the planner. */
  campaignId?: string | null;
  platform?: string | null;
  contentType?: 'image' | 'carousel' | 'infographic';
  /** Required — invoked with the planner's result so the embedder
   *  can route single-decision plans to single-variant generation
   *  or fan-out multi-decision plans across V1/V2/V3. */
  onPlanComplete: (result: VariantExecutionResult) => void;
  className?: string;
};

export const VariantExperienceEntryCard: React.FC<Props> = ({
  companyId,
  strategyId,
  campaignId,
  platform,
  contentType,
  onPlanComplete,
  className,
}) => {
  const [mode, setMode] = useState<VariantModeOption>('v1');
  const planner = useVariantPlanner();
  const operatorControls = useOperatorControls(companyId);

  const handlePlan = async () => {
    if (!companyId || !strategyId) return;
    const payload = uiOptionToExecutionPayload(mode);
    const result = await planner.plan({
      companyId,
      strategyId,
      mode: payload.mode,
      variantFamily: payload.variantFamily,
      campaignId: campaignId ?? null,
      platform: platform ?? null,
      contentType,
    });
    if (result) onPlanComplete(result);
  };

  const containerClass = className
    ?? 'rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm';

  return (
    <section className={containerClass}>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
          Variant Experience
        </p>
        <h3 className="mt-1 text-sm font-semibold text-gray-900">
          Run V1 / V2 / V3 against this strategy
        </h3>
      </header>
      <div className="mt-3 space-y-3">
        <VariantModeSelector
          value={mode}
          onChange={setMode}
          experimentDisabled={operatorControls.controls?.experimentModeDisabled ?? false}
          explorationDisabled={operatorControls.controls?.variantExplorationDisabled ?? false}
        />
        <button
          type="button"
          onClick={handlePlan}
          disabled={planner.loading || !strategyId}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {planner.loading ? 'Planning…' : 'Plan variants'}
        </button>
        {planner.error ? (
          <p className="text-xs text-rose-700">{planner.error}</p>
        ) : null}
        {planner.result ? (
          <div className="rounded-lg border border-indigo-200 bg-white p-3 text-xs text-gray-700">
            <p>
              Resolved mode <span className="font-semibold">{planner.result.resolvedMode}</span> · {planner.result.decisions.length} variant(s) planned.
            </p>
            <p className="mt-1 italic text-gray-500">{planner.result.modeRationale}</p>
            <ul className="mt-2 space-y-1">
              {planner.result.decisions.map((d) => (
                <li key={d.variant.variant_id} className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-800">
                    {d.variant.variant_family.toUpperCase()} · {d.variant.display_name}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                    {d.source.replace(/_/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
};
