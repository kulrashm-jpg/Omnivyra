/** Part 1/2 of IntelControlView.tsx — verbatim split (barrel preserved; importers unchanged). */
/**
 * Intelligence Orchestration Control Panel
 *
 * Super-admin only. Three tabs:
 *   1. Global Config     — edit priority, frequency, enabled, concurrency per job type
 *   2. Company Overrides — search company, view + edit per-job overrides
 *   3. Account Boost     — apply / remove new-account boost
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Settings, Building2, Zap, ChevronDown, ChevronUp, Save,
  RefreshCw, AlertCircle, CheckCircle2, Loader2, Trash2,
  Clock, ToggleLeft, ToggleRight, Search, Plus, X,
  TrendingUp, Activity, Shield, BarChart2,
} from 'lucide-react';
import { useCompanyContext } from './CompanyContext';

// ── Types ─────────────────────────────────────────────────────────────────────


interface GlobalConfigRow {
  job_type:          string;
  label:             string;
  description:       string | null;
  priority:          number;
  frequency_minutes: number;
  enabled:           boolean;
  max_concurrent:    number;
  timeout_seconds:   number;
  retry_count:       number;
  model:             string | null;
  updated_at:        string;
  updated_by:        string;
  last_run:          { started_at: string; status: string; duration_ms: number | null } | null;
}

interface ResolvedJob {
  job_type:          string;
  label:             string;
  priority:          number;
  frequency_minutes: number;
  enabled:           boolean;
  max_concurrent:    number;
  timeout_seconds:   number;
  retry_count:       number;
  model:             string | null;
  is_boosted:        boolean;
  boost_expires_at:  string | null;
  source:            'global' | 'override' | 'boosted';
  override: {
    id:                      string;
    priority:                number | null;
    frequency_minutes:       number | null;
    enabled:                 boolean | null;
    max_concurrent:          number | null;
    timeout_seconds:         number | null;
    retry_count:             number | null;
    model:                   string | null;
    boost_until:             string | null;
    boost_priority:          number | null;
    boost_frequency_minutes: number | null;
    reason:                  string | null;
    updated_at:              string;
    updated_by:              string;
  } | null;
  global: GlobalConfigRow;
}

export type Tab = 'global' | 'overrides' | 'boost' | 'insights';

// ── Insights types ─────────────────────────────────────────────────────────────

interface InsightsSummary {
  total:           number;
  success:         number;
  failed:          number;
  skipped:         number;
  avg_duration_ms: number | null;
}
interface DayBucket   { date: string; completed: number; failed: number; skipped: number; runs: number }
interface JobTypeStat { job_type: string; completed: number; failed: number; skipped: number; total: number; avg_duration_ms: number | null }
interface SlowestRun  { job_type: string; company_id: string | null; duration_ms: number | null; started_at: string }
export interface InsightsData {
  period_days:  number;
  summary:      InsightsSummary;
  skip_reasons: Record<string, number>;
  by_day:       DayBucket[];
  by_job_type:  JobTypeStat[];
  slowest_runs: SlowestRun[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtMinutes(m: number) {
  if (m < 60)   return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
export function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function priorityColor(p: number) {
  if (p <= 3) return 'text-red-600 bg-red-50 border-red-200';
  if (p <= 5) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-gray-500 bg-gray-50 border-gray-200';
}
function statusDot(status: string) {
  if (status === 'completed') return 'bg-emerald-400';
  if (status === 'failed')    return 'bg-red-400';
  if (status === 'running')   return 'bg-blue-400 animate-pulse';
  return 'bg-gray-300';
}

// ── Inline number/text input ───────────────────────────────────────────────────

function InlineNumber({
  value, min, max, onChange,
}: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={e => {
        const n = parseInt(e.target.value, 10);
        if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      className="w-20 px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
    />
  );
}

// ── Source badge ───────────────────────────────────────────────────────────────

function SourceBadge({ source, isBoosted }: { source: string; isBoosted: boolean }) {
  if (isBoosted) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">
      <Zap className="h-2.5 w-2.5" /> Boosted
    </span>
  );
  if (source === 'override') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
      Override
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">
      Global
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Global Config Editor
// ══════════════════════════════════════════════════════════════════════════════

export function GlobalConfigTab() {
  const [configs, setConfigs]   = useState<GlobalConfigRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [edits, setEdits]       = useState<Record<string, Partial<GlobalConfigRow>>>({});
  const [saving, setSaving]     = useState<Set<string>>(new Set());
  const [msg, setMsg]           = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/intelligence/scheduler-config');
      if (r.ok) {
        const d = await r.json();
        setConfigs(d.configs ?? []);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function setEdit(jobType: string, field: string, value: unknown) {
    setEdits(prev => ({
      ...prev,
      [jobType]: { ...(prev[jobType] ?? {}), [field]: value },
    }));
  }

  function getVal<K extends keyof GlobalConfigRow>(row: GlobalConfigRow, field: K): GlobalConfigRow[K] {
    return (edits[row.job_type]?.[field] as GlobalConfigRow[K]) ?? row[field];
  }

  async function save(row: GlobalConfigRow) {
    const patch = edits[row.job_type];
    if (!patch || Object.keys(patch).length === 0) return;
    setSaving(s => new Set(s).add(row.job_type));
    try {
      const r = await fetch('/api/admin/intelligence/scheduler-config', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ job_type: row.job_type, ...patch }),
      });
      if (r.ok) {
        setEdits(prev => { const n = { ...prev }; delete n[row.job_type]; return n; });
        setMsg({ type: 'ok', text: `${row.label} updated.` });
        load();
      } else {
        const d = await r.json();
        setMsg({ type: 'err', text: d.error ?? 'Update failed' });
      }
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(row.job_type); return n; });
    }
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

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — Company Override Manager
// ══════════════════════════════════════════════════════════════════════════════

export function CompanyOverridesTab() {
  const { companies }              = useCompanyContext();
  const [search, setSearch]        = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [jobs, setJobs]            = useState<ResolvedJob[]>([]);
  const [loading, setLoading]      = useState(false);
  const [expanded, setExpanded]    = useState<Set<string>>(new Set());
  const [editOverride, setEditOverride] = useState<Record<string, Partial<ResolvedJob['override']>>>({});
  const [saving, setSaving]        = useState<Set<string>>(new Set());
  const [deleting, setDeleting]    = useState<Set<string>>(new Set());
  const [msg, setMsg]              = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company_id.toLowerCase().includes(search.toLowerCase()),
  );

  async function loadOverrides(cid: string) {
    setSelectedId(cid);
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/intelligence/scheduler-overrides?company_id=${encodeURIComponent(cid)}`);
      if (r.ok) {
        const d = await r.json();
        setJobs(d.jobs ?? []);
      }
    } finally { setLoading(false); }
  }

  function toggleExpand(jt: string) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(jt) ? n.delete(jt) : n.add(jt);
      return n;
    });
  }

  function setField(jt: string, field: string, value: unknown) {
    setEditOverride(prev => ({
      ...prev,
      [jt]: { ...(prev[jt] ?? {}), [field]: value },
    }));
  }

  async function saveOverride(job: ResolvedJob) {
    const patch = editOverride[job.job_type];
    if (!patch) return;
    setSaving(s => new Set(s).add(job.job_type));
    try {
      const r = await fetch('/api/admin/intelligence/scheduler-overrides', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ company_id: selectedId, job_type: job.job_type, ...patch }),
      });
      if (r.ok) {
        setMsg({ type: 'ok', text: `Override saved for ${job.label}.` });
        setEditOverride(prev => { const n = { ...prev }; delete n[job.job_type]; return n; });
        loadOverrides(selectedId);
      } else {
        const d = await r.json();
        setMsg({ type: 'err', text: d.error ?? 'Save failed' });
      }
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(job.job_type); return n; });
    }
  }

  async function removeOverride(job: ResolvedJob) {
    if (!job.override) return;
    setDeleting(s => new Set(s).add(job.job_type));
    try {
      const r = await fetch('/api/admin/intelligence/scheduler-overrides', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ company_id: selectedId, job_type: job.job_type }),
      });
      if (r.ok) {
        setMsg({ type: 'ok', text: `Override removed — ${job.label} now uses global defaults.` });
        loadOverrides(selectedId);
      }
    } finally {
      setDeleting(s => { const n = new Set(s); n.delete(job.job_type); return n; });
    }
  }

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

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — Account Boost Manager
// ══════════════════════════════════════════════════════════════════════════════

