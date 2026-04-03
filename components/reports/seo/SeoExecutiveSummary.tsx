'use client';

import { Gauge } from 'lucide-react';

type Props = {
  data: {
    overallHealthScore: number;
    primaryProblem: {
      title: string;
      impactedArea: 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: Array<{
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }>;
    growthOpportunity: {
      title: string;
      estimatedUpside: string;
      basedOn: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
};

function badgeClasses(value: 'high' | 'medium' | 'low' | 'critical' | 'moderate') {
  if (value === 'high' || value === 'critical') return 'bg-red-100 text-red-700';
  if (value === 'medium' || value === 'moderate') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

function impactedAreaLabel(value: Props['data']['primaryProblem']['impactedArea']): string {
  return value.replace(/_/g, ' ');
}

export default function SeoExecutiveSummary({ data }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-5 xl:grid-cols-[1.1fr_1.2fr_0.9fr]">
        <div className="rounded-xl bg-slate-50 p-5">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Gauge size={14} />Executive SEO Summary</p>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm text-slate-600">Overall health</p>
              <p className="text-4xl font-bold text-slate-900">{data.overallHealthScore}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${badgeClasses(data.confidence)}`}>
              {data.confidence} confidence
            </span>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${badgeClasses(data.primaryProblem.severity)}`}>
                {data.primaryProblem.severity}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-700">
                {impactedAreaLabel(data.primaryProblem.impactedArea)}
              </span>
            </div>
            <h2 className="mt-3 text-lg font-bold text-slate-900">{data.primaryProblem.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{data.primaryProblem.reasoning}</p>
          </div>
        </div>

        <div className="rounded-xl bg-blue-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Top 3 Actions</p>
          <div className="mt-4 space-y-3">
            {data.top3Actions.map((action, index) => (
              <div key={`${action.actionTitle}-${index}`} className="rounded-xl bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Action {index + 1}</p>
                    <h3 className="mt-1 text-sm font-bold text-slate-900">{action.actionTitle}</h3>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-700">
                    {action.linkedVisual}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${badgeClasses(action.priority)}`}>
                    Priority {action.priority}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${badgeClasses(action.expectedImpact)}`}>
                    Impact {action.expectedImpact}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                    Effort {action.effort}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600">{action.reasoning}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-emerald-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Growth Opportunity</p>
          {data.growthOpportunity ? (
            <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
              <h3 className="text-base font-bold text-slate-900">{data.growthOpportunity.title}</h3>
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-900">
                {data.growthOpportunity.estimatedUpside}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{data.growthOpportunity.basedOn}</p>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-emerald-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

