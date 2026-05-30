/**
 * CampaignVariantModeField
 *
 * Drop-in form field for campaign creation surfaces. Surfaces the
 * variant execution mode selector + reads/writes a campaign-level
 * `{ strategyId, variantMode }` pair from a single `value` /
 * `onChange` contract.
 *
 * The campaign config storage layer is unchanged — the embedder
 * persists the returned `{ strategy_id, variant_mode }` on whatever
 * campaign record it already uses. The campaign runner re-plays the
 * planner using these two fields when it generates assets (PHASE 6).
 *
 * Strict scope: this component is presentation + state contract
 * ONLY. It does NOT call the planner; the runner does at generation
 * time. Operators see what they're persisting before the campaign
 * fires.
 */

import React from 'react';
import { VariantModeSelector, type VariantModeOption } from './VariantModeSelector';
import { useOperatorControls } from './useVariantApi';

export type CampaignVariantPersistedConfig = {
  /** Resolved variant strategy id (e.g. `image:quote-image`). */
  strategy_id: string;
  /** UI option the operator picked. */
  variant_mode: VariantModeOption;
};

type Props = {
  companyId: string;
  /** When the campaign edits a single strategy, supply it here so the
   *  field doesn't ask the operator to enter a free-form id. */
  strategyId: string;
  /** Pre-selected mode (e.g. when editing an existing campaign). */
  value: VariantModeOption;
  onChange: (next: CampaignVariantPersistedConfig) => void;
  disabled?: boolean;
  className?: string;
};

export const CampaignVariantModeField: React.FC<Props> = ({
  companyId,
  strategyId,
  value,
  onChange,
  disabled,
  className,
}) => {
  const operatorControls = useOperatorControls(companyId);
  return (
    <section className={className ?? 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm'}>
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Campaign variant mode</h3>
        <p className="mt-1 text-xs text-gray-500">
          Persisted on the campaign record. When the campaign generates assets, the runner
          re-plays this mode against the latest analytics.
        </p>
      </header>
      <VariantModeSelector
        value={value}
        onChange={(next) => onChange({ strategy_id: strategyId, variant_mode: next })}
        experimentDisabled={operatorControls.controls?.experimentModeDisabled ?? false}
        explorationDisabled={operatorControls.controls?.variantExplorationDisabled ?? false}
        disabled={disabled}
      />
      <p className="mt-3 text-[11px] text-gray-500">
        Strategy: <code className="rounded bg-gray-100 px-1 py-0.5">{strategyId}</code>
      </p>
    </section>
  );
};

/**
 * Adapter helper — converts the persisted config back to the planner
 * call shape so the campaign runner can replay it without
 * re-deriving any mappings.
 */
export function campaignConfigToPlannerInput(config: CampaignVariantPersistedConfig): {
  strategyId: string;
  mode: 'single_variant' | 'best_variant' | 'top_3_variants' | 'experiment';
  variantFamily: 'v1' | 'v2' | 'v3' | null;
} {
  const mode = config.variant_mode;
  // P2-4 backward-compat — legacy 'default' translates to v1.
  if ((mode as any) === 'default') return { strategyId: config.strategy_id, mode: 'single_variant', variantFamily: 'v1' };
  if (mode === 'v1') return { strategyId: config.strategy_id, mode: 'single_variant', variantFamily: 'v1' };
  if (mode === 'v2') return { strategyId: config.strategy_id, mode: 'single_variant', variantFamily: 'v2' };
  if (mode === 'v3') return { strategyId: config.strategy_id, mode: 'single_variant', variantFamily: 'v3' };
  if (mode === 'best_variant') return { strategyId: config.strategy_id, mode: 'best_variant', variantFamily: null };
  if (mode === 'top_3_variants') return { strategyId: config.strategy_id, mode: 'top_3_variants', variantFamily: null };
  return { strategyId: config.strategy_id, mode: 'experiment', variantFamily: null };
}
