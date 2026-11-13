/**
 * Step bar for the company-profile wizard (UI step 6.1).
 * Compact on mobile ("Step 3 of 9 · What you offer" + a progress bar); a clickable step
 * list on larger screens. Back / Next live in WizardStepNav.
 */
import React from 'react';
import { WIZARD_STEPS, stepIndex, nextStepId, previousStepId, type WizardStepId } from './wizardSteps';

export function WizardStepper({ current, onSelect }: { current: WizardStepId; onSelect: (id: WizardStepId) => void }) {
  const idx = stepIndex(current);
  const step = WIZARD_STEPS[idx];
  const pct = Math.round(((idx + 1) / WIZARD_STEPS.length) * 100);
  return (
    <nav aria-label="Company profile steps" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          Step {idx + 1} of {WIZARD_STEPS.length} · {step.title}
        </p>
        <p className="hidden text-xs text-slate-500 sm:block">{step.hint}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-3 hidden flex-wrap gap-1.5 md:flex">
        {WIZARD_STEPS.map((s, i) => {
          const active = s.id === current;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? 'step' : undefined}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : i < idx
                      ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {i + 1}. {s.title}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-slate-500 sm:hidden">{step.hint}</p>
    </nav>
  );
}

export function WizardStepNav({ current, onSelect }: { current: WizardStepId; onSelect: (id: WizardStepId) => void }) {
  const prev = previousStepId(current);
  const next = nextStepId(current);
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => prev && onSelect(prev)}
        disabled={!prev}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:invisible"
      >
        Back
      </button>
      {next ? (
        <button
          type="button"
          onClick={() => onSelect(next)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          Next: {WIZARD_STEPS[stepIndex(next)].title}
        </button>
      ) : null}
    </div>
  );
}
