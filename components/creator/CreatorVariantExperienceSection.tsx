'use client';

/**
 * Variant Experience section for the creator type-workflow page — extracted from
 * pages/command-center/creator-content/[type].tsx (decomposition: page < 1000 LOC).
 *
 * Surfaces the variant entry card, pinned-variant notice, fan-out grid and winner
 * card for the three variant-supporting creator types (image / carousel / infographic).
 *
 * FIX (review): the original called useSharedStrategyAnalytics AFTER conditional early
 * returns — a Rules-of-Hooks violation (hook order changed when `type`/`strategyId`
 * flipped across renders). Hooks now run unconditionally; the gating happens in the
 * hook's `enabled` flag and the render below it.
 */

import React from 'react';
import { VariantExperienceEntryCard } from '../variant-experience/VariantExperienceEntryCard';
import { VariantWinnerCard } from '../variant-experience/VariantWinnerCard';
import { VariantPreviewGrid } from '../variant-experience/VariantPreviewGrid';
import { useSharedStrategyAnalytics } from '../variant-experience/VariantContexts';
import type { VariantExecutionResult, VariantFamily } from '../variant-experience/useVariantApi';
import { resolveCreatorStrategyId, type CreatorTypeForVariant } from '../../lib/variants/creatorStrategyMapping';
import type { CreatorTypeId } from '../../lib/creator-content/creatorTypeWorkflow';

export default function CreatorVariantExperienceSection(props: {
  type: CreatorTypeId | null;
  subtype: string | undefined;
  companyId: string;
  variantPin: VariantFamily | null;
  setVariantPin: React.Dispatch<React.SetStateAction<VariantFamily | null>>;
  variantPlan: VariantExecutionResult | null;
  setVariantPlan: React.Dispatch<React.SetStateAction<VariantExecutionResult | null>>;
  variantFanOutInFlight: boolean;
  variantFanOutSummary: string | null;
  onFanOut: (plan: VariantExecutionResult) => Promise<void>;
  /** P1-4 callback — fires when the planner returns a single-decision
   *  plan (single_variant / best_variant). Parent uses it to auto-fire
   *  Generate so operators don't have to click twice. */
  onSingleDecisionReady: (family: VariantFamily) => void;
}) {
  const {
    type, subtype, companyId,
    variantPin, setVariantPin,
    variantPlan, setVariantPlan,
    variantFanOutInFlight, variantFanOutSummary,
    onFanOut, onSingleDecisionReady,
  } = props;
  // Only the three variant-supporting creator types render this section. Resolved BEFORE
  // any hook so gating is data, not control flow (Rules of Hooks — no conditional hooks).
  const isVariantType = type === 'image' || type === 'carousel' || type === 'infographic';
  const strategyId = isVariantType ? resolveCreatorStrategyId(type as CreatorTypeForVariant, subtype ?? null) : null;
  // P2-1 — read from shared analytics provider when one is mounted upstream; falls back
  // to a direct fetch when not. Saves redundant GETs when multiple variant surfaces
  // (e.g. this section + WriterVariantSection in a side panel) coexist on the same page.
  const analytics = useSharedStrategyAnalytics({ companyId, enabled: Boolean(strategyId && companyId) });
  if (!isVariantType || !strategyId || !companyId) return null;
  const winnerForStrategy = analytics.data?.execution.winner_recommendations.find(
    (w) => w.strategy_id === strategyId,
  ) ?? analytics.data?.variants.winners.find((w) => w.strategy_id === strategyId) ?? null;
  return (
    <div className="mt-6 space-y-3">
      <VariantExperienceEntryCard
        companyId={companyId}
        strategyId={strategyId}
        contentType={type as CreatorTypeForVariant}
        onPlanComplete={(plan) => {
          setVariantPlan(plan);
          // For single-variant + best-variant the planner returns one
          // decision — pin its family AND auto-fire Generate (P1-4)
          // so the operator's "Pick Best Variant" intent ships in
          // one click rather than two.
          if (plan.decisions.length === 1) {
            const fam = plan.decisions[0].variant.variant_family;
            if (fam === 'v1' || fam === 'v2' || fam === 'v3') {
              onSingleDecisionReady(fam);
            }
          }
        }}
      />
      {variantPin ? (
        <p className="text-xs text-indigo-700">
          Current Generate pinned to Variant {variantPin.toUpperCase()}. Switch the variant card mode to update.
        </p>
      ) : null}
      {variantPlan && variantPlan.decisions.length > 1 ? (
        <div className="rounded-xl border border-indigo-200 bg-white p-3 shadow-sm">
          <header className="mb-2 flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-900">Variant fan-out</h4>
            <span className="text-xs text-gray-500">
              Resolved mode: <strong>{variantPlan.resolvedMode}</strong>
              {variantPlan.experimentId ? <> · Experiment <strong>{variantPlan.experimentId}</strong></> : null}
            </span>
          </header>
          <VariantPreviewGrid decisions={variantPlan.decisions} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void onFanOut(variantPlan)}
              disabled={variantFanOutInFlight}
              className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {variantFanOutInFlight ? 'Fanning out…' : `Generate ${variantPlan.decisions.length} variants`}
            </button>
            {variantFanOutSummary ? (
              <span className="text-xs text-gray-600">{variantFanOutSummary}</span>
            ) : (
              <span className="text-xs italic text-gray-500">
                Tip — run a baseline Generate first so the fan-out can replay the same brief per variant.
              </span>
            )}
          </div>
        </div>
      ) : null}
      {winnerForStrategy ? (
        <VariantWinnerCard winner={winnerForStrategy} />
      ) : null}
    </div>
  );
}
