/**
 * Creator Conversion Summary — discovery hook.
 *
 * A compact, self-fetching card that surfaces creator-driven conversion at the
 * hubs operators start from (engagement portal + intelligence Supporting
 * Signals) and links into the full card at /engagement/analytics#creator-conversion.
 *
 * Reuses the SAME endpoint as the full card (/api/engagement/creator-conversion)
 * — no duplicate logic. Reads the selected company from context so it can be
 * dropped anywhere without prop threading. Never hides: when attribution is not
 * yet live it invites setup rather than disappearing.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import { Sparkles, ArrowRight } from 'lucide-react';

type Category = { available: boolean; total_conversions: number; items: Array<{ id: string; conversions: number }> };
type Payload = { attribution_available: boolean; strategies: Category; variants: Category; assets: Category };

const HREF = '/engagement/analytics#creator-conversion';

export default function CreatorConversionSummary({ className = '' }: { className?: string }) {
  const { selectedCompanyId } = useCompanyContext();
  const organizationId = selectedCompanyId || '';
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const fetchData = useCallback(async () => {
    if (!organizationId.trim()) return;
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({ organization_id: organizationId, days: '30' });
      const res = await fetch(`/api/engagement/creator-conversion?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPayload(json as Payload);
    } catch {
      setFailed(true);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!organizationId) return null;

  const attributedLeads = payload
    ? Math.max(payload.strategies.total_conversions, payload.variants.total_conversions, payload.assets.total_conversions)
    : 0;
  const topStrategy = payload?.strategies.items[0]?.id ?? null;
  const topAsset = payload?.assets.items[0]?.id ?? null;
  const ready = !!payload?.attribution_available && !failed;
  const hasData = ready && attributedLeads > 0;

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <Link
      href={HREF}
      className={`group block rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/60 via-white to-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${className}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-600">
          <Sparkles className="h-3.5 w-3.5" />
          Creator Conversion
        </span>
        <ArrowRight className="h-4 w-4 text-emerald-400 transition-transform group-hover:translate-x-0.5" />
      </div>
      {children}
    </Link>
  );

  if (loading && !payload) {
    return (
      <Shell>
        <div className="h-10 animate-pulse rounded bg-emerald-100/60" />
      </Shell>
    );
  }

  if (!ready) {
    // Never hide — invite setup (usage-based: feature always visible).
    return (
      <Shell>
        <p className="text-sm font-semibold text-slate-800">See which creator work generates leads</p>
        <p className="mt-1 text-xs text-slate-500">
          Set up creator attribution to rank the strategies, variants, and assets driving conversions.
        </p>
      </Shell>
    );
  }

  if (!hasData) {
    return (
      <Shell>
        <p className="text-sm font-semibold text-slate-800">No creator-attributed leads yet (30d)</p>
        <p className="mt-1 text-xs text-slate-500">Publish a single/best-variant creator campaign to light this up.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{attributedLeads}</span>
        <span className="text-xs text-slate-500">attributed leads · 30d</span>
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-600">
        {topStrategy && (
          <p className="truncate" title={topStrategy}>
            <span className="text-slate-400">Top strategy:</span> <span className="font-medium text-slate-800">{topStrategy}</span>
          </p>
        )}
        {topAsset && (
          <p className="truncate" title={topAsset}>
            <span className="text-slate-400">Top asset:</span> <span className="font-medium text-slate-800">{topAsset}</span>
          </p>
        )}
      </div>
    </Shell>
  );
}
