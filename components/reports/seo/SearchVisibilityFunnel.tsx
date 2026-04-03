'use client';

import { Funnel, FunnelChart, LabelList, ResponsiveContainer, Tooltip } from 'recharts';

type Confidence = 'high' | 'medium' | 'low';

type Props = {
  data: {
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    estimated_lost_clicks: number | null;
    confidence: Confidence;
    drop_off_reason_distribution?: {
      ranking_issue_pct: number | null;
      ctr_issue_pct: number | null;
      intent_mismatch_pct: number | null;
    };
    tooltips: Record<string, string>;
    insightSentence: string;
  };
};

function confidenceClasses(confidence: Confidence): string {
  if (confidence === 'high') return 'bg-emerald-100 text-emerald-700';
  if (confidence === 'medium') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

export default function SearchVisibilityFunnel({ data }: Props) {
  const funnelData =
    typeof data.impressions === 'number' && typeof data.clicks === 'number'
      ? [
          { name: 'Impressions', value: data.impressions, fill: '#93c5fd' },
          { name: 'Clicks', value: data.clicks, fill: '#2563eb' },
        ]
      : [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search Visibility Funnel</p>
          <p className="mt-2 text-sm text-slate-600">Tracks how much search demand becomes actual visits.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${confidenceClasses(data.confidence)}`}>
          {data.confidence} confidence
        </span>
      </div>

      {funnelData.length > 0 ? (
        <div className="mt-5 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <FunnelChart>
              <Tooltip
                contentStyle={{ borderRadius: 12, borderColor: '#cbd5e1' }}
                formatter={(value: number, name: string) => [Math.round(value).toLocaleString(), name]}
              />
              <Funnel dataKey="value" data={funnelData} isAnimationActive={false}>
                <LabelList position="right" fill="#334155" stroke="none" dataKey="name" />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500" title={data.tooltips.impressions}>Impressions</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {typeof data.impressions === 'number' ? data.impressions.toLocaleString() : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500" title={data.tooltips.clicks}>Clicks</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {typeof data.clicks === 'number' ? data.clicks.toLocaleString() : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500" title={data.tooltips.ctr}>CTR</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {typeof data.ctr === 'number' ? `${(data.ctr * 100).toFixed(2)}%` : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500" title={data.tooltips.estimated_lost_clicks}>Estimated Lost Clicks</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {typeof data.estimated_lost_clicks === 'number' ? data.estimated_lost_clicks.toLocaleString() : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}
          </p>
        </div>
      </div>

      {data.drop_off_reason_distribution ? (
        <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Drop-off reasoning</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3 text-sm text-slate-700">
            <p>Ranking: {typeof data.drop_off_reason_distribution.ranking_issue_pct === 'number' ? `${data.drop_off_reason_distribution.ranking_issue_pct}%` : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}</p>
            <p>CTR: {typeof data.drop_off_reason_distribution.ctr_issue_pct === 'number' ? `${data.drop_off_reason_distribution.ctr_issue_pct}%` : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}</p>
            <p>Intent mismatch: {typeof data.drop_off_reason_distribution.intent_mismatch_pct === 'number' ? `${data.drop_off_reason_distribution.intent_mismatch_pct}%` : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}</p>
          </div>
          <span className="mt-3 inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
            Data Strength: {data.confidence === 'high' ? 'Strong' : data.confidence === 'medium' ? 'Inferred' : 'Weak'}
          </span>
        </div>
      ) : null}

      <div className="mt-4 rounded-lg bg-blue-50 px-3 py-3 text-sm text-blue-900">
        <p className="font-semibold">Why this matters</p>
        <p className="mt-1">{data.insightSentence}</p>
      </div>
    </div>
  );
}

