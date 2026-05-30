/**
 * VariantWinnerCard
 *
 * Per-strategy winner display. Shows current leader + runner-up +
 * confidence + sample size + delta when a winner is declared, or a
 * conservative "no winner yet" state with the engine's
 * insufficient-data reason.
 *
 * Pure presentational. Consumes a `VariantWinner` row from the
 * strategy-analytics endpoint (`execution.winner_recommendations[]`
 * or `variants.winners[]`).
 */

import React from 'react';
import type { VariantWinner } from './useVariantApi';

const CONFIDENCE_TONE: Record<VariantWinner['confidence'], string> = {
  high:   'bg-emerald-50 text-emerald-700 ring-emerald-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  low:    'bg-gray-100 text-gray-700 ring-gray-200',
};

function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function formatDelta(delta: number | null): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return '—';
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)}%`;
}

type Props = {
  winner: VariantWinner;
  className?: string;
};

export const VariantWinnerCard: React.FC<Props> = ({ winner, className }) => {
  const containerClass = className
    ?? 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm';
  if (winner.insufficientData) {
    return (
      <article className={containerClass}>
        <header className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              {winner.strategy_id}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-gray-900">
              No declared winner yet
            </h3>
          </div>
          <span className="shrink-0 rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 ring-1 ring-inset ring-gray-200">
            Pending
          </span>
        </header>
        <p className="mt-2 text-sm leading-5 text-gray-600">
          {winner.insufficientReason ?? 'Insufficient data to declare a winner.'}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-600">
          <div>
            <dt className="font-semibold uppercase tracking-wider text-gray-500">Metric</dt>
            <dd className="mt-0.5">{winner.metric}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wider text-gray-500">Samples</dt>
            <dd className="mt-0.5">{Math.round(winner.sampleSize)}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wider text-gray-500">Confidence</dt>
            <dd className="mt-0.5">{winner.confidence}</dd>
          </div>
        </dl>
      </article>
    );
  }

  const winnerRate = winner.winner?.metrics?.engagementRate ?? null;
  const runnerUpRate = winner.runner_up?.metrics?.engagementRate ?? null;

  return (
    <article className={containerClass}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {winner.strategy_id}
          </p>
          <h3 className="mt-1 text-sm font-semibold text-gray-900">
            Current leader: {winner.winner?.variant_family.toUpperCase()}
          </h3>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${CONFIDENCE_TONE[winner.confidence]}`}>
          {winner.confidence} confidence
        </span>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-emerald-50/50 px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            Winner — {winner.winner?.variant_id}
          </dt>
          <dd className="mt-1 text-lg font-semibold text-emerald-900">
            {formatRate(winnerRate)}
          </dd>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">
            Runner-up — {winner.runner_up?.variant_id ?? '—'}
          </dt>
          <dd className="mt-1 text-lg font-semibold text-gray-700">
            {formatRate(runnerUpRate)}
          </dd>
        </div>
      </dl>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-600">
        <div>
          <dt className="font-semibold uppercase tracking-wider text-gray-500">Metric</dt>
          <dd className="mt-0.5">{winner.metric}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wider text-gray-500">Delta</dt>
          <dd className="mt-0.5 font-semibold text-emerald-700">{formatDelta(winner.delta)}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wider text-gray-500">Samples</dt>
          <dd className="mt-0.5">{Math.round(winner.sampleSize)}</dd>
        </div>
      </dl>
    </article>
  );
};
