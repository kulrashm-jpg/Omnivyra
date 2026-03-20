/**
 * All-orgs consumption overview — super admin only.
 * Shows per-organization LLM + API cost and credit balance.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../utils/supabaseClient';
import { RefreshCw, AlertCircle, Building2, ChevronDown, ChevronUp } from 'lucide-react';

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

interface Props {
  year?: number;
  month?: number;
  onSelectOrg?: (orgId: string) => void;
}

type SortKey = 'org_name' | 'llm_calls' | 'llm_cost_usd' | 'api_calls' | 'total_cost_usd' | 'credit_balance';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
const fmt = (n: number) => n.toLocaleString();

export default function AllOrgsConsumptionTable({ year, month, onSelectOrg }: Props) {
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total_cost_usd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (year) params.set('year', String(year));
    if (month) params.set('month', String(month));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`/api/admin/consumption/llm?${params}`, {
        credentials: 'include',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!resp.ok) throw new Error((await resp.json()).error ?? 'Failed');
      const json = await resp.json();
      setRows(Array.isArray(json.data) ? json.data : []);
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

  const visible = rows
    .filter(r => !search || (r.org_name ?? r.organization_id).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      const av2 = typeof av === 'string' ? av.toLowerCase() : av;
      const bv2 = typeof bv === 'string' ? bv.toLowerCase() : bv;
      if (av2 < bv2) return sortDir === 'asc' ? -1 : 1;
      if (av2 > bv2) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const totalCost = rows.reduce((s, r) => s + r.total_cost_usd, 0);
  const periodLabel = month ? `${MONTH_NAMES[month - 1]} ${year ?? ''}` : 'Current Month';

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

  return (
    <div className="space-y-4">
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
      <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-6 text-sm">
        <span className="text-gray-400">Platform Total:</span>
        <span className="text-white font-bold">{fmtUsd(totalCost)} USD</span>
        <span className="text-gray-400">across {rows.length} organizations</span>
      </div>

      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-700">
                {([
                  ['org_name', 'Organization'],
                  ['llm_calls', 'LLM Calls'],
                  ['llm_cost_usd', 'LLM Cost'],
                  ['api_calls', 'API Calls'],
                  ['api_cost_usd', 'API Cost'],
                  ['total_cost_usd', 'Total Cost'],
                  ['credit_balance', 'Credits Left'],
                ] as [SortKey, string][]).map(([k, label]) => (
                  <th key={k} className="px-4 py-2 font-medium cursor-pointer hover:text-white select-none" onClick={() => toggleSort(k)}>
                    {label} <SortIcon k={k} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No data found.</td></tr>
              ) : visible.map((r) => (
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
                  <td className={`px-4 py-2 text-right ${r.credit_balance != null && r.credit_balance < 100 ? 'text-red-400' : 'text-yellow-400'}`}>
                    {r.credit_balance != null ? r.credit_balance.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
