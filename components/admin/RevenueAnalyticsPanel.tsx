/**
 * Revenue Analytics Panel — Step 10
 *
 * Super-admin view of credit economics:
 *   - Total credits consumed vs purchased
 *   - USD revenue, LLM cost, gross margin
 *   - Per-org breakdown table
 *   - 3-month trend
 */

import React, { useState, useEffect, useCallback } from 'react';
import { DollarSign, TrendingUp, TrendingDown, RefreshCw, BarChart3, ChevronDown, ChevronRight } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type TrendPoint = { year: number; month: number; total_consumed: number; total_revenue: number };

type OrgRow = {
  organization_id: string;
  credits_consumed: number;
  credits_purchased: number;
  usd_revenue: number;
  estimated_llm_cost_usd: number;
  gross_margin_usd: number;
  top_action_type: string | null;
};

type Analytics = {
  period: { year: number; month: number };
  total_credits_consumed: number;
  total_credits_purchased: number;
  total_usd_revenue: number;
  total_estimated_llm_cost: number;
  total_gross_margin: number;
  orgs_count: number;
  rows: OrgRow[];
  trend: TrendPoint[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmt(n: number, prefix = '') {
  return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function marginColor(margin: number) {
  if (margin > 0) return 'text-emerald-400';
  if (margin < 0) return 'text-red-400';
  return 'text-slate-400';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RevenueAnalyticsPanel() {
  const [data, setData]         = useState<Analytics | null>(null);
  const [loading, setLoading]   = useState(true);
  const [showOrgs, setShowOrgs] = useState(false);
  const [period, setPeriod]     = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/revenue-analytics?year=${period.year}&month=${period.month}`);
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error('[RevenueAnalytics] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const trendMax = Math.max(...(data?.trend.map(t => t.total_consumed) ?? [1]));

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-violet-400" />
          <h2 className="text-lg font-semibold text-white">Revenue Analytics</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Month picker */}
          <select
            value={`${period.year}-${period.month}`}
            onChange={e => {
              const [y, m] = e.target.value.split('-').map(Number);
              setPeriod({ year: y, month: m });
            }}
            className="text-sm bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1"
          >
            {Array.from({ length: 12 }).map((_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - i);
              const y = d.getFullYear();
              const m = d.getMonth() + 1;
              return (
                <option key={`${y}-${m}`} value={`${y}-${m}`}>
                  {MONTH_NAMES[m - 1]} {y}
                </option>
              );
            })}
          </select>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Credits consumed',  value: fmt(data?.total_credits_consumed ?? 0),  icon: <TrendingDown className="w-4 h-4 text-red-400" /> },
          { label: 'Credits purchased', value: fmt(data?.total_credits_purchased ?? 0), icon: <TrendingUp className="w-4 h-4 text-emerald-400" /> },
          { label: 'USD revenue',       value: fmt(data?.total_usd_revenue ?? 0, '$'),  icon: <DollarSign className="w-4 h-4 text-blue-400" /> },
          {
            label: 'Gross margin',
            value: fmt(data?.total_gross_margin ?? 0, '$'),
            icon: <DollarSign className="w-4 h-4 text-violet-400" />,
            valueClass: marginColor(data?.total_gross_margin ?? 0),
          },
        ].map(card => (
          <div key={card.label} className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              {card.icon}
              <span className="text-xs text-slate-400">{card.label}</span>
            </div>
            <div className={`text-xl font-bold ${card.valueClass ?? 'text-white'}`}>
              {loading ? '—' : card.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── 3-month trend bar ── */}
      {data?.trend && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <div className="text-xs text-slate-400 mb-3 uppercase tracking-wider">3-month credit consumption trend</div>
          <div className="flex items-end gap-3 h-16">
            {data.trend.map(t => {
              const pct = trendMax > 0 ? (t.total_consumed / trendMax) * 100 : 0;
              return (
                <div key={`${t.year}-${t.month}`} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-slate-700 rounded-sm relative" style={{ height: '48px' }}>
                    <div
                      className="absolute bottom-0 w-full bg-violet-500 rounded-sm transition-all duration-500"
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500">{MONTH_NAMES[t.month - 1]}</span>
                  <span className="text-xs text-slate-400 font-medium">{t.total_consumed.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Per-org breakdown ── */}
      {data && data.orgs_count > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
          <button
            onClick={() => setShowOrgs(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
          >
            <span>Per-organization breakdown ({data.orgs_count} orgs)</span>
            {showOrgs ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {showOrgs && (
            <div className="border-t border-slate-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700">
                    <th className="text-left px-4 py-2">Org ID</th>
                    <th className="text-right px-4 py-2">Consumed</th>
                    <th className="text-right px-4 py-2">Revenue</th>
                    <th className="text-right px-4 py-2">LLM cost</th>
                    <th className="text-right px-4 py-2">Margin</th>
                    <th className="text-left px-4 py-2">Top action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {data.rows.map(row => (
                    <tr key={row.organization_id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-2 text-slate-400 font-mono text-xs">{row.organization_id.slice(0, 8)}…</td>
                      <td className="px-4 py-2 text-right text-white">{row.credits_consumed.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-white">${fmt(row.usd_revenue)}</td>
                      <td className="px-4 py-2 text-right text-slate-400">${fmt(row.estimated_llm_cost_usd)}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${marginColor(row.gross_margin_usd)}`}>
                        ${fmt(row.gross_margin_usd)}
                      </td>
                      <td className="px-4 py-2 text-slate-400 text-xs">
                        {row.top_action_type?.replace(/_/g, ' ') ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
