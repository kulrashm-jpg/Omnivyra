/**
 * VariantPreviewGrid
 *
 * Renders the planner's `VariantSelectionDecision[]` as a
 * side-by-side preview grid. Handles 1 / 2 / 3-up layouts and
 * surfaces variant explainability (display name, description,
 * reasoning, source badge).
 *
 * Pure presentational. Consumes hook output.
 */

import React from 'react';
import type { VariantSelectionDecision } from './useVariantApi';

const SOURCE_LABELS: Record<VariantSelectionDecision['source'], { label: string; tone: string }> = {
  caller_pinned:      { label: 'Pinned',         tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  winner_engine:      { label: 'Recommended',    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  baseline_fallback:  { label: 'Baseline',       tone: 'bg-gray-50 text-gray-700 ring-gray-200' },
  experiment_fan_out: { label: 'Exploration',    tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  operator_forced:    { label: 'Required',       tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

type Props = {
  decisions: VariantSelectionDecision[];
  className?: string;
};

export const VariantPreviewGrid: React.FC<Props> = ({ decisions, className }) => {
  if (!decisions || decisions.length === 0) {
    return (
      <div className={className ?? 'rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500'}>
        No variants planned yet. Choose a variant mode and generate the plan.
      </div>
    );
  }
  const cols = decisions.length === 1 ? 'grid-cols-1' : decisions.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <div className={className ?? `grid gap-4 ${cols}`}>
      {decisions.map((decision) => {
        const sourceTag = SOURCE_LABELS[decision.source];
        return (
          <article
            key={decision.variant.variant_id}
            className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <header className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Rank {decision.rank} · {decision.variant.variant_family.toUpperCase()}
                </p>
                <h3 className="mt-1 text-base font-semibold text-gray-900">
                  {decision.variant.display_name}
                </h3>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${sourceTag.tone}`}>
                {sourceTag.label}
              </span>
            </header>
            <p className="mt-2 text-sm leading-5 text-gray-600">
              {decision.variant.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {decision.variant.exploration_dimensions.map((dim) => (
                <span
                  key={dim}
                  className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700"
                >
                  {dim.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
            <footer className="mt-auto border-t border-dashed border-gray-200 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Why this variant?
              </p>
              <p className="mt-1 text-sm leading-5 text-gray-700">
                {decision.reasoning}
              </p>
            </footer>
          </article>
        );
      })}
    </div>
  );
};
