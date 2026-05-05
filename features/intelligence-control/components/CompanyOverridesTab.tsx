import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { CompanyEntry, GlobalConfigRow, Msg, ResolvedJob } from '../types';
import { fmtDate, fmtMinutes, priorityColor } from '../utils';
import SourceBadge from './SourceBadge';

export interface CompanyOverridesTabProps {
  companies: CompanyEntry[];
  search: string;
  selectedId: string;
  jobs: ResolvedJob[];
  loading: boolean;
  expanded: Set<string>;
  editOverride: Record<string, Partial<ResolvedJob['override']>>;
  saving: Set<string>;
  deleting: Set<string>;
  msg: Msg;
  setSearch: (s: string) => void;
  setSelectedId: (id: string) => void;
  toggleExpand: (jt: string) => void;
  setField: (jt: string, field: string, value: unknown) => void;
  setMsg: (m: Msg) => void;
  loadOverrides: (cid: string) => Promise<void>;
  saveOverride: (job: ResolvedJob) => Promise<void>;
  removeOverride: (job: ResolvedJob) => Promise<void>;
}

export default function CompanyOverridesTab({
  companies,
  search,
  selectedId,
  jobs,
  loading,
  expanded,
  editOverride,
  saving,
  deleting,
  msg,
  setSearch,
  toggleExpand,
  setField,
  setMsg,
  loadOverrides,
  saveOverride,
  removeOverride,
}: CompanyOverridesTabProps) {
  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company_id.toLowerCase().includes(search.toLowerCase()),
  );

  const getOvrVal = (job: ResolvedJob, field: keyof NonNullable<ResolvedJob['override']>) =>
    (editOverride[job.job_type] as Record<string, unknown>)?.[field as string]
    ?? job.override?.[field]
    ?? null;

  const selectedCompany = companies.find(c => c.company_id === selectedId);

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {msg.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Company search */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search companies…"
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        {selectedCompany && (
          <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-700">
            <Building2 className="h-4 w-4" />
            <span className="font-semibold">{selectedCompany.name}</span>
          </div>
        )}
      </div>

      {/* Company list */}
      {search && (
        <div className="border border-gray-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
          {filtered.slice(0, 10).map(c => (
            <button
              key={c.company_id}
              onClick={() => { setSearch(''); loadOverrides(c.company_id); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors ${c.company_id === selectedId ? 'bg-indigo-50' : ''}`}
            >
              <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
              <div>
                <p className="font-medium text-gray-800">{c.name}</p>
                <p className="text-[10px] text-gray-400">{c.company_id}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-gray-400 px-4 py-3">No companies found</p>
          )}
        </div>
      )}

      {/* Overrides table */}
      {!selectedId && (
        <div className="text-center py-12 text-gray-400">
          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Search for a company to manage its overrides</p>
        </div>
      )}

      {selectedId && loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading overrides…
        </div>
      )}

      {selectedId && !loading && jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map(job => {
            const isOpen = expanded.has(job.job_type);
            const hasOvr = !!job.override;
            const isSv   = saving.has(job.job_type);
            const isDel  = deleting.has(job.job_type);

            return (
              <div key={job.job_type} className={`rounded-xl border overflow-hidden transition-all ${
                job.is_boosted ? 'border-violet-200 bg-violet-50/30'
                : hasOvr       ? 'border-blue-200 bg-blue-50/20'
                : 'border-gray-200 bg-white'
              }`}>
                {/* Row header */}
                <button
                  type="button"
                  onClick={() => toggleExpand(job.job_type)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  <div className="flex-1 flex items-center gap-3 min-w-0">
                    <span className="font-semibold text-sm text-gray-800">{job.label}</span>
                    <SourceBadge source={job.source} isBoosted={job.is_boosted} />
                    {job.is_boosted && job.boost_expires_at && (
                      <span className="text-[10px] text-violet-600">expires {fmtDate(job.boost_expires_at)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-gray-500 shrink-0">
                    <span className={`font-bold px-1.5 py-0.5 rounded border text-[10px] ${priorityColor(job.priority)}`}>P{job.priority}</span>
                    <span><Clock className="inline h-3 w-3 mr-0.5" />{fmtMinutes(job.frequency_minutes)}</span>
                    <span className={job.enabled ? 'text-emerald-600' : 'text-red-500'}>{job.enabled ? 'Enabled' : 'Disabled'}</span>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </div>
                </button>

                {/* Expanded override editor */}
                {isOpen && (
                  <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {([
                        { field: 'priority',          label: 'Priority (1–10)',   type: 'number', min: 1,  max: 10    },
                        { field: 'frequency_minutes', label: 'Frequency (min)',   type: 'number', min: 1,  max: 10080 },
                        { field: 'max_concurrent',    label: 'Concurrency',       type: 'number', min: 1,  max: 20    },
                        { field: 'timeout_seconds',   label: 'Timeout (s)',       type: 'number', min: 10, max: 3600  },
                      ] as const).map(({ field, label, min, max }) => (
                        <div key={field}>
                          <label className="block text-[10px] font-semibold text-gray-500 mb-1">{label}</label>
                          <input
                            type="number"
                            min={min}
                            max={max}
                            placeholder={String(job.global[field as keyof GlobalConfigRow] ?? '')}
                            value={(getOvrVal(job, field as keyof NonNullable<ResolvedJob['override']>) as number | null) ?? ''}
                            onChange={e => {
                              const n = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setField(job.job_type, field, isNaN(n as number) ? null : n);
                            }}
                            className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Enabled</label>
                        <select
                          value={getOvrVal(job, 'enabled') === null ? '' : getOvrVal(job, 'enabled') ? 'true' : 'false'}
                          onChange={e => setField(job.job_type, 'enabled', e.target.value === '' ? null : e.target.value === 'true')}
                          className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        >
                          <option value="">Use global ({job.global.enabled ? 'Enabled' : 'Disabled'})</option>
                          <option value="true">Force Enabled</option>
                          <option value="false">Force Disabled</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Reason (audit)</label>
                        <input
                          value={(getOvrVal(job, 'reason') as string | null) ?? ''}
                          onChange={e => setField(job.job_type, 'reason', e.target.value || null)}
                          placeholder="Optional note"
                          className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      </div>
                    </div>

                    {/* Global defaults reference */}
                    <div className="text-[10px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                      Global defaults — Priority: {job.global.priority} · Frequency: {fmtMinutes(job.global.frequency_minutes)} · Concurrency: {job.global.max_concurrent} · Timeout: {job.global.timeout_seconds}s
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => saveOverride(job)}
                        disabled={isSv}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {isSv ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save Override
                      </button>
                      {hasOvr && (
                        <button
                          onClick={() => removeOverride(job)}
                          disabled={isDel}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          {isDel ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          Remove Override
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
