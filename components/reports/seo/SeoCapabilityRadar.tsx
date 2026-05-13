'use client';

import {
  Activity,
  Compass,
  Radar as RadarIcon,
  SearchCheck,
  ShieldCheck,
} from 'lucide-react';
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

type MetricKey =
  | 'technical_seo_score'
  | 'keyword_research_score'
  | 'rank_tracking_score'
  | 'backlinks_score'
  | 'competitor_intelligence_score'
  | 'content_quality_score';

type Metric = {
  key: MetricKey;
  label: string;
  shortLabel: string;
  value: number | null;
  icon: typeof SearchCheck;
  accent: string;
};

function confidenceClasses(confidence: Confidence): string {
  if (confidence === 'high') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (confidence === 'medium') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function dataStrengthClasses(value?: 'strong' | 'inferred' | 'weak' | 'missing'): string {
  if (value === 'strong') return 'bg-emerald-100 text-emerald-700';
  if (value === 'inferred') return 'bg-sky-100 text-sky-700';
  if (value === 'weak') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-200 text-slate-700';
}

function dataStrengthLabel(value?: 'strong' | 'inferred' | 'weak' | 'missing'): string {
  if (value === 'strong') return 'Strong';
  if (value === 'inferred') return 'Inferred';
  if (value === 'weak') return 'Weak';
  return 'Missing';
}

function clampScore(value: number | null): number {
  if (typeof value !== 'number') return 0;
  return Math.max(0, Math.min(100, value));
}

function formatScore(value: number | null): string {
  return typeof value === 'number' ? `${Math.round(value)}` : '--';
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getBandLabel(value: number | null): string {
  if (typeof value !== 'number') return 'Not enough data';
  if (value >= 70) return 'Operational strength';
  if (value >= 45) return 'Building momentum';
  if (value >= 20) return 'Early-stage coverage';
  return 'Critical gap';
}

export default function SeoCapabilityRadar({ data }: Props) {
  const metrics: Metric[] = [
    {
      key: 'technical_seo_score',
      label: 'Technical SEO',
      shortLabel: 'Technical',
      value: data.technical_seo_score,
      icon: SearchCheck,
      accent: 'from-sky-500 to-blue-600',
    },
    {
      key: 'keyword_research_score',
      label: 'Keyword Research',
      shortLabel: 'Research',
      value: data.keyword_research_score,
      icon: Compass,
      accent: 'from-cyan-500 to-sky-500',
    },
    {
      key: 'rank_tracking_score',
      label: 'Rank Tracking',
      shortLabel: 'Tracking',
      value: data.rank_tracking_score,
      icon: Activity,
      accent: 'from-amber-400 to-orange-500',
    },
    {
      key: 'backlinks_score',
      label: 'Backlinks',
      shortLabel: 'Backlinks',
      value: data.backlinks_score,
      icon: ShieldCheck,
      accent: 'from-indigo-500 to-blue-500',
    },
    {
      key: 'competitor_intelligence_score',
      label: 'Competitor Intel',
      shortLabel: 'Competitor',
      value: data.competitor_intelligence_score,
      icon: RadarIcon,
      accent: 'from-rose-500 to-orange-500',
    },
    {
      key: 'content_quality_score',
      label: 'Content Quality',
      shortLabel: 'Content',
      value: data.content_quality_score,
      icon: Compass,
      accent: 'from-emerald-500 to-teal-500',
    },
  ];

  const available = metrics.filter((item) => typeof item.value === 'number');
  const chartData = metrics.map((item) => ({
    metric: item.shortLabel,
    fullLabel: item.label,
    value: clampScore(item.value),
    tooltip: data.tooltips[item.key] || item.label,
  }));
  const orderedByScore = [...available].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const strongestMetric = orderedByScore[0] ?? null;
  const weakestMetric = orderedByScore[orderedByScore.length - 1] ?? null;
  const averageScore = available.length ? average(available.map((item) => item.value as number)) : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fafc_48%,#ecfeff_100%)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">SEO Capability Radar</p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900">How the SEO system is balanced right now</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              This view shows whether your SEO system is maturing evenly or leaning too heavily on one dimension while other capabilities lag behind.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase ${confidenceClasses(data.confidence)}`}>
            {data.confidence} confidence
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/70 bg-white/80 p-4 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">System Average</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-3xl font-bold text-slate-900">{averageScore ?? '--'}</span>
              <span className="pb-1 text-sm text-slate-500">/100</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{getBandLabel(averageScore)}</p>
          </div>

          <div className="rounded-xl border border-white/70 bg-white/80 p-4 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Strongest Area</p>
            <p className="mt-2 text-lg font-bold text-slate-900">
              {strongestMetric ? strongestMetric.label : 'Pending signal'}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {strongestMetric ? `${formatScore(strongestMetric.value)}/100` : 'No reliable score yet'}
            </p>
          </div>

          <div className="rounded-xl border border-white/70 bg-white/80 p-4 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Biggest Gap</p>
            <p className="mt-2 text-lg font-bold text-slate-900">
              {weakestMetric ? weakestMetric.label : 'Pending signal'}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {weakestMetric ? `${formatScore(weakestMetric.value)}/100` : 'No reliable score yet'}
            </p>
          </div>
        </div>
      </div>

      {available.length > 0 ? (
        <div className="grid gap-0 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="border-b border-slate-200 p-5 xl:border-b-0 xl:border-r">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Capability Shape</p>
                <p className="text-xs text-slate-500">Balanced systems trend outward across all six dimensions.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {available.length} of {metrics.length} signals active
              </span>
            </div>
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={chartData} outerRadius="72%">
                  <PolarGrid gridType="polygon" stroke="#bfdbfe" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: '#334155', fontSize: 13, fontWeight: 600 }} />
                  <Radar dataKey="value" stroke="#1d4ed8" strokeWidth={2.5} fill="#60a5fa" fillOpacity={0.32} />
                  <Tooltip
                    formatter={(value: number, _name, payload) => [`${Math.round(value)}/100`, payload?.payload?.fullLabel ?? 'Score']}
                    labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.tooltip ?? '')}
                    contentStyle={{ borderRadius: 16, borderColor: '#bfdbfe', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)' }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-50/70 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Dimension Breakdown</p>
                <p className="text-xs text-slate-500">Each score shows maturity, support strength, and source coverage.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {metrics.map((item) => {
                const Icon = item.icon;
                const score = clampScore(item.value);
                const strength = data.data_source_strength?.[item.key];
                const sourceTags = (data.source_tags?.[item.key] ?? []).filter(Boolean);

                return (
                  <article key={item.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className={`rounded-xl bg-gradient-to-br ${item.accent} p-2 text-white shadow-sm`}>
                          <Icon size={16} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-500">{data.tooltips[item.key] || item.label}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-slate-900">{formatScore(item.value)}</div>
                        <div className="text-[11px] uppercase tracking-wide text-slate-400">/100</div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full bg-gradient-to-r ${item.accent}`} style={{ width: `${score}%` }} />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${dataStrengthClasses(strength)}`}>
                        {dataStrengthLabel(strength)} evidence
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                        {getBandLabel(item.value)}
                      </span>
                    </div>

                    <p className="mt-2 text-xs text-slate-500">
                      {sourceTags.length > 0 ? sourceTags.join(', ') : 'No source tags classified yet'}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6">
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center">
            <p className="text-sm font-semibold text-slate-700">SEO signals are still too thin to map a meaningful capability shape.</p>
            <p className="mt-2 text-sm text-slate-500">
              Once crawl, content, tracking, and competitor evidence deepen, this card will show a complete operational picture instead of directional hints.
            </p>
          </div>
        </div>
      )}

      <div className="border-t border-slate-200 bg-blue-50/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">What This Means</p>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-blue-950">{data.insightSentence}</p>
      </div>
    </section>
  );
}
