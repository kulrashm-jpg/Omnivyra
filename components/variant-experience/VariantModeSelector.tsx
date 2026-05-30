/**
 * VariantModeSelector
 *
 * Mode dropdown surfaced inside Creator / Writer / Campaign +
 * standalone Variant Experience page. Maps the 7 user-facing options
 * onto the 4 backend modes (single + family pin → `single_variant`).
 *
 * Pure presentational. The parent owns state and calls the planner.
 */

import React from 'react';
import type { VariantExecutionMode, VariantFamily } from './useVariantApi';

export type VariantModeOption =
  | 'best_variant'
  | 'v1'
  | 'v2'
  | 'v3'
  | 'top_3_variants'
  | 'experiment';

// P2-4 — 'default' + 'v1' produced identical backend payloads. The
// option is collapsed into a single 'v1' entry labeled "V1 (Default)"
// so operators see one canonical baseline pick. Backward-compat:
// `normalizeVariantModeOption()` translates legacy `'default'` values
// from persisted campaign configs to `'v1'`.
export const VARIANT_MODE_OPTIONS: ReadonlyArray<{
  value: VariantModeOption;
  label: string;
  description: string;
}> = [
  { value: 'v1',             label: 'V1 (Default)',     description: 'Use the V1 baseline — no experimentation.' },
  { value: 'best_variant',   label: 'Best Variant',     description: 'Use the current analytics winner. Falls back to V1 if no winner is declared.' },
  { value: 'v2',             label: 'Variant V2',       description: 'Force the V2 amplified variant.' },
  { value: 'v3',             label: 'Variant V3',       description: 'Force the V3 alternate composition.' },
  { value: 'top_3_variants', label: 'Top 3 Variants',   description: 'Generate V1, V2, V3 side-by-side for comparison.' },
  { value: 'experiment',     label: 'Experiment Mode',  description: 'Fan out V1 / V2 / V3 and register as a tracked experiment.' },
];

/** Map a UI option to a backend execution payload. */
export function uiOptionToExecutionPayload(option: VariantModeOption): {
  mode: VariantExecutionMode;
  variantFamily: VariantFamily | null;
} {
  switch (option) {
    case 'best_variant':   return { mode: 'best_variant',   variantFamily: null };
    case 'v1':             return { mode: 'single_variant', variantFamily: 'v1' };
    case 'v2':             return { mode: 'single_variant', variantFamily: 'v2' };
    case 'v3':             return { mode: 'single_variant', variantFamily: 'v3' };
    case 'top_3_variants': return { mode: 'top_3_variants', variantFamily: null };
    case 'experiment':     return { mode: 'experiment',     variantFamily: null };
  }
}

/**
 * Backward-compat normalizer (P2-4). Persisted configs may still
 * carry the legacy `'default'` value; translate it to `'v1'` so
 * downstream code sees the canonical single option.
 */
export function normalizeVariantModeOption(value: string | null | undefined): VariantModeOption {
  if (value === 'default') return 'v1';
  if (value === 'best_variant' || value === 'v1' || value === 'v2' || value === 'v3'
      || value === 'top_3_variants' || value === 'experiment') {
    return value;
  }
  return 'v1';
}

type Props = {
  value: VariantModeOption;
  onChange: (next: VariantModeOption) => void;
  /** Hide the "experiment" option when the operator has disabled it. */
  experimentDisabled?: boolean;
  /** Hide every non-default option when exploration is disabled. */
  explorationDisabled?: boolean;
  disabled?: boolean;
  /** Optional className for the wrapping container. */
  className?: string;
};

export const VariantModeSelector: React.FC<Props> = ({
  value,
  onChange,
  experimentDisabled = false,
  explorationDisabled = false,
  disabled = false,
  className,
}) => {
  const available = VARIANT_MODE_OPTIONS.filter((opt) => {
    if (explorationDisabled) return opt.value === 'v1';
    if (experimentDisabled && opt.value === 'experiment') return false;
    return true;
  });
  const activeOption = available.find((o) => o.value === value) ?? available[0];
  return (
    <div className={className ?? 'space-y-2'}>
      <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Variant mode
      </label>
      <select
        value={value}
        disabled={disabled || available.length === 1}
        onChange={(e) => onChange(e.target.value as VariantModeOption)}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
      >
        {available.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-500 leading-5">{activeOption?.description}</p>
      {(experimentDisabled || explorationDisabled) ? (
        <p className="text-xs italic text-amber-700">
          {explorationDisabled
            ? 'Variant exploration is currently disabled by an operator control. Every request collapses to V1.'
            : 'Experiment mode is currently disabled by an operator control.'}
        </p>
      ) : null}
    </div>
  );
};
