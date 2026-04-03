'use client';

import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

type Confidence = 'high' | 'medium' | 'low';

type Props = {
  data: {
    technical_seo_score: number | null;
    keyword_research_score: number | null;
    rank_tracking_score: number | null;
    backlinks_score: number | null;
    competitor_intelligence_score: number | null;
    content_quality_score: number | null;
    confidence: Confidence;
    data_source_strength?: {
      technical_seo_score: 'strong' | 'inferred' | 'weak' | 'missing';
      keyword_research_score: 'strong' | 'inferred' | 'weak' | 'missing';
      rank_tracking_score: 'strong' | 'inferred' | 'weak' | 'missing';
      backlinks_score: 'strong' | 'inferred' | 'weak' | 'missing';
      competitor_intelligence_score: 'strong' | 'inferred' | 'weak' | 'missing';
      content_quality_score: 'strong' | 'inferred' | 'weak' | 'missing';
    };
    source_tags?: {
      technical_seo_score: string[] | null;
      keyword_research_score: string[] | null;
      rank_tracking_score: string[] | null;
      backlinks_score: string[] | null;
      competitor_intelligence_score: string[] | null;
      content_quality_score: string[] | null;
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

function dataStrengthLabel(value?: 'strong' | 'inferred' | 'weak' | 'missing'): string {
  if (value === 'strong') return 'Strong';
  if (value === 'inferred') return 'Inferred';
  if (value === 'weak') return 'Weak';
  return 'Missing';
}

export default function SeoCapabilityRadar({ data }: Props) {
  const metrics = [
    { key: 'technical_seo_score', label: 'Technical SEO', value: data.technical_seo_score },
    { key: 'keyword_research_score', label: 'Keyword Research', value: data.keyword_research_score },
    { key: 'rank_tracking_score', label: 'Rank Tracking', value: data.rank_tracking_score },
    { key: 'backlinks_score', label: 'Backlinks', value: data.backlinks_score },
    { key: 'competitor_intelligence_score', label: 'Competitor Intel', value: data.competitor_intelligence_score },
    { key: 'content_quality_score', label: 'Content Quality', value: data.content_quality_score },
  ];

  const available = metrics.filter((item) => typeof item.value === 'number');
  const chartData = metrics.map((item) => ({
    metric: item.label,
    value: typeof item.value === 'number' ? item.value : 0,
    tooltip: data.tooltips[item.key] || item.label,
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">SEO Capability Radar</p>
          <p className="mt-2 text-sm text-slate-600">A quick read on where SEO capability is strongest versus weakest.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${confidenceClasses(data.confidence)}`}>
          {data.confidence} confidence
        </span>
      </div>

      {available.length > 0 ? (
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={chartData} outerRadius="70%">
              <PolarGrid stroke="#cbd5e1" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: '#475569', fontSize: 12 }} />
              <Radar dataKey="value" stroke="#2563eb" fill="#60a5fa" fillOpacity={0.35} />
              <Tooltip
                formatter={(value: number) => [`${Math.round(value)}/100`, 'Score']}
                contentStyle={{ borderRadius: 12, borderColor: '#cbd5e1' }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {metrics.map((item) => (
          <div key={item.key} className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-700" title={data.tooltips[item.key]}>
                {item.label}
              </span>
              <span className="text-sm font-semibold text-slate-900">
                {typeof item.value === 'number' ? item.value : 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                Data Strength: {dataStrengthLabel(data.data_source_strength?.[item.key as keyof NonNullable<typeof data.data_source_strength>])}
              </span>
              <span className="text-[11px] text-slate-500">
                {(data.source_tags?.[item.key as keyof NonNullable<typeof data.source_tags>] ?? ['unclassified']).join(', ')}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-blue-50 px-3 py-3 text-sm text-blue-900">
        <p className="font-semibold">Why this matters</p>
        <p className="mt-1">{data.insightSentence}</p>
      </div>
    </div>
  );
}

