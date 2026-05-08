'use client';

import { Score, type CanonicalScore } from './CanonicalPrimitives';

type ProviderId = 'chatgpt' | 'gemini' | 'claude' | 'perplexity' | 'copilot';
type QueryClass = 'branded' | 'category' | 'competitive' | 'expertise';
type CellState = 'measured' | 'inferred' | 'insufficient_signal' | 'unavailable';

type Cell = {
  provider: ProviderId;
  query_class: QueryClass;
  state: CellState;
  citation_rate: number | null;
  mean_prominence: number | null;
  observed_count: number;
  reason_unavailable: string | null;
};

type Props = {
  data: {
    state: CellState;
    overall_score: CanonicalScore;
    cells: Cell[];
    by_provider: Array<{
      provider: ProviderId;
      state: CellState;
      citation_rate: number | null;
      mean_prominence: number | null;
    }>;
    by_query_class: Array<{
      query_class: QueryClass;
      state: CellState;
      citation_rate: number | null;
      mean_prominence: number | null;
    }>;
    coverage: { measured_cells: number; unavailable_cells: number; total_cells: number };
  };
};

const PROVIDER_LABEL: Record<ProviderId, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
  copilot: 'Copilot',
};

const QUERY_CLASS_LABEL: Record<QueryClass, string> = {
  branded: 'Branded',
  category: 'Category',
  competitive: 'Competitive',
  expertise: 'Expertise',
};

function cellClasses(cell: Cell): string {
  if (cell.state === 'unavailable') return 'bg-slate-100 text-slate-500 border-slate-200';
  if (cell.state === 'insufficient_signal') return 'bg-slate-50 text-slate-500 border-slate-200';
  if (cell.citation_rate == null) return 'bg-slate-100 text-slate-500 border-slate-200';
  if (cell.citation_rate >= 0.6) return 'bg-emerald-50 text-emerald-900 border-emerald-200';
  if (cell.citation_rate >= 0.3) return 'bg-amber-50 text-amber-900 border-amber-200';
  return 'bg-rose-50 text-rose-900 border-rose-200';
}

function cellContent(cell: Cell): string {
  if (cell.state === 'unavailable') return 'Unavailable';
  if (cell.state === 'insufficient_signal') return 'Insufficient';
  if (cell.citation_rate == null) return '—';
  return `${Math.round(cell.citation_rate * 100)}%`;
}

const PROVIDERS: ProviderId[] = ['chatgpt', 'gemini', 'claude', 'perplexity', 'copilot'];
const QUERY_CLASSES: QueryClass[] = ['branded', 'category', 'competitive', 'expertise'];

/**
 * Canonical AI Citation Matrix.
 *
 * Rows: 5 LLM providers. Columns: 4 query classes. Cells render:
 *  - measured: citation rate as %
 *  - unavailable: "Unavailable" label (provider not configured)
 *  - insufficient_signal: "Insufficient" label
 *
 * No synthetic numbers. Phase 3 ships the architecture; cells are populated only
 * by real provider adapters. When zero providers are configured, the matrix
 * shows 20 unavailable cells — and that is the correct, honest state.
 */
export default function AICitationMatrix({ data }: Props) {
  const cellByKey = new Map<string, Cell>();
  for (const cell of data.cells) {
    cellByKey.set(`${cell.provider}|${cell.query_class}`, cell);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">AI Citation Matrix</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">
            Live citation presence across 5 LLMs × 4 query classes
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            Each cell is a real probe result. When a provider adapter is unavailable, the cell reads
            <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">Unavailable</span>
            — never a fabricated number.
          </p>
        </div>
        <Score score={data.overall_score} size="lg" showBand showEvidence />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
          {data.coverage.measured_cells} of {data.coverage.total_cells} measured
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
          {data.coverage.unavailable_cells} unavailable
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600">Provider</th>
              {QUERY_CLASSES.map((qc) => (
                <th key={qc} className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">
                  {QUERY_CLASS_LABEL[qc]}
                </th>
              ))}
              <th className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600">Avg.</th>
            </tr>
          </thead>
          <tbody>
            {PROVIDERS.map((provider) => {
              const providerSummary = data.by_provider.find((p) => p.provider === provider);
              return (
                <tr key={provider}>
                  <td className="border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700">
                    {PROVIDER_LABEL[provider]}
                  </td>
                  {QUERY_CLASSES.map((qc) => {
                    const cell = cellByKey.get(`${provider}|${qc}`);
                    if (!cell) {
                      return (
                        <td key={qc} className="border-b border-slate-200 px-1 py-1.5 text-center">
                          <div className="rounded border border-slate-200 bg-slate-100 px-2 py-1.5 text-[11px] text-slate-500">—</div>
                        </td>
                      );
                    }
                    return (
                      <td key={qc} className="border-b border-slate-200 px-1 py-1.5 text-center">
                        <div
                          className={`rounded border px-2 py-1.5 text-[11px] font-semibold ${cellClasses(cell)}`}
                          title={cell.reason_unavailable ?? `${cell.observed_count} mention${cell.observed_count === 1 ? '' : 's'}`}
                        >
                          {cellContent(cell)}
                        </div>
                      </td>
                    );
                  })}
                  <td className="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-700">
                    {providerSummary?.state === 'measured' && providerSummary.citation_rate != null
                      ? `${Math.round(providerSummary.citation_rate * 100)}%`
                      : '—'}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-slate-50">
              <td className="px-3 py-2 font-semibold text-slate-600">Avg.</td>
              {QUERY_CLASSES.map((qc) => {
                const summary = data.by_query_class.find((s) => s.query_class === qc);
                return (
                  <td key={qc} className="px-3 py-2 text-center font-semibold text-slate-700">
                    {summary?.state === 'measured' && summary.citation_rate != null
                      ? `${Math.round(summary.citation_rate * 100)}%`
                      : '—'}
                  </td>
                );
              })}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-slate-500">
        Cells colour-code by citation rate (≥60% emerald · ≥30% amber · &lt;30% rose). Hover any cell
        to see the reason or evidence count.
      </p>
    </section>
  );
}
