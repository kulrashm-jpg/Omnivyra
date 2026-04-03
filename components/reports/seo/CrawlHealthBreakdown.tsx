'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Confidence = 'high' | 'medium' | 'low';

type Props = {
  data: {
    metadata_issues: number | null;
    structure_issues: number | null;
    internal_link_issues: number | null;
    crawl_depth_issues: number | null;
    confidence: Confidence;
    severity_split?: {
      critical: number | null;
      moderate: number | null;
      low: number | null;
      classification: 'classified' | 'unclassified';
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

export default function CrawlHealthBreakdown({ data }: Props) {
  const chartData = [
    { label: 'Metadata', value: data.metadata_issues, tooltip: data.tooltips.metadata_issues },
    { label: 'Structure', value: data.structure_issues, tooltip: data.tooltips.structure_issues },
    { label: 'Internal Links', value: data.internal_link_issues, tooltip: data.tooltips.internal_link_issues },
    { label: 'Crawl Depth', value: data.crawl_depth_issues, tooltip: data.tooltips.crawl_depth_issues },
  ].filter((item) => typeof item.value === 'number') as Array<{ label: string; value: number; tooltip: string }>;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Crawl Health Breakdown</p>
          <p className="mt-2 text-sm text-slate-600">Shows where crawl-derived SEO issues are concentrated.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${confidenceClasses(data.confidence)}`}>
          {data.confidence} confidence
        </span>
      </div>

      {chartData.length > 0 ? (
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fill: '#475569', fontSize: 12 }} />
              <YAxis dataKey="label" type="category" tick={{ fill: '#475569', fontSize: 12 }} width={88} />
              <Tooltip
                contentStyle={{ borderRadius: 12, borderColor: '#cbd5e1' }}
                formatter={(value: number) => [Math.round(value), 'Issues']}
              />
              <Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {[
          ['Metadata', data.metadata_issues, data.tooltips.metadata_issues],
          ['Structure', data.structure_issues, data.tooltips.structure_issues],
          ['Internal Links', data.internal_link_issues, data.tooltips.internal_link_issues],
          ['Crawl Depth', data.crawl_depth_issues, data.tooltips.crawl_depth_issues],
        ].map(([label, value, tooltip]) => (
          <div key={String(label)} className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-700" title={String(tooltip)}>{label}</span>
              <span className="text-sm font-semibold text-slate-900">
                {typeof value === 'number' ? value : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {data.severity_split ? (
        <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
              Data Strength: {data.confidence === 'high' ? 'Strong' : data.confidence === 'medium' ? 'Inferred' : 'Weak'}
            </span>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
              {data.severity_split.classification === 'classified' ? 'classified' : 'unclassified'}
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3 text-sm text-slate-700">
            <p>Critical: {typeof data.severity_split.critical === 'number' ? data.severity_split.critical : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}</p>
            <p>Moderate: {typeof data.severity_split.moderate === 'number' ? data.severity_split.moderate : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}</p>
            <p>Low: {typeof data.severity_split.low === 'number' ? data.severity_split.low : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 rounded-lg bg-blue-50 px-3 py-3 text-sm text-blue-900">
        <p className="font-semibold">Why this matters</p>
        <p className="mt-1">{data.insightSentence}</p>
      </div>
    </div>
  );
}

