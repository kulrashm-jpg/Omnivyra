'use client';

type Props = {
  data: {
    queries: Array<{
      query: string;
      coverage: 'full' | 'partial' | 'missing';
      answer_quality_score: number;
    }>;
    confidence: 'high' | 'medium' | 'low';
  };
};

export default function QueryAnswerCoverageMap({ data }: Props) {
  const color = (coverage: 'full' | 'partial' | 'missing') =>
    coverage === 'full' ? 'bg-emerald-100 text-emerald-700' : coverage === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Query Answer Coverage</p>
          <p className="mt-2 text-sm text-slate-600">Which likely AI-answer queries are fully covered, partially covered, or still missing.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-700">{data.confidence} confidence</span>
      </div>
      <div className="mt-4 space-y-2">
        {data.queries.length > 0 ? data.queries.slice(0, 6).map((item) => (
          <div key={item.query} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-sm font-medium text-slate-800">{item.query}</span>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${color(item.coverage)}`}>{item.coverage}</span>
              <span className="text-xs font-semibold text-slate-600">{item.answer_quality_score}/100</span>
            </div>
          </div>
        )) : <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.</div>}
      </div>
    </div>
  );
}

