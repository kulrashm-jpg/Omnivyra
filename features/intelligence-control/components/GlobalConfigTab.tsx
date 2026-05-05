import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Save, ToggleLeft, ToggleRight, X } from 'lucide-react';
import type { GlobalConfigRow, Msg } from '../types';
import { fmtDate, fmtMinutes, priorityColor, statusDot } from '../utils';
import InlineNumber from './InlineNumber';

export interface GlobalConfigTabProps {
  configs: GlobalConfigRow[];
  loading: boolean;
  edits: Record<string, Partial<GlobalConfigRow>>;
  saving: Set<string>;
  msg: Msg;
  load: () => Promise<void>;
  save: (row: GlobalConfigRow) => Promise<void>;
  setEdit: (jobType: string, field: string, value: unknown) => void;
  setMsg: (m: Msg) => void;
}

export default function GlobalConfigTab({
  configs,
  loading,
  edits,
  saving,
  msg,
  load,
  save,
  setEdit,
  setMsg,
}: GlobalConfigTabProps) {
  function getVal<K extends keyof GlobalConfigRow>(row: GlobalConfigRow, field: K): GlobalConfigRow[K] {
    return (edits[row.job_type]?.[field] as GlobalConfigRow[K]) ?? row[field];
  }

  const isDirty = (jt: string) => !!edits[jt] && Object.keys(edits[jt]).length > 0;

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {msg.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Global defaults apply to all companies unless a company override exists.
        </p>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Job Type', 'Priority', 'Frequency', 'Concurrency', 'Timeout', 'Retries', 'Enabled', 'Last Run', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {configs.map(row => {
                const dirty = isDirty(row.job_type);
                const sv    = saving.has(row.job_type);
                return (
                  <tr key={row.job_type} className={dirty ? 'bg-indigo-50/40' : 'hover:bg-gray-50/50'}>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-gray-800 text-xs">{row.label}</p>
                      <p className="text-[10px] text-gray-400">{row.job_type}</p>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <InlineNumber value={getVal(row, 'priority') as number} min={1} max={10}
                          onChange={v => setEdit(row.job_type, 'priority', v)} />
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${priorityColor(getVal(row, 'priority') as number)}`}>
                          P{getVal(row, 'priority')}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <InlineNumber value={getVal(row, 'frequency_minutes') as number} min={1} max={10080}
                          onChange={v => setEdit(row.job_type, 'frequency_minutes', v)} />
                        <span className="text-[10px] text-gray-400">{fmtMinutes(getVal(row, 'frequency_minutes') as number)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <InlineNumber value={getVal(row, 'max_concurrent') as number} min={1} max={20}
                        onChange={v => setEdit(row.job_type, 'max_concurrent', v)} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <InlineNumber value={getVal(row, 'timeout_seconds') as number} min={10} max={3600}
                          onChange={v => setEdit(row.job_type, 'timeout_seconds', v)} />
                        <span className="text-[10px] text-gray-400">s</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <InlineNumber value={getVal(row, 'retry_count') as number} min={0} max={10}
                        onChange={v => setEdit(row.job_type, 'retry_count', v)} />
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setEdit(row.job_type, 'enabled', !(getVal(row, 'enabled') as boolean))}
                        className="flex items-center"
                        title={getVal(row, 'enabled') ? 'Click to disable' : 'Click to enable'}
                      >
                        {getVal(row, 'enabled')
                          ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                          : <ToggleLeft  className="h-5 w-5 text-gray-300" />
                        }
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      {row.last_run ? (
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(row.last_run.status)}`} />
                          <div>
                            <p className="text-[10px] text-gray-600">{fmtDate(row.last_run.started_at)}</p>
                            {row.last_run.duration_ms != null && (
                              <p className="text-[9px] text-gray-400">{(row.last_run.duration_ms / 1000).toFixed(1)}s</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-400">Never run</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {dirty && (
                        <button
                          onClick={() => save(row)}
                          disabled={sv}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          {sv ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          Save
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
