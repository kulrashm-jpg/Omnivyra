/**
 * All-orgs consumption overview — super admin only.
 * Shows per-organization LLM + API cost and credit balance.
 *
 * Infra cost is allocated proportionally by each org's total LLM+API spend
 * (not evenly per org). A pinned "Platform / System" row shows platform-level
 * costs (usage_events with no organization_id).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { getAuthToken } from '../../utils/getAuthToken';
import { RefreshCw, AlertCircle, Building2, ChevronDown, ChevronUp, Settings } from 'lucide-react';

interface OrgRow {
  organization_id: string;
  org_name?: string | null;
  llm_calls: number;
  llm_tokens: number;
  llm_cost_usd: number;
  api_calls: number;
  api_cost_usd: number;
  total_cost_usd: number;
  credit_balance?: number | null;
}

interface SystemCosts {
  llm_calls: number;
  llm_tokens: number;
  llm_cost_usd: number;
  api_calls: number;
  api_cost_usd: number;
  total_cost_usd: number;
}

interface Props {
  year?: number;
  month?: number;
  onSelectOrg?: (orgId: string) => void;
  /** Combined infra total (manual + system-detected) from InfraConsumptionPanel */
  infraTotalUsd?: number;
}

type SortKey = 'org_name' | 'llm_calls' | 'llm_cost_usd' | 'api_calls' | 'total_cost_usd' | 'infra_share_usd' | 'total_with_infra_usd' | 'credit_balance';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
const fmt    = (n: number) => n.toLocaleString();

const PLATFORM_COLORS: Record<string, string> = {
  linkedin:  'text-blue-400',
  twitter:   'text-sky-400',
  instagram: 'text-pink-400',
  facebook:  'text-indigo-400',
  youtube:   'text-red-400',
};

export default function AllOrgsConsumptionTable({ year, month, onSelectOrg, infraTotalUsd = 0 }: Props) {
  const [rows,        setRows]        = useState<OrgRow[]>([]);
  const [systemCosts, setSystemCosts] = useState<SystemCosts | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [sortKey,     setSortKey]     = useState<SortKey>('total_cost_usd');
  const [sortDir,     setSortDir]     = useState<'asc' | 'desc'>('desc');
  const [search,      setSearch]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (year)  params.set('year',  String(year));
    if (month) params.set('month', String(month));
    try {
      const token = await getAuthToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      // Fetch org rows and system costs in parallel
      const [orgResp, sysResp] = await Promise.all([
        fetch(`/api/admin/consumption/llm?${params}`,               { credentials: 'include', headers }),
        fetch(`/api/admin/consumption/activity-breakdown?${params}`, { credentials: 'include', headers }),
      ]);

      if (!orgResp.ok) throw new Error((await orgResp.json()).error ?? 'Failed to load org data');
      const orgJson = await orgResp.json();
      setRows(Array.isArray(orgJson.data) ? orgJson.data : []);

      if (sysResp.ok) {
        const sysJson = await sysResp.json();
        setSystemCosts(sysJson.system_costs ?? null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortDir === 'desc' ? <ChevronDown className="w-3 h-3 inline ml-0.5" /> : <ChevronUp className="w-3 h-3 inline ml-0.5" />) : null;

  // ── Cost allocation ─────────────────────────────────────────────────────────
  // Infra is distributed proportionally by each org/system's total LLM+API spend.
  // This means high-usage orgs absorb more infra cost than idle ones.
  const totalOrgCost    = rows.reduce((s, r) => s + r.total_cost_usd, 0);
  const systemTotal     = systemCosts?.total_cost_usd ?? 0;
  const totalAllCost    = totalOrgCost + systemTotal;   // denominator for proportional split

  const infraShare = (cost: number): number =>
    infraTotalUsd > 0 && totalAllCost > 0 ? infraTotalUsd * (cost / totalAllCost) : 0;

  const systemInfraShare = infraShare(systemTotal);

  // ── Filtered + sorted org rows ───────────────────────────────────────────────
  const visible = rows
    .filter(r => !search || (r.org_name ?? r.organization_id).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      const av2 = typeof av === 'string' ? av.toLowerCase() : av;
      const bv2 = typeof bv === 'string' ? bv.toLowerCase() : bv;
      if (av2 < bv2) return sortDir === 'asc' ? -1 : 1;
      if (av2 > bv2) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });

  const periodLabel = month ? `${MONTH_NAMES[month - 1]} ${year ?? ''}` : 'Current Month';
  const grandTotal  = totalOrgCost + infraTotalUsd + systemTotal;

  // Whether to show the System row (always show if we have infra or system activity)
  const showSystemRow = infraTotalUsd > 0 || systemTotal > 0;

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading all-org data…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 py-8">
      <AlertCircle className="w-5 h-5" /> {error}
    </div>
  );

  const colCount = infraTotalUsd > 0 ? 9 : 7;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-white">All Organizations — {periodLabel}</h2>
          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">{rows.length} orgs</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search org…"
            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-44"
          />
          <button onClick={load} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Grand total strip */}
      <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="text-gray-400">LLM + API:</span>
        <span className="text-white font-bold">{fmtUsd(totalOrgCost)}</span>
        {systemTotal > 0 && (
          <>
            <span className="text-gray-600">+</span>
            <span className="text-gray-400">System:</span>
            <span className="text-orange-400 font-bold">{fmtUsd(systemTotal)}</span>
          </>
        )}
        {infraTotalUsd > 0 && (
          <>
            <span className="text-gray-600">+</span>
            <span className="text-gray-400">Infra:</span>
            <span className="text-sky-400 font-bold">{fmtUsd(infraTotalUsd)}</span>
            <span className="text-gray-600">=</span>
            <span className="text-gray-400">Grand Total:</span>
            <span className="text-violet-300 font-bold">{fmtUsd(grandTotal)}</span>
            <span className="text-gray-500 text-xs ml-auto">
              Infra split proportionally by org spend · {rows.length} orgs
            </span>
          </>
        )}
        {infraTotalUsd === 0 && (
          <span className="text-gray-400">across {rows.length} organizations</span>
        )}
      </div>

      {/* Infra allocation note */}
      {infraTotalUsd > 0 && (
        <p className="text-xs text-gray-500">
          Infrastructure cost is allocated proportionally: high-spend orgs absorb more infra than idle ones.
          {systemTotal > 0 && ' Platform-level (system) activity takes its proportional share first.'}
        </p>
      )}

      {/* Table */}
      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-700">
                {([
                  ['org_name',              'Organization'],
                  ['llm_calls',             'LLM Calls'],
                  ['llm_cost_usd',          'LLM Cost'],
                  ['api_calls',             'API Calls'],
                  ['api_cost_usd',          'API Cost'],
                  ['total_cost_usd',        'LLM+API Total'],
                  ...(infraTotalUsd > 0 ? [
                    ['infra_share_usd',      'Infra Share'],
                    ['total_with_infra_usd', 'Total incl. Infra'],
                  ] : []),
                  ['credit_balance',        'Credits Left'],
                ] as [SortKey, string][]).map(([k, label]) => (
                  <th key={k} className="px-4 py-2 font-medium cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort(k)}>
                    {label} <SortIcon k={k} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* ── Pinned System row ── */}
              {showSystemRow && (
                <tr className="border-b border-gray-700 bg-gray-900/80">
                  <td className="px-4 py-2 text-gray-300 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Settings className="w-3.5 h-3.5 text-gray-500" />
                      <span>Platform / System</span>
                      <span className="text-xs text-gray-600 font-normal ml-1">overhead</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">{fmt(systemCosts?.llm_calls ?? 0)}</td>
                  <td className="px-4 py-2 text-right text-orange-400">{fmtUsd(systemCosts?.llm_cost_usd ?? 0)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{fmt(systemCosts?.api_calls ?? 0)}</td>
                  <td className="px-4 py-2 text-right text-orange-400">{fmtUsd(systemCosts?.api_cost_usd ?? 0)}</td>
                  <td className="px-4 py-2 text-right font-bold text-orange-300">{fmtUsd(systemTotal)}</td>
                  {infraTotalUsd > 0 && (
                    <>
                      <td className="px-4 py-2 text-right text-sky-400">{fmtUsd(systemInfraShare)}</td>
                      <td className="px-4 py-2 text-right font-bold text-violet-300">{fmtUsd(systemTotal + systemInfraShare)}</td>
                    </>
                  )}
                  <td className="px-4 py-2 text-right text-gray-600">—</td>
                </tr>
              )}

              {/* ── Org rows ── */}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-gray-500">No data found.</td>
                </tr>
              ) : visible.map((r) => {
                const orgInfraShare   = infraShare(r.total_cost_usd);
                const totalWithInfra  = r.total_cost_usd + orgInfraShare;
                return (
                  <tr
                    key={r.organization_id}
                    className="border-b border-gray-800 hover:bg-gray-700/40 cursor-pointer"
                    onClick={() => onSelectOrg?.(r.organization_id)}
                  >
                    <td className="px-4 py-2 text-white font-medium">
                      {r.org_name ?? <span className="text-gray-500 font-mono text-xs">{r.organization_id.slice(0, 8)}…</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-300">{fmt(r.llm_calls)}</td>
                    <td className="px-4 py-2 text-right text-emerald-400">{fmtUsd(r.llm_cost_usd)}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{fmt(r.api_calls)}</td>
                    <td className="px-4 py-2 text-right text-amber-400">{fmtUsd(r.api_cost_usd)}</td>
                    <td className="px-4 py-2 text-right font-bold text-white">{fmtUsd(r.total_cost_usd)}</td>
                    {infraTotalUsd > 0 && (
                      <>
                        <td className="px-4 py-2 text-right text-sky-400">{fmtUsd(orgInfraShare)}</td>
                        <td className="px-4 py-2 text-right font-bold text-violet-300">{fmtUsd(totalWithInfra)}</td>
                      </>
                    )}
                    <td className={`px-4 py-2 text-right ${r.credit_balance != null && r.credit_balance < 100 ? 'text-red-400' : 'text-yellow-400'}`}>
                      {r.credit_balance != null ? r.credit_balance.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend for infra allocation */}
      {infraTotalUsd > 0 && totalAllCost > 0 && (
        <div className="text-xs text-gray-600 space-y-0.5">
          <p>
            Infra share formula: <span className="font-mono text-gray-500">org_infra = ${infraTotalUsd.toFixed(4)} × (org_spend / ${totalAllCost.toFixed(4)} total)</span>
          </p>
          {systemTotal > 0 && (
            <p>System overhead absorbs <span className="text-orange-400">{((systemTotal / totalAllCost) * 100).toFixed(1)}%</span> of infra.</p>
          )}
        </div>
      )}
    </div>
  );
}
