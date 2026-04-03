'use client';

import { MarketPulseConfidenceBadge, MarketPulseSignalBox, MarketPulseTrendPill } from '../shared/MarketPulseVisualPrimitives';

type Props = {
  data: {
    previous_report_id: string;
    current_report_id: string;
    unified_score_change: number | null;
    seo_changes: {
      health_score_delta: number | null;
      impressions_delta: number | null;
      clicks_delta: number | null;
      ctr_delta: number | null;
    };
    geo_aeo_changes: {
      ai_visibility_delta: number | null;
      answer_coverage_delta: number | null;
      citation_readiness_delta: number | null;
    };
    competitor_changes: {
      position_change: number | null;
      gap_reduction_score: number | null;
    };
    data_status: 'complete' | 'partial' | 'insufficient';
    summary: {
      overall_trend: 'improving' | 'declining' | 'stable';
      biggest_gain: string;
      biggest_drop: string;
    };
  } | null;
};

function arrow(value: number | null): string {
  if (value == null) return '-';
  if (value > 0) return 'UP';
  if (value < 0) return 'DOWN';
  return 'FLAT';
}

function tone(value: number | null): string {
  if (value == null) return 'text-slate-600 bg-slate-50 border-slate-200';
  if (value > 0) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (value < 0) return 'text-red-700 bg-red-50 border-red-200';
  return 'text-slate-700 bg-slate-50 border-slate-200';
}

function fmt(value: number | null, digits = 2): string {
  if (value == null) return 'Signal coverage is currently insufficient';
  const rounded = Number(value.toFixed(digits));
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}

export default function ProgressComparison({ data }: Props) {
  if (!data) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Before vs After</p>
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No previous data to compare
        </div>
      </section>
    );
  }

  const metrics = [
    { label: 'SEO Health', value: data.seo_changes.health_score_delta, digits: 1 },
    { label: 'Impressions', value: data.seo_changes.impressions_delta, digits: 0 },
    { label: 'Clicks', value: data.seo_changes.clicks_delta, digits: 0 },
    { label: 'CTR', value: data.seo_changes.ctr_delta, digits: 4 },
    { label: 'AI Visibility', value: data.geo_aeo_changes.ai_visibility_delta, digits: 1 },
  ];

  const trendLine =
    data.data_status === 'insufficient'
      ? 'Insufficient previous signals to compute reliable trend direction yet.'
      : data.summary.overall_trend === 'improving'
        ? `Your visibility improved due to ${data.summary.biggest_gain}.`
        : data.summary.overall_trend === 'declining'
          ? `Performance is declining, mainly from ${data.summary.biggest_drop}.`
          : `Performance is stable; biggest gain is ${data.summary.biggest_gain}.`;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Before vs After</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">Progress Comparison</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <MarketPulseTrendPill trend={data.summary.overall_trend} />
            <MarketPulseConfidenceBadge value={data.data_status === 'complete' ? 'high' : data.data_status === 'partial' ? 'medium' : 'low'} />
          </div>
        </div>
        <div className={`rounded-xl border px-4 py-3 ${tone(data.unified_score_change)}`}>
          <p className="text-xs font-semibold uppercase tracking-wide">Unified Score Change</p>
          <p className="mt-1 text-2xl font-bold">
            {arrow(data.unified_score_change)} {fmt(data.unified_score_change, 1)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((metric) => (
          <div key={metric.label} className={`rounded-lg border px-3 py-3 ${tone(metric.value)}`}>
            <p className="text-xs font-semibold uppercase tracking-wide">{metric.label}</p>
            <p className="mt-1 text-sm font-bold">
              {arrow(metric.value)} {fmt(metric.value, metric.digits)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <MarketPulseSignalBox title="Key Signal" text={trendLine} tone="slate" />
        <p className="text-xs text-slate-500">
          Biggest gain: {data.summary.biggest_gain} | Biggest drop: {data.summary.biggest_drop}
        </p>
      </div>
    </section>
  );
}
