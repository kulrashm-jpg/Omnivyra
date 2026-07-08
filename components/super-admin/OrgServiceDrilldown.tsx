/**
 * OrgServiceDrilldown — slide-over panel
 *
 * Per-service view with:
 * - Service-specific columns (LLM calls+tokens, API errors, Redis ops, Supabase
 *   queries, Vercel invocations, Firebase MAU — not generic LLM/API for all)
 * - Plan analysis: current spend vs plan limit, month-end prediction, 15% headroom
 * - Spike detection: opsPerMin vs baseline, WARNING/CRITICAL with remediation tips
 * - Built-in month/year selector + expandable org rows
 *
 * Module layout (Agent-B large-file modularization — behavior-preserving):
 *   orgServiceDrilldownModel.ts    — types, plan/spike/metric defs, formatters
 *   OrgServiceDrilldownPanels.tsx  — PlanAnalysisPanel + SpikePanel
 * Public types are re-exported below, so importers keep using this path.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  X, RefreshCw, ChevronDown, ChevronUp, AlertCircle, Calendar,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import {
  type ServiceKey,
  type DrilldownIntel,
  type Props,
  type OrgRow,
  type BreakdownData,
  type SortKey,
  MONTH_NAMES,
  PLATFORM_COLORS,
  PLATFORM_TEXT,
  SERVICE_COLOR,
  PLAN_DEFS,
  METRIC_COLS,
  fmtUsd,
  fmtUsd2,
  fmtK,
  fmtPct,
} from './orgServiceDrilldownModel';
import { PlanAnalysisPanel, SpikePanel } from './OrgServiceDrilldownPanels';

export type { ServiceKey, DrilldownIntel } from './orgServiceDrilldownModel';

// ── Component ─────────────────────────────────────────────────────────────────

export default function OrgServiceDrilldown({
  serviceKey, serviceLabel, serviceCostUsd, initialYear, initialMonth, intel, onClose,
}: Props) {
  const [year,    setYear]    = useState(initialYear);
  const [month,   setMonth]   = useState(initialMonth);
  const [data,    setData]    = useState<BreakdownData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('service_cost');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search,  setSearch]  = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const isDirectMode = serviceKey === 'llm' || serviceKey === 'api';
  const svcColor     = SERVICE_COLOR[serviceKey];
  const plan         = PLAN_DEFS[serviceKey];
  const metricCol    = METRIC_COLS[serviceKey];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params  = new URLSearchParams({ year: String(year), month: String(month) });
      const resp    = await apiFetch(`/api/admin/consumption/org-activity-breakdown?${params}`);
      if (!resp.ok) throw new Error((await resp.json()).error ?? 'Failed');
      setData(await resp.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Per-org computed fields ───────────────────────────────────────────────
  const totalAllCost = data?.totals.total_cost_usd ?? 0;

  const getWeight      = (row: OrgRow) => totalAllCost > 0 ? row.total_cost_usd / totalAllCost : 0;
  const getServiceCost = (row: OrgRow) => {
    if (serviceKey === 'llm') return row.llm_cost_usd;
    if (serviceKey === 'api') return row.api_cost_usd;
    return totalAllCost > 0 && serviceCostUsd > 0
      ? serviceCostUsd * (row.total_cost_usd / totalAllCost)
      : 0;
  };
  const getMetricValue = (row: OrgRow): number | null => {
    if (!metricCol) return null;
    return metricCol.getValue(getWeight(row), intel);
  };

  // ── Sort + filter ─────────────────────────────────────────────────────────
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const rows = (data?.orgs ?? [])
    .filter(r => !search || (r.org_name ?? r.organization_id).toLowerCase().includes(search.toLowerCase()))
    .map(r => ({
      ...r,
      _serviceCost:  getServiceCost(r),
      _metricValue:  getMetricValue(r),
      _weightPct:    getWeight(r) * 100,
    }))
    .sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      switch (sortKey) {
        case 'org_name':    av = (a.org_name ?? a.organization_id).toLowerCase(); bv = (b.org_name ?? b.organization_id).toLowerCase(); break;
        case 'service_cost': av = a._serviceCost;  bv = b._serviceCost;  break;
        case 'metric_value': av = a._metricValue ?? -1; bv = b._metricValue ?? -1; break;
        case 'weight_pct':  av = a._weightPct;    bv = b._weightPct;    break;
        case 'llm_calls':   av = a.llm_calls;     bv = b.llm_calls;     break;
        case 'llm_cost':    av = a.llm_cost_usd;  bv = b.llm_cost_usd;  break;
        case 'api_calls':   av = a.api_calls;     bv = b.api_calls;     break;
        case 'api_cost':    av = a.api_cost_usd;  bv = b.api_cost_usd;  break;
        case 'posts':       av = a.activities.posts_total; bv = b.activities.posts_total; break;
        case 'credits':     av = a.credit_balance ?? -1; bv = b.credit_balance ?? -1; break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });

  const totalServiceCost = rows.reduce((s, r) => s + r._serviceCost, 0);
  const maxSvcCost       = Math.max(1, ...rows.map(r => r._serviceCost));
  const yearOptions      = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

  // ── Column definitions for the table header ───────────────────────────────
  // LLM mode: Org | LLM Calls | LLM Cost | Posts | Credits
  // API mode: Org | API Calls | Errors | API Cost | Posts | Credits
  // Infra:    Org | Alloc. $ | [Metric] | Weight % | Posts | Credits

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-5xl bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">{serviceLabel}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isDirectMode
                ? `Per-organisation ${serviceKey.toUpperCase()} spend`
                : `Proportional allocation · ${fmtUsd2(serviceCostUsd)}/mo estimated total`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Period selector + search */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800 shrink-0 flex-wrap">
          <Calendar className="w-4 h-4 text-gray-500 shrink-0" />
          <select value={month} onChange={e => setMonth(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search org…"
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-1.5 placeholder-gray-600 focus:outline-none focus:border-violet-500 w-44" />
          <button onClick={load} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors ml-auto">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Plan analysis ── */}
          <PlanAnalysisPanel
            serviceKey={serviceKey}
            serviceCostUsd={serviceCostUsd}
            intel={intel}
            year={year}
            month={month}
            totals={data?.totals}
          />

          {/* ── Spike alert ── */}
          <SpikePanel serviceKey={serviceKey} intel={intel} planDef={plan} />

          {/* ── Summary strip ── */}
          {data && (
            <div className="flex items-center gap-4 px-6 py-2 bg-gray-900/40 border-b border-gray-800 text-xs mt-3 flex-wrap">
              <span className="text-gray-500">{data.totals.org_count} orgs</span>
              <span className="text-gray-700">·</span>
              {isDirectMode ? (
                <span className="text-gray-400">
                  {serviceKey === 'llm' ? 'Total LLM' : 'Total API'}: <span className="text-white font-medium">
                    {fmtUsd2(serviceKey === 'llm' ? data.totals.llm_cost_usd : data.totals.api_cost_usd)}
                  </span>
                </span>
              ) : (
                <span className="text-gray-400">
                  Allocated {serviceLabel}: <span className={`font-medium ${svcColor}`}>{fmtUsd2(totalServiceCost)}</span>
                  {' '}<span className="text-gray-600">(est. {fmtUsd2(serviceCostUsd)})</span>
                </span>
              )}
              <span className="text-gray-700">·</span>
              <span className="text-gray-400">Posts: <span className="text-white font-medium">{data.totals.posts_total.toLocaleString()}</span></span>
            </div>
          )}

          {/* ── Table ── */}
          {loading && !data ? (
            <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 p-6 text-sm">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-600 text-sm">
              No data for {MONTH_NAMES[month - 1]} {year}.
            </div>
          ) : (
            <div className="px-4 py-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <Th k="org_name" label="Organisation" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />

                    {/* ── LLM mode ── */}
                    {serviceKey === 'llm' && <>
                      <Th k="llm_calls" label="LLM Calls" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="service_cost" label="LLM Cost" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right highlight />
                      <Th k="posts" label="Posts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="credits" label="Credits" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                    </>}

                    {/* ── API mode ── */}
                    {serviceKey === 'api' && <>
                      <Th k="api_calls" label="API Calls" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="service_cost" label="API Cost" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right highlight />
                      <Th k="posts" label="Posts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="credits" label="Credits" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                    </>}

                    {/* ── Infra mode ── */}
                    {!isDirectMode && <>
                      <Th k="service_cost" label={`${serviceLabel.split(' ')[0]} Cost`} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right highlight />
                      {metricCol && <Th k="metric_value" label={metricCol.header} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />}
                      <Th k="weight_pct" label="Weight %" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      <Th k="posts" label="Posts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const isExpanded = expanded === r.organization_id;
                    const barPct     = (r._serviceCost / maxSvcCost) * 100;

                    return (
                      <React.Fragment key={r.organization_id}>
                        <tr
                          className="border-b border-gray-800/60 hover:bg-gray-900/60 cursor-pointer"
                          onClick={() => setExpanded(isExpanded ? null : r.organization_id)}
                        >
                          {/* Org name */}
                          <td className="px-3 py-2.5 text-white font-medium">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600 text-xs">{isExpanded ? '▼' : '▶'}</span>
                              {r.org_name ?? <span className="font-mono text-xs text-gray-500">{r.organization_id.slice(0, 8)}…</span>}
                            </div>
                          </td>

                          {/* ── LLM columns ── */}
                          {serviceKey === 'llm' && <>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{fmtK(r.llm_calls)}</td>
                            <td className="px-3 py-2.5 text-right min-w-[110px]">
                              <span className={`font-bold text-xs ${svcColor}`}>{fmtUsd(r.llm_cost_usd)}</span>
                              <div className="w-full bg-gray-800 rounded-full h-1 mt-1">
                                <div className={`h-1 rounded-full ${svcColor.replace('text-', 'bg-')}`} style={{ width: `${Math.max(2, barPct)}%` }} />
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{r.activities.posts_total}</td>
                            <td className={`px-3 py-2.5 text-right text-xs ${r.credit_balance != null && r.credit_balance < 100 ? 'text-red-400' : 'text-yellow-400'}`}>
                              {r.credit_balance != null ? r.credit_balance.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                            </td>
                          </>}

                          {/* ── API columns ── */}
                          {serviceKey === 'api' && <>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{fmtK(r.api_calls)}</td>
                            <td className="px-3 py-2.5 text-right min-w-[110px]">
                              <span className={`font-bold text-xs ${svcColor}`}>{fmtUsd(r.api_cost_usd)}</span>
                              <div className="w-full bg-gray-800 rounded-full h-1 mt-1">
                                <div className={`h-1 rounded-full ${svcColor.replace('text-', 'bg-')}`} style={{ width: `${Math.max(2, barPct)}%` }} />
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{r.activities.posts_total}</td>
                            <td className={`px-3 py-2.5 text-right text-xs ${r.credit_balance != null && r.credit_balance < 100 ? 'text-red-400' : 'text-yellow-400'}`}>
                              {r.credit_balance != null ? r.credit_balance.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                            </td>
                          </>}

                          {/* ── Infra columns ── */}
                          {!isDirectMode && <>
                            <td className="px-3 py-2.5 text-right min-w-[110px]">
                              <span className={`font-bold text-xs ${svcColor}`}>{fmtUsd(r._serviceCost)}</span>
                              <div className="w-full bg-gray-800 rounded-full h-1 mt-1">
                                <div className={`h-1 rounded-full ${svcColor.replace('text-', 'bg-')}`} style={{ width: `${Math.max(2, barPct)}%` }} />
                              </div>
                            </td>
                            {metricCol && (
                              <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                                {r._metricValue != null ? metricCol.format(r._metricValue) : '—'}
                              </td>
                            )}
                            <td className="px-3 py-2.5 text-right text-gray-500 text-xs">{fmtPct(r._weightPct)}</td>
                            <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{r.activities.posts_total}</td>
                          </>}
                        </tr>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <tr className="bg-gray-900/70 border-b border-gray-800">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">

                                {/* Posts by platform */}
                                <div>
                                  <p className="text-gray-500 font-medium mb-2 uppercase tracking-wide text-[10px]">Posts by Platform</p>
                                  {Object.keys(r.activities.posts_by_platform).length === 0 ? (
                                    <p className="text-gray-600">No posts this period</p>
                                  ) : (
                                    <div className="space-y-1.5">
                                      {Object.entries(r.activities.posts_by_platform)
                                        .sort(([, a], [, b]) => b - a)
                                        .map(([plat, count]) => {
                                          const total = r.activities.posts_total || 1;
                                          return (
                                            <div key={plat}>
                                              <div className="flex justify-between mb-0.5">
                                                <span className={`capitalize ${PLATFORM_TEXT[plat] ?? 'text-gray-400'}`}>{plat}</span>
                                                <span className="text-gray-300">{count}</span>
                                              </div>
                                              <div className="w-full bg-gray-800 rounded-full h-1.5">
                                                <div className={`${PLATFORM_COLORS[plat] ?? 'bg-gray-500'} h-1.5 rounded-full`} style={{ width: `${(count / total) * 100}%` }} />
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  )}
                                </div>

                                {/* Campaign activity */}
                                <div>
                                  <p className="text-gray-500 font-medium mb-2 uppercase tracking-wide text-[10px]">Campaign Activity</p>
                                  <div className="space-y-1.5">
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Total campaigns</span>
                                      <span className="text-white">{r.activities.campaigns_total}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Active campaigns</span>
                                      <span className="text-green-400">{r.activities.campaigns_active}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-400">Posts published</span>
                                      <span className="text-emerald-400">{r.activities.posts_published}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Service-specific cost detail */}
                                <div>
                                  <p className="text-gray-500 font-medium mb-2 uppercase tracking-wide text-[10px]">Cost Detail</p>
                                  <div className="space-y-1.5">

                                    {/* LLM details */}
                                    {serviceKey === 'llm' && <>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">LLM calls</span>
                                        <span className="text-gray-300">{r.llm_calls.toLocaleString()}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">LLM cost</span>
                                        <span className={`font-bold ${svcColor}`}>{fmtUsd(r.llm_cost_usd)}</span>
                                      </div>
                                      {r.llm_calls > 0 && (
                                        <div className="flex justify-between text-gray-600">
                                          <span>Cost per call</span>
                                          <span>{fmtUsd(r.llm_cost_usd / r.llm_calls)}</span>
                                        </div>
                                      )}
                                    </>}

                                    {/* API details */}
                                    {serviceKey === 'api' && <>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">API calls</span>
                                        <span className="text-gray-300">{r.api_calls.toLocaleString()}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-400">API cost</span>
                                        <span className={`font-bold ${svcColor}`}>{fmtUsd(r.api_cost_usd)}</span>
                                      </div>
                                      {r.api_calls > 0 && (
                                        <div className="flex justify-between text-gray-600">
                                          <span>Cost per call</span>
                                          <span>{fmtUsd(r.api_cost_usd / r.api_calls)}</span>
                                        </div>
                                      )}
                                    </>}

                                    {/* Infra details */}
                                    {!isDirectMode && <>
                                      <div className="flex justify-between">
                                        <span className={svcColor}>{serviceLabel} share</span>
                                        <span className={`font-bold ${svcColor}`}>{fmtUsd(r._serviceCost)}</span>
                                      </div>
                                      {metricCol && r._metricValue != null && (
                                        <div className="flex justify-between">
                                          <span className="text-gray-400">{metricCol.header}</span>
                                          <span className="text-gray-300">{metricCol.format(r._metricValue)}</span>
                                        </div>
                                      )}
                                      <div className="flex justify-between border-t border-gray-800 pt-1.5 mt-1.5">
                                        <span className="text-gray-400">Allocation weight</span>
                                        <span className="text-gray-300">{fmtPct(r._weightPct)}</span>
                                      </div>
                                      <div className="flex justify-between text-gray-600">
                                        <span>Based on LLM+API</span>
                                        <span>{fmtUsd(r.total_cost_usd)}</span>
                                      </div>
                                    </>}
                                  </div>
                                </div>

                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-800 text-xs text-gray-600 shrink-0">
          {isDirectMode
            ? `Exact ${serviceKey.toUpperCase()} cost per org · ${MONTH_NAMES[month - 1]} ${year}`
            : `Infra allocated proportionally by org LLM+API spend · ${MONTH_NAMES[month - 1]} ${year} · [est]`}
          {' · '}15% capacity margin applied to plan thresholds
        </div>

      </div>
    </>
  );
}

// ── Table header helper ────────────────────────────────────────────────────────

function Th({ k, label, sortKey, sortDir, onSort, right, highlight }: {
  k: SortKey; label: string; sortKey: SortKey; sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void; right?: boolean; highlight?: boolean;
}) {
  const active = sortKey === k;
  return (
    <th
      className={`px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap hover:text-white transition-colors
        ${right ? 'text-right' : 'text-left'}
        ${highlight ? 'text-violet-400' : active ? 'text-white' : 'text-gray-500'}`}
      onClick={() => onSort(k)}
    >
      {label}
      {active && (sortDir === 'desc'
        ? <ChevronDown className="w-3 h-3 inline ml-0.5" />
        : <ChevronUp   className="w-3 h-3 inline ml-0.5" />)}
    </th>
  );
}
