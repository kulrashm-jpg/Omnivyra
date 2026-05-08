'use client';

type ComparisonAxis = {
  key: string;
  label: string;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  direction: 'improved' | 'regressed' | 'stagnated' | 'first_observation';
  significant: boolean;
  reduced_confidence: boolean;
  state: 'measured' | 'unavailable';
  reason_unavailable: string | null;
};

type ComparisonStripData = {
  baseline_kind: 'prior_snapshot' | 'benchmark_median';
  baseline_label: string;
  baseline_observed_at: string | null;
  axes: ComparisonAxis[];
};

type Props = {
  prior: ComparisonStripData;
  benchmark: ComparisonStripData;
  maturityProgression: Array<{ observed_at: string; stage: string; authority_score: number | null }>;
};

const DIRECTION_TONE: Record<ComparisonAxis['direction'], string> = {
  improved: 'text-emerald-700',
  regressed: 'text-rose-700',
  stagnated: 'text-slate-600',
  first_observation: 'text-slate-400',
};

const DIRECTION_GLYPH: Record<ComparisonAxis['direction'], string> = {
  improved: '↑',
  regressed: '↓',
  stagnated: '→',
  first_observation: '·',
};

function formatDelta(axis: ComparisonAxis): string {
  if (axis.state === 'unavailable' || axis.delta == null) return '—';
  if (axis.delta > 0) return `+${axis.delta}`;
  return `${axis.delta}`;
}

/**
 * Side-by-side authority comparison strip.
 *
 * Two strips: vs prior snapshot, vs benchmark median. Plus a maturity
 * progression rail at the bottom. Insufficient comparisons render
 * `state: 'unavailable'` honestly; significant deltas are bolded; low-
 * confidence comparisons render muted.
 */
export default function ComparisonStrip({ prior, benchmark, maturityProgression }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Comparison</p>
        <h3 className="mt-1 text-xl font-bold text-slate-900">Side-by-side authority comparison</h3>
        <p className="mt-2 text-sm text-slate-600">
          Current run vs. the most recent prior snapshot and the vertical median. Significant changes (≥5 pts) are bolded; unmeasured axes show as gaps.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ComparisonTable title="vs Prior snapshot" data={prior} />
        <ComparisonTable title="vs Benchmark median" data={benchmark} />
      </div>

      {maturityProgression.length >= 2 ? (
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Maturity progression</p>
          <ol className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            {maturityProgression.map((entry, idx) => (
              <li key={`${entry.observed_at}-${idx}`} className="flex items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-slate-700 border border-slate-200">
                  {new Date(entry.observed_at).toLocaleDateString()}
                </span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold uppercase text-blue-800">
                  {entry.stage.replace(/_/g, ' ')}
                </span>
                {entry.authority_score != null ? (
                  <span className="text-slate-600">{entry.authority_score}/100</span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
                {idx < maturityProgression.length - 1 ? <span aria-hidden className="text-slate-400">→</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function ComparisonTable({ title, data }: { title: string; data: ComparisonStripData }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-[11px] text-slate-500">{data.baseline_label}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="border-b border-slate-200 px-2 py-1.5 text-left font-semibold text-slate-600">Axis</th>
              <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600">Current</th>
              <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600">Baseline</th>
              <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600">Δ</th>
            </tr>
          </thead>
          <tbody>
            {data.axes.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-500">No comparison axes available.</td>
              </tr>
            ) : (
              data.axes.map((axis) => (
                <tr key={axis.key} className={axis.reduced_confidence ? 'opacity-60' : ''}>
                  <td className="border-b border-slate-200 px-2 py-1.5 text-slate-800">{axis.label}</td>
                  <td className="border-b border-slate-200 px-2 py-1.5 text-center text-slate-700">
                    {axis.current ?? '—'}
                  </td>
                  <td className="border-b border-slate-200 px-2 py-1.5 text-center text-slate-700">
                    {axis.baseline ?? '—'}
                  </td>
                  <td
                    className={`border-b border-slate-200 px-2 py-1.5 text-center ${DIRECTION_TONE[axis.direction]} ${axis.significant ? 'font-bold' : ''}`}
                  >
                    {DIRECTION_GLYPH[axis.direction]} {formatDelta(axis)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
