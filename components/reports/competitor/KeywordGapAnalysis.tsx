'use client';

type Props = {
  data: {
    missing_keywords: string[];
    weak_keywords: string[];
    strong_keywords: string[];
    confidence: 'high' | 'medium' | 'low';
  };
};

function Pill({ label, tone }: { label: string; tone: 'missing' | 'weak' | 'strong' }) {
  const cls =
    tone === 'missing'
      ? 'bg-red-100 text-red-700'
      : tone === 'weak'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-emerald-100 text-emerald-700';
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

export default function KeywordGapAnalysis({ data }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Keyword Gap Analysis</p>
          <p className="mt-1 text-sm text-slate-600">Competitor keyword overlap and gap split.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
          {data.confidence} confidence
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">Missing Keywords</p>
          <div className="flex flex-wrap gap-2">
            {data.missing_keywords.length > 0 ? data.missing_keywords.slice(0, 10).map((item, idx) => (
              <Pill key={`${item}-${idx}`} label={item} tone="missing" />
            )) : <span className="text-sm text-slate-500">Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.</span>}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Weak Keywords</p>
          <div className="flex flex-wrap gap-2">
            {data.weak_keywords.length > 0 ? data.weak_keywords.slice(0, 10).map((item, idx) => (
              <Pill key={`${item}-${idx}`} label={item} tone="weak" />
            )) : <span className="text-sm text-slate-500">Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.</span>}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Strong Keywords</p>
          <div className="flex flex-wrap gap-2">
            {data.strong_keywords.length > 0 ? data.strong_keywords.slice(0, 10).map((item, idx) => (
              <Pill key={`${item}-${idx}`} label={item} tone="strong" />
            )) : <span className="text-sm text-slate-500">Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

