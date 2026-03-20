/**
 * Credit Dashboard — Step 6
 *
 * Super-admin visibility into credit consumption:
 *   - Current balance + health indicator
 *   - Per-action cost reference
 *   - Recent transaction history
 *   - Campaign cost estimator preview
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Zap, TrendingDown, AlertTriangle, CheckCircle, RefreshCw, ChevronDown, ChevronRight, DollarSign } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type CreditHealth = 'healthy' | 'low' | 'critical' | 'empty';

type CreditSummary = {
  balance: number;
  health: CreditHealth;
  monthly_consumed: number;
  monthly_purchased: number;
  top_action: string | null;
  top_action_credits: number;
};

type CostTier = {
  label: string;
  color: string;
  note?: string;
  actions: Array<{ action: string; label: string; credits: number; unit?: string }>;
};

type Transaction = {
  id: string;
  transaction_type: string;
  credits_delta: number;
  reference_type: string | null;
  note: string | null;
  created_at: string;
};

// ── Health colour map ─────────────────────────────────────────────────────────

const HEALTH_STYLES: Record<CreditHealth, { text: string; bg: string; icon: React.ReactNode }> = {
  healthy:  { text: 'text-emerald-400', bg: 'bg-emerald-900/30 border-emerald-700', icon: <CheckCircle className="w-4 h-4 text-emerald-400" /> },
  low:      { text: 'text-amber-400',   bg: 'bg-amber-900/30 border-amber-700',     icon: <AlertTriangle className="w-4 h-4 text-amber-400" /> },
  critical: { text: 'text-red-400',     bg: 'bg-red-900/30 border-red-700',         icon: <AlertTriangle className="w-4 h-4 text-red-400" /> },
  empty:    { text: 'text-slate-400',   bg: 'bg-slate-800/50 border-slate-600',     icon: <TrendingDown className="w-4 h-4 text-slate-400" /> },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface CreditDashboardProps {
  orgId: string;
}

export default function CreditDashboard({ orgId }: CreditDashboardProps) {
  const [summary, setSummary]       = useState<CreditSummary | null>(null);
  const [tiers, setTiers]           = useState<Record<string, CostTier>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showCosts, setShowCosts]   = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, costsRes, txRes] = await Promise.all([
        fetch(`/api/credits/summary?org_id=${orgId}`),
        fetch('/api/credits/costs'),
        fetch(`/api/credits/transactions?org_id=${orgId}&limit=20`),
      ]);

      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (costsRes.ok)   setTiers(await costsRes.json());
      if (txRes.ok)      setTransactions(await txRes.json());
    } catch (e) {
      console.error('[CreditDashboard] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const health = summary?.health ?? 'empty';
  const healthStyle = HEALTH_STYLES[health];

  // ── Balance bar ───────────────────────────────────────────────────────────

  const balancePct = summary
    ? Math.min(100, Math.round((summary.balance / 1000) * 100))
    : 0;

  const barColor =
    health === 'healthy'  ? 'bg-emerald-500' :
    health === 'low'      ? 'bg-amber-500' :
    health === 'critical' ? 'bg-red-500' : 'bg-slate-600';

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-violet-400" />
          <h2 className="text-lg font-semibold text-white">Credits</h2>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Balance card ── */}
      <div className={`rounded-xl border p-4 space-y-3 ${healthStyle.bg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {healthStyle.icon}
            <span className={`text-sm font-medium capitalize ${healthStyle.text}`}>{health}</span>
          </div>
          <span className="text-2xl font-bold text-white">
            {loading ? '—' : (summary?.balance ?? 0).toLocaleString()}
            <span className="text-sm font-normal text-slate-400 ml-1">credits</span>
          </span>
        </div>

        {/* Balance bar */}
        <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${balancePct}%` }}
          />
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 pt-1 text-sm">
            <div className="text-slate-400">
              Consumed this month
              <div className="text-white font-medium">{summary.monthly_consumed.toLocaleString()}</div>
            </div>
            <div className="text-slate-400">
              Purchased this month
              <div className="text-white font-medium">{summary.monthly_purchased.toLocaleString()}</div>
            </div>
            {summary.top_action && (
              <div className="col-span-2 text-slate-400">
                Top action
                <div className="text-white font-medium">
                  {summary.top_action.replace(/_/g, ' ')} — {summary.top_action_credits} credits
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Cost reference ── */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
        <button
          onClick={() => setShowCosts(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-slate-400" />
            <span>Credit cost reference</span>
          </div>
          {showCosts ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {showCosts && (
          <div className="px-4 pb-4 space-y-4 border-t border-slate-700">
            {Object.entries(tiers).map(([key, tier]) => (
              <div key={key}>
                <div className="flex items-center gap-2 mt-3 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{tier.label}</span>
                  {tier.note && (
                    <span className="text-xs text-slate-500 italic">{tier.note}</span>
                  )}
                </div>
                <div className="space-y-1">
                  {tier.actions.map(a => (
                    <div key={a.action} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">{a.label}</span>
                      <span className="text-white font-medium tabular-nums">
                        {a.credits}<span className="text-slate-500 font-normal">{a.unit ?? ' cr'}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Transaction history ── */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
        <button
          onClick={() => setShowHistory(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
        >
          <span>Recent transactions</span>
          {showHistory ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {showHistory && (
          <div className="border-t border-slate-700 divide-y divide-slate-700/50">
            {transactions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">No transactions yet.</p>
            ) : transactions.map(tx => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <div className="text-slate-200">{tx.note ?? tx.reference_type ?? tx.transaction_type}</div>
                  <div className="text-slate-500 text-xs">
                    {new Date(tx.created_at).toLocaleString()}
                  </div>
                </div>
                <span className={`font-mono font-semibold ${tx.credits_delta < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {tx.credits_delta > 0 ? '+' : ''}{tx.credits_delta}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
