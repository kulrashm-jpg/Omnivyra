'use client';

import { Target } from 'lucide-react';

type Props = {
  data: {
    topCompetitor: string;
    competitorExplanation: string;
    primaryGap: {
      title: string;
      type: 'keyword_gap' | 'authority_gap' | 'answer_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: Array<{
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }>;
    competitivePosition: 'leader' | 'competitive' | 'lagging';
    confidence: 'high' | 'medium' | 'low';
  } | null;
};

function badge(value: 'high' | 'medium' | 'low' | 'critical' | 'moderate') {
  if (value === 'high' || value === 'critical') return 'bg-red-100 text-red-700';
  if (value === 'medium' || value === 'moderate') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

function positionLabel(value: 'leader' | 'competitive' | 'lagging'): string {
  if (value === 'leader') return 'Leader';
  if (value === 'competitive') return 'Competitive';
  return 'Lagging';
}

export default function CompetitorExecutiveSummary({ data }: Props) {
  if (!data) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Target size={14} />Competitor Intelligence</p>
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <div className="rounded-xl bg-slate-50 p-5">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Target size={14} />Competitor Intelligence</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{data.competitorExplanation}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
              Top competitor: {data.topCompetitor}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              Position: {positionLabel(data.competitivePosition)}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge(data.confidence)}`}>
              {data.confidence} confidence
            </span>
          </div>
          <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${badge(data.primaryGap.severity)}`}>
                {data.primaryGap.severity}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-700">
                {data.primaryGap.type.replace(/_/g, ' ')}
              </span>
            </div>
            <h3 className="mt-2 text-sm font-bold text-slate-900">{data.primaryGap.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{data.primaryGap.reasoning}</p>
          </div>
        </div>
        <div className="rounded-xl bg-blue-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Top 3 Actions</p>
          <div className="mt-4 space-y-3">
            {data.top3Actions.map((action, index) => (
              <div key={`${action.actionTitle}-${index}`} className="rounded-xl bg-white p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-900">{action.actionTitle}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${badge(action.priority)}`}>
                    Priority {action.priority}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${badge(action.expectedImpact)}`}>
                    Impact {action.expectedImpact}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                    Effort {action.effort}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{action.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

