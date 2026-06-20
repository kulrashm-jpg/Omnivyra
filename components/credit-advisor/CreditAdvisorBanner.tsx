'use client';

/**
 * Credit Advisor — Command Center executive banner (Phase 32).
 * Always-on, single-line visibility: consumption health, runway, largest
 * driver, top recommendation, and a deep link into the Credit Advisor.
 * Read-only; its own lightweight fetch (no popup show/persist logic).
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gauge, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import type {
  ExecutiveIntelligenceReport,
  RiskLevel,
} from '@/backend/services/creditAdvisor/creditAdvisorTypes';

const fmt = (n: number) => Math.round(n).toLocaleString();

const STRIP: Record<RiskLevel, string> = {
  Healthy: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  Monitor: 'border-amber-200 bg-amber-50 text-amber-800',
  'At Risk': 'border-orange-200 bg-orange-50 text-orange-900',
  Critical: 'border-red-200 bg-red-50 text-red-900',
};

export default function CreditAdvisorBanner({ orgId }: { orgId: string | null | undefined }) {
  const [report, setReport] = useState<ExecutiveIntelligenceReport | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/credits/executive?org_id=${orgId}`);
        if (!res.ok) return;
        const data = (await res.json()) as ExecutiveIntelligenceReport;
        if (!cancelled) setReport(data);
      } catch {
        /* banner is best-effort; stay silent on failure */
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  if (!report) return null;
  const { banner } = report;
  const healthy = banner.risk === 'Healthy';

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-2.5 text-sm ${STRIP[banner.risk]}`}>
      <span className="flex items-center gap-1.5 font-semibold">
        {healthy ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        {banner.runway_days === null
          ? 'Credit usage is steady'
          : `Credits projected to last ~${banner.runway_days} days`}
      </span>

      {banner.largest_driver && (
        <span className="flex items-center gap-1 opacity-90">
          <Gauge className="h-3.5 w-3.5" /> Largest driver: {banner.largest_driver.module} ({banner.largest_driver.percentage}%)
        </span>
      )}

      {banner.top_recommendation && (
        <span className="opacity-90">
          Save ~{fmt(banner.top_recommendation.savings_credits)} credits
          {banner.top_recommendation.runway_gain_days != null && banner.top_recommendation.runway_gain_days > 0 &&
            ` · +${banner.top_recommendation.runway_gain_days} days`}
        </span>
      )}

      <Link
        href="/command-center/credit-advisor#overview"
        className="ml-auto flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
      >
        View details <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
