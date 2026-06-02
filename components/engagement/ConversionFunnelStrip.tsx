/**
 * Conversion Funnel Strip — unified narrative (read-only).
 *
 * Stitches the EXISTING surfaces into one story so an operator can read
 * Creator → Website → Lead → Conversion without leaving the page:
 *
 *   Creator Content → Website Visits → Form Views → Lead Submissions
 *     → Attributed Leads → Opportunities
 *
 * It REUSES three existing endpoints and computes nothing new:
 *   - /api/engagement/creator-conversion   (attributed leads + converting assets)
 *   - /api/website-intelligence/dashboard  (overview: visits / form_starts / form_submits)
 *   - /api/active-leads/opportunities?counts_only=1 (opportunity totals)
 *
 * Each stage is a context bridge (a link to its deep surface). Every fetch is
 * best-effort: a failure shows "—" for that stage, never a crash. The funnel is
 * never hidden — with no data it shows the stages + a readiness next-action.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import { ChevronRight, Sparkles } from 'lucide-react';

type StageData = {
  creatorContent: number | null;
  visits: number | null;
  formViews: number | null;
  submissions: number | null;
  attributedLeads: number | null;
  opportunities: number | null;
};

const STAGES: Array<{ key: keyof StageData; label: string; sub: string; href: string }> = [
  { key: 'creatorContent', label: 'Creator Content', sub: 'converting assets', href: '/engagement/analytics#creator-conversion' },
  { key: 'visits', label: 'Website Visits', sub: 'unique visitors', href: '/website-intelligence' },
  { key: 'formViews', label: 'Form Views', sub: 'form starts', href: '/lead-capture' },
  { key: 'submissions', label: 'Lead Submissions', sub: 'form submits', href: '/lead-capture' },
  { key: 'attributedLeads', label: 'Attributed Leads', sub: 'creator-attributed', href: '/engagement/analytics#creator-conversion' },
  { key: 'opportunities', label: 'Opportunities', sub: 'active', href: '/command-center/active-leads' },
];

export default function ConversionFunnelStrip({
  className = '',
  organizationId,
}: {
  className?: string;
  // Optional explicit company. Pages that hold their own company state (e.g.
  // website-intelligence) pass it; otherwise we fall back to the selected
  // company in context (engagement-analytics / lead-capture). Backward compatible.
  organizationId?: string;
}) {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = (organizationId ?? selectedCompanyId) || '';
  const [data, setData] = useState<StageData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!companyId.trim()) return;
    setLoading(true);
    const getJson = async (url: string): Promise<any> => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.error ? null : json;
      } catch {
        return null;
      }
    };
    const cid = encodeURIComponent(companyId);
    const [conv, dash, opp] = await Promise.all([
      getJson(`/api/engagement/creator-conversion?organization_id=${cid}&days=30`),
      getJson(`/api/website-intelligence/dashboard?company_id=${cid}`),
      getJson(`/api/active-leads/opportunities?companyId=${cid}&counts_only=1`),
    ]);

    const overview = dash?.overview ?? null;
    const attributed = conv
      ? Math.max(
          Number(conv.strategies?.total_conversions ?? 0),
          Number(conv.variants?.total_conversions ?? 0),
          Number(conv.assets?.total_conversions ?? 0),
        )
      : null;
    const oppTotal = opp?.type_counts
      ? Object.values(opp.type_counts as Record<string, number>).reduce((s: number, n) => s + Number(n || 0), 0)
      : null;

    setData({
      creatorContent: Array.isArray(conv?.assets?.items) ? conv.assets.items.length : null,
      visits: overview ? Number(overview.unique_visitors ?? 0) : null,
      formViews: overview ? Number(overview.form_starts ?? 0) : null,
      submissions: overview ? Number(overview.form_submits ?? 0) : null,
      attributedLeads: attributed,
      opportunities: oppTotal,
    });
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (!companyId) return null;

  const valueOf = (k: keyof StageData): number | null => (data ? data[k] : null);
  const hasAny = !!data && STAGES.some((s) => typeof valueOf(s.key) === 'number' && (valueOf(s.key) as number) > 0);

  return (
    <section className={`rounded-[24px] border border-gray-100 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            Conversion Funnel
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Creator → Website → Lead → Conversion, end to end. Click any stage to drill into its surface.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-slate-500">30d</span>
      </div>

      <div className="flex flex-wrap items-stretch gap-1.5">
        {STAGES.map((stage, i) => {
          const v = valueOf(stage.key);
          const display = loading && !data ? '·' : typeof v === 'number' ? v.toLocaleString() : '—';
          return (
            <React.Fragment key={stage.key}>
              <Link
                href={stage.href}
                className="group flex min-w-[96px] flex-1 flex-col items-center rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-3 text-center transition-colors hover:border-emerald-200 hover:bg-emerald-50/50"
              >
                <span className="text-lg font-bold text-slate-900 group-hover:text-emerald-700">{display}</span>
                <span className="mt-0.5 text-[11px] font-medium leading-tight text-slate-700">{stage.label}</span>
                <span className="text-[10px] leading-tight text-slate-400">{stage.sub}</span>
              </Link>
              {i < STAGES.length - 1 && (
                <div className="flex items-center">
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {!hasAny && !loading && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">
            The funnel lights up as data flows. Connect website tracking, then publish a single/best-variant creator
            campaign.
          </p>
          <Link
            href="/lead-capture"
            className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
          >
            Set up tracking
          </Link>
        </div>
      )}
    </section>
  );
}
