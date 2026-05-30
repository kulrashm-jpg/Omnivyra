/**
 * OperatorControlsPanel
 *
 * Four-switch panel for the variant operator controls. Connected to
 * the live `useOperatorControls` hook — flipping a switch POSTs the
 * partial patch and refreshes the display.
 *
 * The conflict rules are encoded VISUALLY (forceBaselineV1 dims the
 * forceWinningVariant switch) so operators see the precedence at a
 * glance without having to read the rule docs.
 */

import React from 'react';
import type { OperatorControls } from './useVariantApi';

type Props = {
  controls: OperatorControls;
  onChange: (patch: Partial<OperatorControls>) => void;
  disabled?: boolean;
  className?: string;
};

const SWITCHES: ReadonlyArray<{
  key: keyof OperatorControls;
  label: string;
  description: string;
}> = [
  {
    key: 'experimentModeDisabled',
    label: 'Disable Experiment Mode',
    description: 'Experiment requests downgrade to Top 3 — no new experiments are registered.',
  },
  {
    key: 'variantExplorationDisabled',
    label: 'Disable Variant Exploration',
    description: 'Every request collapses to the V1 baseline. Use during freeze windows.',
  },
  {
    key: 'forceBaselineV1',
    label: 'Force Baseline V1',
    description: 'Same effect as disabling exploration — overrides every other selection.',
  },
  {
    key: 'forceWinningVariant',
    label: 'Force Winning Variant',
    description: 'Promote every request to Best Variant. Ignored when Force Baseline V1 is on.',
  },
];

export const OperatorControlsPanel: React.FC<Props> = ({ controls, onChange, disabled, className }) => {
  // Visual precedence: when forceBaselineV1 OR variantExplorationDisabled is on,
  // forceWinningVariant is effectively a no-op.
  const baselineWins = controls.forceBaselineV1 || controls.variantExplorationDisabled;
  return (
    <section className={className ?? 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm'}>
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Operator controls</h3>
        <p className="mt-1 text-xs text-gray-500">
          Per-company switches. Settings persist in-process until restart.
        </p>
      </header>
      <ul className="space-y-3">
        {SWITCHES.map((sw) => {
          const isOn = controls[sw.key];
          const isOverridden = sw.key === 'forceWinningVariant' && baselineWins;
          return (
            <li
              key={sw.key}
              className={`flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 ${isOverridden ? 'opacity-60' : ''}`}
            >
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">{sw.label}</p>
                <p className="mt-1 text-xs text-gray-600">{sw.description}</p>
                {isOverridden ? (
                  <p className="mt-1 text-[11px] italic text-amber-700">
                    Currently overridden by Force Baseline V1 / Disable Variant Exploration.
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange({ [sw.key]: !isOn } as Partial<OperatorControls>)}
                aria-pressed={isOn}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                  isOn ? 'bg-indigo-600' : 'bg-gray-300'
                } ${disabled ? 'opacity-50' : ''}`}
              >
                <span
                  className={`pointer-events-none mt-0.5 inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    isOn ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
