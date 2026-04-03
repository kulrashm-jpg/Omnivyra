'use client';

import { MarketPulseConfidenceBadge, MarketPulseSignalBox, MarketPulseTrendPill } from '../shared/MarketPulseVisualPrimitives';

type Props = {
  data: {
    previous_report_id: string;
    current_report_id: string;
    competitors: Array<{
      domain: string;
      previous_scores: {
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      };
      current_scores: {
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      };
      delta: {
        content_delta: number | null;
        keyword_delta: number | null;
        authority_delta: number | null;
        technical_delta: number | null;
        ai_answer_delta: number | null;
      };
      movement: 'improving' | 'declining' | 'stable';
    }>;
    user_vs_competitor_shift: {
      closest_competitor: string;
      gap_change: number | null;
      direction: 'closing_gap' | 'widening_gap' | 'unchanged';
    };
    data_status: 'complete' | 'partial' | 'insufficient';
    summary: {
      overall_trend: 'improving' | 'declining' | 'stable';
      key_movement: string;
    };
  } | null;
};

function deltaClass(value: number | null): string {
  if (value == null) return 'text-slate-700 bg-slate-50 border-slate-200';
  if (value > 0) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (value < 0) return 'text-red-700 bg-red-50 border-red-200';
  return 'text-slate-700 bg-slate-50 border-slate-200';
}

function movementClass(value: 'improving' | 'declining' | 'stable'): string {
  if (value === 'improving') return 'bg-emerald-100 text-emerald-700';
  if (value === 'declining') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-700';
}

function formatDelta(value: number | null): string {
  if (value == null) return 'Signal coverage is currently insufficient';
  return `${value >= 0 ? '+' : ''}${Number(value.toFixed(1))}`;
}

function directionLine(data: NonNullable<Props['data']>): string {
  if (data.data_status === 'insufficient') {
    return 'Insufficient matched competitor history to classify direction.';
  }
  if (data.user_vs_competitor_shift.direction === 'closing_gap') {
    return `You are catching up to ${data.user_vs_competitor_shift.closest_competitor}.`;
  }
  if (data.user_vs_competitor_shift.direction === 'widening_gap') {
    return `Competitor ${data.user_vs_competitor_shift.closest_competitor} is pulling ahead.`;
  }
  return `Your gap versus ${data.user_vs_competitor_shift.closest_competitor} is unchanged.`;
}

export default function CompetitorMovement({ data }: Props) {
  if (!data) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Competitor Movement</p>
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No previous competitor movement data to compare
        </div>
      </section>
    );
  }

  const topCompetitors = data.competitors.slice(0, 2);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Competitor Movement</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">Relative Movement vs Market</h3>
          <p className="mt-2 text-sm font-semibold text-slate-800">{directionLine(data)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <MarketPulseTrendPill trend={data.summary.overall_trend} />
            <MarketPulseConfidenceBadge value={data.data_status === 'complete' ? 'high' : data.data_status === 'partial' ? 'medium' : 'low'} />
          </div>
        </div>
        <div className={`rounded-xl border px-4 py-3 ${deltaClass(data.user_vs_competitor_shift.gap_change == null ? null : data.user_vs_competitor_shift.gap_change * -1)}`}>
          <p className="text-xs font-semibold uppercase tracking-wide">Gap Shift</p>
          <p className="mt-1 text-xl font-bold">
            {data.user_vs_competitor_shift.gap_change == null
              ? 'Signal coverage is currently insufficient'
              : `${data.user_vs_competitor_shift.gap_change > 0 ? '+' : ''}${Number(data.user_vs_competitor_shift.gap_change.toFixed(2))}`}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {topCompetitors.length > 0 ? topCompetitors.map((competitor) => (
          <div key={competitor.domain} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">{competitor.domain}</p>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${movementClass(competitor.movement)}`}>
                {competitor.movement}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Keyword {formatDelta(competitor.delta.keyword_delta)} | Authority {formatDelta(competitor.delta.authority_delta)} | AI {formatDelta(competitor.delta.ai_answer_delta)}
            </p>
          </div>
        )) : (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No matchable competitors between reports.
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
        <MarketPulseSignalBox title="Competitor Signal" text={data.summary.key_movement} tone="slate" />
      </div>
    </section>
  );
}
