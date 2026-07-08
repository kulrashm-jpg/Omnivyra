/** Part 2/2 of IntelControlView.tsx — verbatim split (barrel preserved; importers unchanged). */
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

import { type Tab, type InsightsData, fmtDate, GlobalConfigTab, CompanyOverridesTab } from './IntelControlViewPanels';

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

import type { useIntelControl } from '../hooks/useIntelControl';
type S = ReturnType<typeof useIntelControl>;
export default function IntelControlView({ d }: { d: S }) {
  const {
    _ef1,
    isSuperAdmin,
    setTab,
    tab,
    userRole,
  } = d;

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


