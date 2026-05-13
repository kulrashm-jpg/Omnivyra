'use client';

import { Network } from 'lucide-react';

type Props = {
  data: {
    overallAiVisibilityScore: number;
    primaryGap: {
      title: string;
      type: 'answer_gap' | 'entity_gap' | 'structure_gap';
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
    visibilityOpportunity: {
      title: string;
      estimatedAiExposure: string;
      basedOn: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
};

export default function GeoAeoExecutiveSummary({ data }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr_0.9fr]">
        <div className="rounded-xl bg-teal-50 p-5">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-700"><Network size={14} />AI Visibility Summary</p>
          <p className="mt-4 text-4xl font-bold text-slate-900">{data.overallAiVisibilityScore}</p>
          <p className="mt-2 text-sm text-slate-600">{data.primaryGap.title}</p>
          <p className="mt-3 text-sm text-slate-600">{data.primaryGap.reasoning}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top GEO/AEO Actions</p>
          <div className="mt-4 space-y-3">
            {data.top3Actions.map((action, index) => (
              <div key={`${action.actionTitle}-${index}`} className="rounded-xl bg-white p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-900">{action.actionTitle}</p>
                <p className="mt-2 text-sm text-slate-600">{action.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Visibility Opportunity</p>
          {data.visibilityOpportunity ? (
            <>
              <p className="mt-4 text-base font-bold text-slate-900">{data.visibilityOpportunity.title}</p>
              <p className="mt-3 text-sm text-emerald-900">{data.visibilityOpportunity.estimatedAiExposure}</p>
              <p className="mt-3 text-sm text-slate-600">{data.visibilityOpportunity.basedOn}</p>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-emerald-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.</div>
          )}
        </div>
      </div>
    </section>
  );
}

