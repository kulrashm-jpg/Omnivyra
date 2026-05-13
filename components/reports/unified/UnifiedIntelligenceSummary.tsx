'use client';

type Props = {
  data: {
    unifiedScore: number;
    marketContextSummary: string;
    dominantGrowthChannel: 'seo' | 'geo_aeo' | 'balanced';
    primaryConstraint: {
      title: string;
      source: 'seo' | 'geo_aeo';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3UnifiedActions: Array<{
      actionTitle: string;
      source: 'seo' | 'geo_aeo';
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }>;
    growthDirection: {
      shortTermFocus: string;
      longTermFocus: string;
    };
    confidence: 'high' | 'medium' | 'low';
  };
};

function channelLabel(value: Props['data']['dominantGrowthChannel']): string {
  if (value === 'geo_aeo') return 'GEO/AEO';
  if (value === 'seo') return 'SEO';
  return 'Balanced';
}

function sourceLabel(value: 'seo' | 'geo_aeo'): string {
  return value === 'geo_aeo' ? 'GEO/AEO' : 'SEO';
}

function badgeClasses(value: 'high' | 'medium' | 'low' | 'critical' | 'moderate') {
  if (value === 'high' || value === 'critical') return 'bg-red-100 text-red-700';
  if (value === 'medium' || value === 'moderate') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

export default function UnifiedIntelligenceSummary({ data }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr_1fr]">
        <div className="rounded-xl bg-indigo-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Unified Intelligence</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{data.marketContextSummary}</p>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm text-slate-600">Unified score</p>
              <p className="text-4xl font-bold text-slate-900">{data.unifiedScore}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${badgeClasses(data.confidence)}`}>
              {data.confidence} confidence
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold uppercase text-indigo-700">
              Dominant {channelLabel(data.dominantGrowthChannel)}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${badgeClasses(data.primaryConstraint.severity)}`}>
              {data.primaryConstraint.severity}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-700">
              Source {sourceLabel(data.primaryConstraint.source)}
            </span>
          </div>
          <h2 className="mt-4 text-base font-bold text-slate-900">{data.primaryConstraint.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{data.primaryConstraint.reasoning}</p>
        </div>

        <div className="rounded-xl bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top 3 Unified Actions</p>
          <div className="mt-4 space-y-3">
            {data.top3UnifiedActions.map((action, index) => (
              <div key={`${action.actionTitle}-${index}`} className="rounded-xl bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-700">
                    {sourceLabel(action.source)}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${badgeClasses(action.priority)}`}>
                    Priority {action.priority}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${badgeClasses(action.expectedImpact)}`}>
                    Impact {action.expectedImpact}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-700">
                    Effort {action.effort}
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-bold text-slate-900">{action.actionTitle}</h3>
                <p className="mt-2 text-sm text-slate-600">{action.reasoning}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-emerald-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Growth Direction</p>
          <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Short-term focus</p>
            <p className="mt-2 text-sm text-slate-700">{data.growthDirection.shortTermFocus}</p>
          </div>
          <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Long-term focus</p>
            <p className="mt-2 text-sm text-slate-700">{data.growthDirection.longTermFocus}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
