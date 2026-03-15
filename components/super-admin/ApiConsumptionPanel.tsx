import React, { useEffect, useState, useCallback } from 'react';
import { Zap, AlertCircle, RefreshCw } from 'lucide-react';

interface ApiSourceRow {
  source_name: string;
  source_type: string;
  call_count: number;
  error_count: number;
  avg_latency_ms: number | null;
  total_cost_usd?: number | null;
}

interface ApiData {
  organization_id: string;
  period: { year: number; month: number };
  totals: { call_count: number; error_count: number; total_cost_usd?: number | null };
  by_source: ApiSourceRow[];
}

interface Props {
  tier: 'super_admin' | 'company_admin' | 'user';
  companyId?: string;
  year?: number;
  month?: number;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt = (n: number) => n.toLocaleString();
const fmtUsd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(4)}`);
const errorRate = (calls: number, errors: number) =>
  calls === 0 ? '—' : `${((errors / calls) * 100).toFixed(1)}%`;

export default function ApiConsumptionPanel({ tier, companyId, year, month }: Props) {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (year) params.set('year', String(year));
    if (month) params.set('month', String(month));
    try {
      const resp = await fetch(`/api/admin/consumption/apis?${params}`);
      if (!resp.ok) throw new Error((await resp.json()).error ?? 'Failed');
      const json = await resp.json();
      setData(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, year, month]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading API consumption…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 py-8">
      <AlertCircle className="w-5 h-5" /> {error}
    </div>
  );

  if (!data) return null;

  const periodLabel = `${MONTH_NAMES[(data.period.month ?? 1) - 1]} ${data.period.year}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-semibold text-white">External API Consumption — {periodLabel}</h2>
        </div>
        <button onClick={load} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Total API Calls</p>
          <p className="text-xl font-bold text-white">{fmt(data.totals.call_count)}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Errors</p>
          <p className={`text-xl font-bold ${data.totals.error_count > 0 ? 'text-red-400' : 'text-white'}`}>
            {fmt(data.totals.error_count)}
          </p>
        </div>
        {tier !== 'user' && data.totals.total_cost_usd != null && (
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-1">Total Cost (USD)</p>
            <p className="text-xl font-bold text-emerald-400">{fmtUsd(data.totals.total_cost_usd)}</p>
          </div>
        )}
      </div>

      {/* By Source */}
      {data.by_source.length > 0 ? (
        <div className="bg-gray-800/60 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <span className="text-sm font-medium text-gray-200">By API Source</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-700">
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium text-right">Calls</th>
                  <th className="px-4 py-2 font-medium text-right">Errors</th>
                  <th className="px-4 py-2 font-medium text-right">Error Rate</th>
                  <th className="px-4 py-2 font-medium text-right">Avg Latency</th>
                  {tier !== 'user' && <th className="px-4 py-2 font-medium text-right">Cost (USD)</th>}
                </tr>
              </thead>
              <tbody>
                {data.by_source.map((s) => (
                  <tr key={s.source_name} className="border-b border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-2 text-white font-mono text-xs">{s.source_name}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{fmt(s.call_count)}</td>
                    <td className={`px-4 py-2 text-right ${s.error_count > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                      {s.error_count}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400">{errorRate(s.call_count, s.error_count)}</td>
                    <td className="px-4 py-2 text-right text-gray-400">
                      {s.avg_latency_ms != null ? `${s.avg_latency_ms}ms` : '—'}
                    </td>
                    {tier !== 'user' && (
                      <td className="px-4 py-2 text-right text-emerald-400">{fmtUsd(s.total_cost_usd)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 text-sm text-center py-8">No external API calls recorded for this period.</p>
      )}
    </div>
  );
}
