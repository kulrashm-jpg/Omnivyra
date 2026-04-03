'use client';

type ProgressItem = {
  label: string;
  score: number | null;
  delta?: number | null;
};

type Props = {
  title?: string;
  items: ProgressItem[];
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function tone(score: number): string {
  if (score > 70) return 'bg-gradient-to-r from-emerald-200 via-emerald-300 to-emerald-500';
  if (score >= 40) return 'bg-gradient-to-r from-amber-200 via-amber-300 to-amber-500';
  return 'bg-gradient-to-r from-rose-200 via-rose-300 to-rose-500';
}

function deltaTone(delta: number): string {
  if (delta > 0) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (delta < 0) return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function formatDelta(delta: number | null | undefined): string | null {
  if (typeof delta !== 'number' || Number.isNaN(delta)) return null;
  const rounded = Math.round(delta * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

export default function ProgressIndicatorBars({ title = 'Performance Progress', items }: Props) {
  const visible = items.slice(0, 4);
  return (
    <section className="report-animate rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-700">
          Snapshot score mix
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {visible.map((item) => {
          if (typeof item.score !== 'number') {
            return (
              <div key={item.label} className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3">
                <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                <p className="mt-1 text-xs text-slate-600">Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.</p>
              </div>
            );
          }

          const value = clamp(item.score);
          const delta = formatDelta(item.delta);
          return (
            <div key={item.label} className="grid grid-cols-[110px_1fr_104px] items-center gap-3">
              <p className="text-sm font-bold text-slate-800">{item.label}</p>
              <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full rounded-full transition-all duration-300 ${tone(value)}`} style={{ width: `${value}%` }} />
              </div>
              <div className="flex items-center justify-end gap-2">
                <p className="text-right text-sm font-extrabold text-slate-900">{value}</p>
                {delta ? (
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${deltaTone(item.delta ?? 0)}`}>
                    {delta}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
