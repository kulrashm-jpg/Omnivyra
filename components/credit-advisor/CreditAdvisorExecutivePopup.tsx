'use client';

/**
 * Credit Advisor — Executive Insight Popup (Phase 23/25/30/34).
 * Proactive, executive-grade summary: runway, health, largest driver, top-3
 * actions, and optimization-before-upgrade guidance. Read-only; recommends and
 * deep-links only — changes nothing.
 */

import React from 'react';
import Link from 'next/link';
import { X, Gauge, Sparkles, ArrowRight, Clock, AlertTriangle } from 'lucide-react';
import { useExecutiveIntelligence } from '@/hooks/useExecutiveIntelligence';
import type {
  DeepLinkSection,
  HealthBand,
  RiskLevel,
} from '@/backend/services/creditAdvisor/creditAdvisorTypes';

const fmt = (n: number) => Math.round(n).toLocaleString();
const advisorLink = (section: DeepLinkSection) => `/command-center/credit-advisor#${section}`;

const RISK_ACCENT: Record<RiskLevel, string> = {
  Healthy: 'text-emerald-600',
  Monitor: 'text-amber-600',
  'At Risk': 'text-orange-600',
  Critical: 'text-red-600',
};
const BAND_BADGE: Record<HealthBand, string> = {
  Excellent: 'bg-emerald-100 text-emerald-700',
  Healthy: 'bg-emerald-100 text-emerald-700',
  Monitor: 'bg-amber-100 text-amber-700',
  'At Risk': 'bg-orange-100 text-orange-700',
  Critical: 'bg-red-100 text-red-700',
};

export default function CreditAdvisorExecutivePopup({ orgId }: { orgId: string | null | undefined }) {
  const { visible, report, dismiss } = useExecutiveIntelligence(orgId);

  if (!visible || !report) return null;
  const { summary, top_actions, upgrade } = report;

  const headline =
    summary.runway_days === null
      ? 'Your credit usage is steady'
      : `Credits projected to last ~${summary.runway_days} days`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div className="flex items-start gap-3">
            <Gauge className={`mt-0.5 h-6 w-6 ${RISK_ACCENT[summary.risk]}`} />
            <div>
              <h2 className={`text-lg font-semibold ${RISK_ACCENT[summary.risk]}`}>{headline}</h2>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BAND_BADGE[summary.health_band]}`}>
                  {summary.health_band}
                </span>
                <span>{fmt(summary.credits_remaining)} credits left</span>
                {summary.projected_exhaustion_date && (
                  <span>· runs out ~{summary.projected_exhaustion_date}</span>
                )}
              </div>
            </div>
          </div>
          <button onClick={() => dismiss('dismiss')} className="rounded-full p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-5">
          {summary.largest_driver && (
            <p className="text-sm text-slate-600">
              Your biggest driver is{' '}
              <strong>{summary.largest_driver.module}</strong> ({summary.largest_driver.percentage}% of spend).
            </p>
          )}

          {summary.optimization_potential_credits > 0 && (
            <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
              <Sparkles className="mr-1 inline h-4 w-4" />
              You could save ~<strong>{fmt(summary.optimization_potential_credits)}</strong> credits/month
              {summary.optimization_runway_gain_days != null && summary.optimization_runway_gain_days > 0 && (
                <> and add ~<strong>{summary.optimization_runway_gain_days}</strong> days of runway</>
              )}{' '}
              without upgrading.
            </div>
          )}

          {/* Top 3 actions (Phase 30) */}
          {top_actions.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Top actions
              </div>
              <ol className="space-y-2">
                {top_actions.map((a) => (
                  <li key={a.rank} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
                    <div>
                      <div className="text-sm font-medium text-slate-800">{a.rank}. {a.title}</div>
                      <div className="text-xs text-emerald-700">
                        Save ~{fmt(a.savings_credits)} credits/mo
                        {a.runway_gain_days != null && a.runway_gain_days > 0 && ` · +${a.runway_gain_days} days runway`}
                      </div>
                      {a.tradeoff && <div className="text-xs text-slate-400">Tradeoff: {a.tradeoff}</div>}
                    </div>
                    <Link href={advisorLink(a.deep_link)} className="mt-0.5 shrink-0 text-slate-400 hover:text-indigo-600" aria-label="View details">
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Upgrade guidance (Phase 28 — optimization first) */}
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <span className="font-semibold text-slate-700">{upgrade.category}</span>
            <p className="mt-0.5 text-slate-600">{upgrade.reasoning}</p>
          </div>

          <Link
            href={advisorLink('overview')}
            className="flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Open Credit Advisor <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Dismissal controls (Phase 24) */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <button onClick={() => dismiss('remind')} className="flex items-center gap-1 hover:text-slate-700">
            <Clock className="h-3.5 w-3.5" /> Remind me later
          </button>
          <button onClick={() => dismiss('today')} className="hover:text-slate-700">Dismiss for today</button>
          <button onClick={() => dismiss('forever')} className="hover:text-slate-700">Don’t show again</button>
          <button onClick={() => dismiss('dismiss')} className="font-medium text-slate-700 hover:text-slate-900">Dismiss</button>
        </div>
      </div>
    </div>
  );
}
