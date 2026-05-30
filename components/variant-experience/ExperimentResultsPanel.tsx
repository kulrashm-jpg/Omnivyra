/**
 * ExperimentResultsPanel
 *
 * Active + completed experiments dashboard. Reads from the
 * `execution.active_experiments` / `execution.completed_experiments`
 * blocks of the strategy-analytics endpoint.
 *
 * Pure presentational. Calls back to `onComplete` when the operator
 * marks an active experiment finished.
 */

import React from 'react';
import type { ExperimentRecord } from './useVariantApi';

const STATE_TONE: Record<ExperimentRecord['state'], string> = {
  created:   'bg-gray-50 text-gray-700 ring-gray-200',
  generated: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  published: 'bg-sky-50 text-sky-700 ring-sky-200',
  engaged:   'bg-emerald-50 text-emerald-700 ring-emerald-200',
  completed: 'bg-violet-50 text-violet-700 ring-violet-200',
};

type Props = {
  active: ExperimentRecord[];
  completed: ExperimentRecord[];
  onComplete?: (experimentId: string) => void;
  className?: string;
};

export const ExperimentResultsPanel: React.FC<Props> = ({ active, completed, onComplete, className }) => {
  return (
    <section className={className ?? 'space-y-4'}>
      <ExperimentSection
        title="Active experiments"
        emptyText="No active experiments. Launch one from Experiment Mode above."
        items={active}
        onComplete={onComplete}
        showCompleteButton
      />
      <ExperimentSection
        title="Completed experiments"
        emptyText="No completed experiments yet."
        items={completed}
      />
    </section>
  );
};

const ExperimentSection: React.FC<{
  title: string;
  emptyText: string;
  items: ExperimentRecord[];
  onComplete?: (experimentId: string) => void;
  showCompleteButton?: boolean;
}> = ({ title, emptyText, items, onComplete, showCompleteButton }) => {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-500">{items.length} experiments</span>
      </header>
      {items.length === 0 ? (
        <p className="text-sm italic text-gray-500">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((experiment) => (
            <li key={experiment.experiment_id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    {experiment.experiment_id} · {experiment.strategy_id}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-gray-900">
                    {experiment.mode === 'experiment' ? 'Experiment mode' : 'Top 3 mode'} — {experiment.assets.length} variants
                  </p>
                  {experiment.correlation_id ? (
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      Correlation · {experiment.correlation_id}
                    </p>
                  ) : null}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${STATE_TONE[experiment.state]}`}>
                  {experiment.state}
                </span>
              </div>
              <ul className="mt-2 grid gap-1 sm:grid-cols-3">
                {experiment.assets.map((asset) => (
                  <li
                    key={asset.variant_id}
                    className="rounded-md bg-gray-50 px-2 py-1 text-[11px] leading-5"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-gray-700">
                        {asset.variant_family.toUpperCase()}
                      </span>
                      <span className={`rounded px-1 text-[10px] font-semibold uppercase tracking-wider ${STATE_TONE[asset.state]}`}>
                        {asset.state}
                      </span>
                    </div>
                    {asset.asset_id ? (
                      <div className="text-gray-600 truncate">asset · {asset.asset_id}</div>
                    ) : null}
                    {asset.scheduled_post_id ? (
                      <div className="text-gray-600 truncate">sched · {asset.scheduled_post_id}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                <span>created {new Date(experiment.createdAt).toLocaleString()}</span>
                <span>updated {new Date(experiment.updatedAt).toLocaleString()}</span>
              </div>
              {showCompleteButton && onComplete && experiment.state !== 'completed' ? (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onComplete(experiment.experiment_id)}
                    className="rounded-md bg-violet-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-500"
                  >
                    Mark complete
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
