import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import type { InsightsData } from '../types';
import { SKIP_REASON_LABELS } from '../constants';
import { fmtDate, fmtDuration } from '../utils';

export interface InsightsTabProps {
  days: number;
  data: InsightsData | null;
  loading: boolean;
  error: string | null;
  load: (d: number) => Promise<void>;
  setDays: (n: number) => void;
}

export default function InsightsTab({ days, data, loading, error, load, setDays }: InsightsTabProps) {
  const maxDayRuns = data ? Math.max(...data.by_day.map(d => d.runs), 1) : 1;

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Aggregated runs from <code className="text-indigo-600">intelligence_execution_log</code>.</p>
        <div className="flex items-center gap-2">
          {[1, 7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                days === d ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600 hover:border-indigo-300'
              }`}
            >
              {d === 1 ? 'Today' : `${d}d`}
            </button>
          ))}
          <button onClick={() => load(days)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 ml-1">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading metrics…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm bg-red-50 border border-red-200 text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* ── Summary cards ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Total Runs',   value: data.summary.total,   color: 'text-gray-800' },
              { label: 'Success',      value: data.summary.success,  color: 'text-emerald-600' },
              { label: 'Failed',       value: data.summary.failed,   color: 'text-red-600' },
              { label: 'Skipped',      value: data.summary.skipped,  color: 'text-amber-600' },
              { label: 'Avg Duration', value: fmtDuration(data.summary.avg_duration_ms), color: 'text-indigo-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-[11px] text-gray-500 mt-0.5 font-medium">{label}</p>
              </div>
            ))}
          </div>

          {/* ── Skip reasons ──────────────────────────────────────────────── */}
          {Object.keys(data.skip_reasons).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-4">Skip Reason Breakdown</h3>
              <div className="space-y-2.5">
                {Object.entries(data.skip_reasons)
                  .sort(([, a], [, b]) => b - a)
                  .map(([reason, count]) => {
                    const pct = Math.round((count / (data.summary.skipped || 1)) * 100);
                    const colorMap: Record<string, string> = {
                      disabled:       'bg-gray-400',
                      budget_exceeded: 'bg-red-400',
                      deferred:       'bg-amber-400',
                    };
                    return (
                      <div key={reason} className="flex items-center gap-3">
                        <div className="w-32 shrink-0 text-[11px] font-semibold text-gray-600">
                          {SKIP_REASON_LABELS[reason] ?? reason}
                        </div>
                        <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${colorMap[reason] ?? 'bg-blue-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="w-16 text-right text-[11px] text-gray-500 font-medium">{count} ({pct}%)</div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ── Jobs per day ──────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-4">Jobs Per Day</h3>
            <div className="flex items-end gap-1.5 h-24">
              {data.by_day.map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  <div className="w-full flex flex-col-reverse gap-px" style={{ height: 80 }}>
                    {/* Stacked bar: completed (emerald), failed (red), skipped (amber) */}
                    <div
                      className="w-full bg-emerald-400 rounded-sm"
                      style={{ height: `${(d.completed / maxDayRuns) * 80}px` }}
                    />
                    {d.failed > 0 && (
                      <div className="w-full bg-red-400 rounded-sm" style={{ height: `${(d.failed / maxDayRuns) * 80}px` }} />
                    )}
                    {d.skipped > 0 && (
                      <div className="w-full bg-amber-300 rounded-sm" style={{ height: `${(d.skipped / maxDayRuns) * 80}px` }} />
                    )}
                  </div>
                  <p className="text-[9px] text-gray-400 truncate w-full text-center">
                    {d.date.slice(5)} {/* MM-DD */}
                  </p>
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col bg-gray-900 text-white text-[10px] rounded-lg px-2.5 py-1.5 gap-0.5 whitespace-nowrap z-10 shadow-lg">
                    <span className="text-gray-300">{d.date}</span>
                    <span className="text-emerald-400">✓ {d.completed} success</span>
                    {d.failed  > 0 && <span className="text-red-400">✗ {d.failed} failed</span>}
                    {d.skipped > 0 && <span className="text-amber-400">⊘ {d.skipped} skipped</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" /> Success</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> Failed</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-300 inline-block" /> Skipped</span>
            </div>
          </div>

          {/* ── Per-job-type table ────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-700">By Job Type</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Job Type', 'Total', 'Success', 'Failed', 'Skipped', 'Avg Duration'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.by_job_type.map(row => (
                  <tr key={row.job_type} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-800 text-xs">{row.job_type}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-bold text-gray-700">{row.total}</td>
                    <td className="px-4 py-2.5 text-xs text-emerald-600 font-semibold">{row.completed}</td>
                    <td className="px-4 py-2.5 text-xs text-red-500 font-semibold">{row.failed || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-amber-600 font-semibold">{row.skipped || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDuration(row.avg_duration_ms)}</td>
                  </tr>
                ))}
                {data.by_job_type.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">No runs in this period</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Slowest runs ──────────────────────────────────────────────── */}
          {data.slowest_runs.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700">Slowest Runs</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Job Type', 'Company', 'Duration', 'Started At'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.slowest_runs.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 text-xs font-medium text-gray-800">{r.job_type}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{r.company_id ?? <span className="italic text-gray-400">global</span>}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-orange-600">{fmtDuration(r.duration_ms)}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-400">{fmtDate(r.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
