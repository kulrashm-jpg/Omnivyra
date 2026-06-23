'use client';

/**
 * Customer Readiness Console (super-admin) — READ-ONLY operational visibility.
 * Single view of tenant health + readiness. No write actions.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { apiFetch } from '../../lib/apiFetch';
import CustomerReadinessDrawer from '../../components/super-admin/CustomerReadinessDrawer';
import type {
  CompanyReadiness,
  TenantStatus,
  ReadinessBucket,
} from '../../backend/services/customerReadinessService';
import type { DetectedOpportunity, OpportunityType, OpportunitySeverity } from '../../backend/services/customerOpportunityService';
import type { PriorityTier } from '../../backend/services/customerOpportunityPriorityService';
import type { ExecutiveInsight } from '../../backend/services/customerExecutiveInsightService';

type TenantRow = CompanyReadiness & {
  opportunities: DetectedOpportunity[];
  opportunity_count: number;
  highest_severity: OpportunitySeverity | null;
  priority_score: number;
  priority_tier: PriorityTier;
  narrative: string;
  key_insight: ExecutiveInsight | null;
  primary_blocker: ExecutiveInsight | null;
  primary_opportunity: ExecutiveInsight | null;
  insights: ExecutiveInsight[];
};

const tierColor = (t: PriorityTier) =>
  t === 'CRITICAL' ? 'bg-red-100 text-red-700' :
  t === 'HIGH' ? 'bg-orange-50 text-orange-700' :
  t === 'MEDIUM' ? 'bg-amber-50 text-amber-700' :
  t === 'LOW' ? 'bg-slate-100 text-slate-600' :
  'bg-emerald-50 text-emerald-700';

const STATUSES: (TenantStatus | '')[] = ['', 'COMPANY_CREATED', 'ACTIVE', 'DORMANT', 'INACTIVE', 'EMAIL_VERIFIED', 'SIGNUP_STARTED'];
const BUCKETS: (ReadinessBucket | '')[] = ['', 'READY', 'PARTIAL', 'AT_RISK'];

const statusColor = (s: TenantStatus) =>
  s === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' :
  s === 'DORMANT' ? 'bg-amber-50 text-amber-700' :
  s === 'INACTIVE' ? 'bg-red-50 text-red-600' :
  'bg-slate-100 text-slate-600';

const scoreColor = (n: number) => n >= 80 ? 'text-emerald-600' : n >= 40 ? 'text-amber-600' : 'text-red-600';
const fmtDate = (iso: string | null) => { if (!iso) return '—'; const t = Date.parse(iso); return Number.isNaN(t) ? '—' : new Date(t).toISOString().slice(0, 10); };

const sevColor = (s: OpportunitySeverity | null) =>
  s === 'HIGH' ? 'bg-red-50 text-red-600' : s === 'MEDIUM' ? 'bg-amber-50 text-amber-700' : s === 'LOW' ? 'bg-slate-100 text-slate-600' : 'text-[#9AA7B8]';

export default function CustomerReadinessPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TenantRow | null>(null);

  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [readiness, setReadiness] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/super-admin/customer-readiness');
        if (!res.ok) { setError(res.status === 401 || res.status === 403 ? 'Not authorized (super-admin only).' : 'Failed to load.'); return; }
        const json = await res.json();
        setTenants(json.tenants ?? []);
      } catch { setError('Failed to load customer readiness.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const planOptions = useMemo(() => Array.from(new Set(tenants.map((t) => t.plan))).sort(), [tenants]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenants.filter((t) =>
      (!status || t.tenant_status === status) &&
      (!plan || t.plan === plan) &&
      (!readiness || t.readiness_bucket === readiness) &&
      (!q || `${t.company_name} ${t.company_id}`.toLowerCase().includes(q)),
    ).sort((a, b) => b.priority_score - a.priority_score || a.company_id.localeCompare(b.company_id));
  }, [tenants, status, plan, readiness, search]);

  const topCompanies = useMemo(() => filtered.filter((t) => t.priority_tier !== 'READ_ONLY').slice(0, 5), [filtered]);

  const summary = useMemo(() => ({
    total: filtered.length,
    paying: filtered.filter((t) => t.billing_ready === 'READY').length,
    ready: filtered.filter((t) => t.readiness_bucket === 'READY').length,
    partial: filtered.filter((t) => t.readiness_bucket === 'PARTIAL').length,
    atRisk: filtered.filter((t) => t.readiness_bucket === 'AT_RISK').length,
    active: filtered.filter((t) => t.tenant_status === 'ACTIVE').length,
  }), [filtered]);

  const opportunityStats = useMemo(() => {
    const byType = new Map<OpportunityType, number>();
    let total = 0;
    for (const t of filtered) for (const o of t.opportunities ?? []) { byType.set(o.type, (byType.get(o.type) ?? 0) + 1); total += 1; }
    const top = Array.from(byType.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { total, top };
  }, [filtered]);

  return (
    <>
      <Head><title>Customer Readiness Console | Omnivyra</title><meta name="robots" content="noindex" /></Head>
      <div className="min-h-screen bg-[#F5F9FF] px-6 py-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold text-[#0B1F33]">Customer Readiness Console</h1>
          <p className="mt-1 text-sm text-[#6B7C93]">Read-only view of tenant health and onboarding readiness.</p>

          {/* Summary cards */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
            {[
              { label: 'Tenants', value: summary.total },
              { label: 'Active', value: summary.active },
              { label: 'Paying', value: summary.paying },
              { label: 'Ready', value: summary.ready },
              { label: 'Partial', value: summary.partial },
              { label: 'At risk', value: summary.atRisk },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-[#6B7C93]">{c.label}</p>
                <p className="mt-1 text-2xl font-bold text-[#0B1F33]">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Top companies requiring attention (read-only prioritization) */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Top companies requiring attention</p>
            <div className="mt-2 space-y-1.5">
              {topCompanies.length === 0
                ? <span className="text-sm text-emerald-600">Nothing requires attention.</span>
                : topCompanies.map((t, i) => (
                    <button key={t.company_id} onClick={() => setSelected(t)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-[#F5F9FF]">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#0B1F33]"><span className="text-[#9AA7B8]">{i + 1}.</span> {t.company_name}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-[#6B7C93]">{t.opportunity_count} opps · {t.plan}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tierColor(t.priority_tier)}`}>{t.priority_tier} {t.priority_score}</span>
                        </span>
                      </div>
                      {t.narrative && <p className="mt-0.5 text-xs text-[#6B7C93]">{t.narrative}</p>}
                    </button>
                  ))}
            </div>
          </div>

          {/* Top opportunities (read-only detection) */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Top opportunities</p>
              <span className="text-xs text-[#6B7C93]">{opportunityStats.total} detected</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {opportunityStats.top.length === 0
                ? <span className="text-sm text-emerald-600">None detected</span>
                : opportunityStats.top.map(([type, count]) => (
                    <span key={type} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-[#0B1F33]">
                      {type} <strong className="text-[#0A66C2]">{count}</strong>
                    </span>
                  ))}
            </div>
          </div>

          {/* Filters */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company…"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#0A66C2]" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
            </select>
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">All plans</option>
              {planOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={readiness} onChange={(e) => setReadiness(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {BUCKETS.map((b) => <option key={b} value={b}>{b || 'All readiness'}</option>)}
            </select>
          </div>

          {/* Table */}
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            {loading ? <p className="px-4 py-8 text-center text-sm text-[#6B7C93]">Loading…</p>
              : error ? <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>
              : (
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-[#6B7C93]">
                  <tr>
                    <th className="px-4 py-3">Company</th><th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Users</th><th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Readiness</th><th className="px-4 py-3">Last activity</th>
                    <th className="px-4 py-3">Missing areas</th><th className="px-4 py-3">Opportunities</th>
                    <th className="px-4 py-3">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.company_id} onClick={() => setSelected(t)} className="cursor-pointer border-b border-slate-100 hover:bg-[#F5F9FF]">
                      <td className="px-4 py-3 font-medium text-[#0B1F33]">{t.company_name}</td>
                      <td className="px-4 py-3 text-[#6B7C93]">{t.plan}</td>
                      <td className="px-4 py-3 text-[#6B7C93]">{t.user_count} <span className="text-xs">({t.active_user_count_30d} active)</span></td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(t.tenant_status)}`}>{t.tenant_status}</span></td>
                      <td className={`px-4 py-3 font-semibold ${scoreColor(t.overall_readiness_score)}`}>{t.overall_readiness_score}%</td>
                      <td className="px-4 py-3 text-[#6B7C93]">{fmtDate(t.last_activity_at)}</td>
                      <td className="px-4 py-3 text-xs text-[#6B7C93]">{t.missing_areas.length ? t.missing_areas.length + ' missing' : '—'}</td>
                      <td className="px-4 py-3 text-xs">
                        {t.opportunity_count > 0
                          ? <span className={`rounded-full px-2 py-0.5 font-medium ${sevColor(t.highest_severity)}`}>{t.opportunity_count} ({t.highest_severity})</span>
                          : <span className="text-[#9AA7B8]">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tierColor(t.priority_tier)}`}>{t.priority_tier}{t.priority_tier !== 'READ_ONLY' ? ` ${t.priority_score}` : ''}</span>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-[#6B7C93]">No tenants match.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <CustomerReadinessDrawer tenant={selected} onClose={() => setSelected(null)} />
    </>
  );
}
