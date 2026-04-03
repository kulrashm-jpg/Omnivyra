'use client';

type Confidence = 'high' | 'medium' | 'low' | 'limited data';
type Trend = 'improving' | 'declining' | 'stable' | 'rising' | 'falling';

function normalizeConfidence(value: string | null | undefined): Confidence {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'low') return 'low';
  return 'limited data';
}

export function MarketPulseConfidenceBadge({ value }: { value: string | null | undefined }) {
  const confidence = normalizeConfidence(value);
  const tone =
    confidence === 'high'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : confidence === 'medium'
        ? 'bg-amber-100 text-amber-800 border-amber-200'
        : confidence === 'low'
          ? 'bg-rose-100 text-rose-800 border-rose-200'
          : 'bg-slate-100 text-slate-700 border-slate-200';

  const dot =
    confidence === 'high' ? 'bg-emerald-500' : confidence === 'medium' ? 'bg-amber-500' : confidence === 'low' ? 'bg-rose-500' : 'bg-slate-400';

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${tone}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      Confidence: {confidence}
    </span>
  );
}

export function MarketPulseTrendPill({ trend }: { trend: Trend }) {
  const tone =
    trend === 'improving' || trend === 'rising'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : trend === 'declining' || trend === 'falling'
        ? 'bg-rose-100 text-rose-800 border-rose-200'
        : 'bg-amber-100 text-amber-800 border-amber-200';

  const arrow = trend === 'improving' || trend === 'rising' ? '↑' : trend === 'declining' || trend === 'falling' ? '↓' : '→';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${tone}`}>
      <span>{arrow}</span>
      {trend}
    </span>
  );
}

export function MarketPulseSignalBox({
  title = 'Key Signal',
  text,
  tone = 'blue',
}: {
  title?: string;
  text: string;
  tone?: 'blue' | 'teal' | 'slate';
}) {
  const classes =
    tone === 'teal'
      ? 'border-teal-200 bg-teal-50 text-teal-900'
      : tone === 'slate'
        ? 'border-slate-200 bg-slate-50 text-slate-800'
        : 'border-blue-200 bg-blue-50 text-blue-900';

  const titleClass = tone === 'teal' ? 'text-teal-700' : tone === 'slate' ? 'text-slate-600' : 'text-blue-700';

  return (
    <div className={`rounded-lg border px-3 py-3 ${classes}`}>
      <p className={`text-xs font-bold uppercase tracking-wide ${titleClass}`}>{title}</p>
      <p className="mt-1 text-sm">{text}</p>
    </div>
  );
}
