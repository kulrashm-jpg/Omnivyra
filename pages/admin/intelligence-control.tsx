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
import { useCompanyContext } from '../../components/CompanyContext';

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

type Tab = 'global' | 'overrides' | 'boost' | 'insights';

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
interface InsightsData {
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
function fmtDate(d: string | null | undefined) {
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

function GlobalConfigTab() {
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

function CompanyOverridesTab() {
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

function BoostTab() {
  const { companies }         = useCompanyContext();
  const [search, setSearch]   = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [duration, setDuration]     = useState(48);
  const [action, setAction]         = useState<'apply' | 'remove'>('apply');
  const [loading, setLoading]       = useState(false);
  const [msg, setMsg]               = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company_id.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedCompany = companies.find(c => c.company_id === selectedId);

  async function submit() {
    if (!selectedId) return;
    setLoading(true);
    try {
      const r = await fetch('/api/admin/intelligence/scheduler-boost', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ company_id: selectedId, action, duration_hours: duration }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg({
          type: 'ok',
          text: action === 'apply'
            ? `Boost applied for ${selectedCompany?.name}. All jobs will run at P1 priority for ${duration}h.`
            : `Boost removed for ${selectedCompany?.name}. Jobs return to normal priority.`,
        });
      } else {
        setMsg({ type: 'err', text: d.error ?? 'Operation failed' });
      }
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-6 max-w-lg">
      {msg && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {msg.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Explainer */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Zap className="h-4 w-4 text-violet-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-violet-800">New Account Boost</p>
            <p className="text-xs text-violet-700 mt-0.5 leading-relaxed">
              Applies P1 priority + 2× frequency to all intelligence jobs for a new company, ensuring they get results fast. Boost expires automatically after the set duration.
            </p>
          </div>
        </div>
      </div>

      {/* Company select */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Company</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={selectedCompany ? selectedCompany.name : search}
            onChange={e => { setSearch(e.target.value); setSelectedId(''); }}
            placeholder="Search companies…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        {search && !selectedId && (
          <div className="mt-1 border border-gray-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
            {filtered.slice(0, 8).map(c => (
              <button
                key={c.company_id}
                onClick={() => { setSearch(c.name); setSelectedId(c.company_id); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50"
              >
                <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                <div>
                  <p className="font-medium text-gray-800">{c.name}</p>
                  <p className="text-[10px] text-gray-400">{c.company_id}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Action</label>
        <div className="flex gap-2">
          {(['apply', 'remove'] as const).map(a => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                action === a
                  ? a === 'apply' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-red-400 bg-red-50 text-red-600'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {a === 'apply' ? '⚡ Apply Boost' : '✕ Remove Boost'}
            </button>
          ))}
        </div>
      </div>

      {/* Duration (apply only) */}
      {action === 'apply' && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            Duration
          </label>
          <div className="flex gap-2 flex-wrap">
            {[24, 48, 72, 168].map(h => (
              <button
                key={h}
                onClick={() => setDuration(h)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  duration === h
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-300'
                }`}
              >
                {h < 48 ? `${h}h` : h === 48 ? '2d' : h === 72 ? '3d' : '1 week'}
              </button>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={168}
                value={duration}
                onChange={e => setDuration(Math.min(168, Math.max(1, Number(e.target.value) || 48)))}
                className="w-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <span className="text-sm text-gray-500">h</span>
            </div>
          </div>
          {selectedId && (
            <p className="text-xs text-gray-500 mt-2">
              Boost will expire at: <strong>{new Date(Date.now() + duration * 3_600_000).toLocaleString()}</strong>
            </p>
          )}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={submit}
        disabled={!selectedId || loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
          : <><Zap className="h-4 w-4" /> {action === 'apply' ? `Apply ${duration}h Boost` : 'Remove Boost'}</>
        }
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — Execution Insights
// ══════════════════════════════════════════════════════════════════════════════

function InsightsTab() {
  const [days, setDays]         = useState(7);
  const [data, setData]         = useState<InsightsData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/intelligence/execution-insights?days=${d}`);
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? 'Load failed'); }
      setData(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  const SKIP_REASON_LABELS: Record<string, string> = {
    disabled:       'Disabled',
    budget_exceeded: 'Budget Exceeded',
    deferred:       'Deferred',
    job_type_not_found: 'Config Missing',
    unknown:        'Unknown',
  };

  function fmtDuration(ms: number | null) {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

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

// ══════════════════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════════════════

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'global',    label: 'Global Config',       icon: <Settings   className="h-4 w-4" /> },
  { id: 'overrides', label: 'Company Overrides',   icon: <Building2  className="h-4 w-4" /> },
  { id: 'boost',     label: 'Account Boost',       icon: <Zap        className="h-4 w-4" /> },
  { id: 'insights',  label: 'Execution Insights',  icon: <BarChart2  className="h-4 w-4" /> },
];

export default function IntelligenceControlPage() {
  const { userRole } = useCompanyContext();
  const [tab, setTab] = useState<Tab>('global');

  const isSuperAdmin = userRole === 'SUPER_ADMIN';

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Shield className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Super admin access required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <Activity className="h-5 w-5 text-indigo-600" />
              <h1 className="text-xl font-bold text-gray-900">Intelligence Orchestration</h1>
              <span className="text-[10px] font-bold text-white bg-indigo-600 px-2 py-0.5 rounded-full">SUPER ADMIN</span>
            </div>
            <p className="text-sm text-gray-500">
              Control execution priority, frequency, and per-company overrides for all intelligence jobs.
            </p>
          </div>
        </div>

        {/* Resolution rule callout */}
        <div className="bg-gray-900 rounded-xl px-5 py-4 flex items-start gap-4">
          <TrendingUp className="h-5 w-5 text-indigo-400 mt-0.5 shrink-0" />
          <div className="grid grid-cols-3 gap-6 text-xs w-full">
            <div>
              <p className="text-white font-bold mb-0.5">Resolution Order</p>
              <p className="text-gray-400">Boost &gt; Company Override &gt; Global Default</p>
            </div>
            <div>
              <p className="text-white font-bold mb-0.5">Priority Scale</p>
              <p className="text-gray-400">1 = highest urgency · 10 = lowest urgency</p>
            </div>
            <div>
              <p className="text-white font-bold mb-0.5">Override Rules</p>
              <p className="text-gray-400">Only non-null override fields are applied</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          {tab === 'global'    && <GlobalConfigTab />}
          {tab === 'overrides' && <CompanyOverridesTab />}
          {tab === 'boost'     && <BoostTab />}
          {tab === 'insights'  && <InsightsTab />}
        </div>

      </div>
    </div>
  );
}
