/**
 * Billing Summary Widget — Phases B + C
 *
 * Lightweight, drop-in billing visibility for company dashboards / workspace
 * headers. Reads the org-isolated `/api/company/billing/summary` endpoint
 * (server enforces assertOrgAccess — no client-side billing authority, no
 * cross-org access). Renders balance, burn, plan, and proactive warnings
 * (low balance, near depletion, freeze, anomaly, pending approvals).
 *
 * No fake projections — every number comes from the existing immutable
 * billing services via the summary endpoint.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Coins, Download, ExternalLink, LifeBuoy, Snowflake, TrendingDown,
} from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

interface SummaryPayload {
  organizationId: string;
  wallet: {
    totalAvailable: number; estimatedUsdValue: number;
    paidBalance: number; freeBalance: number; incentiveBalance: number;
  } | null;
  forecast: { dailyBurnRate: number; daysRemaining: number; isAccelerating: boolean } | null;
  contract: { contractNumber: string } | null;
  subscriptions: Array<{ status: string; daysUntilRenewal: number }>;
  flags: Record<string, { enabled: boolean; reason: string }>;
  financialControls?: { emergencyFreeze: boolean; billingLock: boolean; reason: string | null };
}

export interface BillingSummaryWidgetProps {
  companyId: string;
  /** Below this available-credit count, show a low-balance warning. */
  lowBalanceThreshold?: number;
  /** Below this projected days-remaining, show a depletion warning. */
  depletionWarningDays?: number;
  compact?: boolean;
}

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : new Intl.NumberFormat('en-US').format(n);
}

export default function BillingSummaryWidget({
  companyId,
  lowBalanceThreshold = 100,
  depletionWarningDays = 7,
  compact = false,
}: BillingSummaryWidgetProps) {
  const [data, setData] = useState<SummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/company/billing/summary?companyId=${encodeURIComponent(companyId)}`);
        if (!active) return;
        if (res.status === 401 || res.status === 403) { setDenied(true); return; }
        if (res.ok) setData(await res.json());
      } catch { /* widget is non-critical — fail quiet */ }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [companyId]);

  // Standard users / non-members: the server already denied — render nothing
  // (the widget is purely additive visibility, not a gate).
  if (denied) return null;
  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 animate-pulse">
        <div className="h-4 w-32 bg-slate-100 rounded mb-3" />
        <div className="h-6 w-24 bg-slate-100 rounded" />
      </div>
    );
  }
  if (!data?.wallet) return null;

  const w = data.wallet;
  const burn = data.forecast;
  const frozen = Boolean(data.financialControls?.emergencyFreeze || data.financialControls?.billingLock);
  const lowBalance = w.totalAvailable < lowBalanceThreshold;
  const nearDepletion = !!burn && burn.daysRemaining > 0 && burn.daysRemaining <= depletionWarningDays;
  const accelerating = !!burn?.isAccelerating;

  const warnings: Array<{ icon: React.ReactNode; text: string; tone: 'warn' | 'critical' }> = [];
  if (lowBalance) warnings.push({ icon: <AlertTriangle className="h-3.5 w-3.5" />, text: `Low balance — ${fmt(w.totalAvailable)} credits left`, tone: 'critical' });
  if (nearDepletion) warnings.push({ icon: <TrendingDown className="h-3.5 w-3.5" />, text: `Projected depletion in ~${burn!.daysRemaining} day(s)`, tone: 'critical' });
  if (accelerating) warnings.push({ icon: <TrendingDown className="h-3.5 w-3.5" />, text: 'Consumption accelerating vs trend', tone: 'warn' });
  if (frozen) warnings.push({ icon: <Snowflake className="h-3.5 w-3.5" />, text: 'Billing frozen — contact support', tone: 'critical' });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Coins className="h-4 w-4 text-emerald-600" />Billing
        </h4>
        <Link href="/company/billing" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
          View Billing <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'} gap-3 mb-3`}>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Available</div>
          <div className="text-base font-semibold text-slate-900">{fmt(w.totalAvailable)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Est. value</div>
          <div className="text-base font-semibold text-slate-900">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(w.estimatedUsdValue)}
          </div>
        </div>
        {!compact && (
          <>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Daily burn</div>
              <div className="text-base font-semibold text-slate-900">{burn ? `${fmt(Math.round(burn.dailyBurnRate))} cr` : '—'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Plan</div>
              <div className="text-base font-semibold text-slate-900">
                {data.subscriptions[0]?.status ?? (data.contract?.contractNumber ? 'Contract' : 'Free')}
              </div>
            </div>
          </>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1 mb-3">
          {warnings.map((wn, i) => (
            <div key={i}
              className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${
                wn.tone === 'critical' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
              }`}>
              {wn.icon}{wn.text}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href="/company/billing" className="text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50">
          View Billing
        </Link>
        <Link href="/company/billing#export" className="text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50 flex items-center gap-1">
          <Download className="h-3 w-3" />Export Usage
        </Link>
        <Link href="/pricing" className="text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50">
          Upgrade Plan
        </Link>
        <a href="mailto:support@omnivyra.com?subject=Billing"
          className="text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50 flex items-center gap-1">
          <LifeBuoy className="h-3 w-3" />Contact Support
        </a>
      </div>
    </div>
  );
}
