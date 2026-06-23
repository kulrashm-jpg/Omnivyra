'use client';

/**
 * Customer Operations Command Center (super-admin) — READ-ONLY cockpit unifying
 * readiness, opportunities, priority, insights, evolution, identity, subscription,
 * integrations, and signup-funnel failures. No actions.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { apiFetch } from '../../lib/apiFetch';
import type { CockpitCompany, SignupFunnel } from '../../backend/services/customerOperationsCockpitService';

const tierColor = (t: string) =>
  t === 'CRITICAL' ? 'bg-red-100 text-red-700' : t === 'HIGH' ? 'bg-orange-50 text-orange-700' :
  t === 'MEDIUM' ? 'bg-amber-50 text-amber-700' : t === 'LOW' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700';
const statusColor = (s: string) =>
  s === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : s === 'DORMANT' ? 'bg-amber-50 text-amber-700' : s === 'INACTIVE' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600';
const trajColor = (t: string) =>
  t === 'IMPROVING' ? 'text-emerald-600' : t === 'DECLINING' ? 'text-red-600' : t === 'STABLE' ? 'text-slate-600' : 'text-[#9AA7B8]';
const scoreColor = (n: number) => n >= 80 ? 'text-emerald-600' : n >= 40 ? 'text-amber-600' : 'text-red-600';
const fmt = (iso: string | null) => { if (!iso) return '—'; const t = Date.parse(iso); return Number.isNaN(t) ? '—' : new Date(t).toISOString().slice(0, 10); };
const state = (s: string) => s === 'READY' ? '✅' : s === 'NOT_READY' ? '⛔' : '❔';

export default function CustomerOperationsPage() {
  const [companies, setCompanies] = useState<CockpitCompany[]>([]);
  const [funnel, setFunnel] = useState<SignupFunnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CockpitCompany | null>(null);
  const [f, setF] = useState({ status: '', plan: '', priority: '', readiness: '', trajectory: '', search: '' });

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/super-admin/customer-operations');
        if (!res.ok) { setError(res.status === 401 || res.status === 403 ? 'Not authorized (super-admin only).' : 'Failed to load.'); return; }
        const json = await res.json();
        setCompanies(json.companies ?? []); setFunnel(json.signup_funnel ?? null);
      } catch { setError('Failed to load customer operations.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const plans = useMemo(() => Array.from(new Set(companies.map((c) => c.plan))).sort(), [companies]);
  const rows = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return companies.filter((c) =>
      (!f.status || c.tenant_status === f.status) && (!f.plan || c.plan === f.plan) &&
      (!f.priority || c.priority_tier === f.priority) && (!f.readiness || c.readiness_bucket === f.readiness) &&
      (!f.trajectory || c.trajectory === f.trajectory) &&
      (!q || `${c.company_name} ${c.website_domain ?? ''}`.toLowerCase().includes(q)));
  }, [companies, f]);

  const cards = useMemo(() => ({
    total: rows.length,
    active: rows.filter((c) => c.tenant_status === 'ACTIVE').length,
    dormant: rows.filter((c) => c.tenant_status === 'DORMANT').length,
    paying: rows.filter((c) => c.paying).length,
    critical: rows.filter((c) => c.priority_tier === 'CRITICAL').length,
    failures: funnel?.total_failures ?? 0,
  }), [rows, funnel]);

  return (
    <>
      <Head><title>Customer Operations Command Center | Omnivyra</title><meta name="robots" content="noindex" /></Head>
      <div className="min-h-screen bg-[#F5F9FF] px-6 py-8">
        <div className="mx-auto max-w-[88rem]">
          <h1 className="text-2xl font-bold text-[#0B1F33]">Customer Operations Command Center</h1>
          <p className="mt-1 text-sm text-[#6B7C93]">Read-only operational cockpit — readiness, opportunities, priority, insights, evolution, identity, subscription, signup funnel.</p>

          {/* Top cards */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
            {[
              { label: 'Total Companies', v: cards.total }, { label: 'Active', v: cards.active }, { label: 'Dormant', v: cards.dormant },
              { label: 'Paying', v: cards.paying }, { label: 'Critical Priority', v: cards.critical }, { label: 'Signup Failures', v: cards.failures },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-[#6B7C93]">{c.label}</p><p className="mt-1 text-2xl font-bold text-[#0B1F33]">{c.v}</p>
              </div>
            ))}
          </div>

          {/* Signup funnel */}
          {funnel && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Signup funnel</p>
                <span className="text-xs text-[#6B7C93]">{funnel.onboarded} onboarded · {funnel.total_failures} failures</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {funnel.failures.map((e) => (
                  <span key={e.bucket} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-[#0B1F33]" title={`last: ${fmt(e.last_occurrence)} · domains: ${e.affected_domains.slice(0, 5).join(', ') || '—'}`}>
                    {e.bucket} <strong className={e.count > 0 ? 'text-red-600' : 'text-[#9AA7B8]'}>{e.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <input value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} placeholder="Search…" className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#0A66C2]" />
            {([['status', ['', 'COMPANY_CREATED', 'ACTIVE', 'DORMANT', 'INACTIVE']], ['plan', ['', ...plans]], ['priority', ['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'READ_ONLY']], ['readiness', ['', 'READY', 'PARTIAL', 'AT_RISK']], ['trajectory', ['', 'IMPROVING', 'STABLE', 'DECLINING', 'UNKNOWN']]] as [keyof typeof f, string[]][]).map(([key, opts]) => (
              <select key={key} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                {opts.map((o) => <option key={o} value={o}>{o || `All ${key}`}</option>)}
              </select>
            ))}
          </div>

          {/* Table */}
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            {loading ? <p className="px-4 py-8 text-center text-sm text-[#6B7C93]">Loading…</p>
              : error ? <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>
              : (
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-[#6B7C93]">
                  <tr>{['Company', 'Plan', 'Users', 'Status', 'Readiness', 'Priority', 'Trajectory', 'Opps', 'Last activity'].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.company_id} onClick={() => setSelected(c)} className="cursor-pointer border-b border-slate-100 hover:bg-[#F5F9FF]">
                      <td className="px-3 py-3 font-medium text-[#0B1F33]">{c.company_name}{c.identity_health === 'DRIFT' && <span className="ml-1 text-red-500" title="identity drift">⚠</span>}</td>
                      <td className="px-3 py-3 text-[#6B7C93]">{c.plan}</td>
                      <td className="px-3 py-3 text-[#6B7C93]">{c.user_count}<span className="text-xs"> ({c.active_user_count_30d})</span></td>
                      <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(c.tenant_status)}`}>{c.tenant_status}</span></td>
                      <td className={`px-3 py-3 font-semibold ${scoreColor(c.readiness_score)}`}>{c.readiness_score}%</td>
                      <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tierColor(c.priority_tier)}`}>{c.priority_tier}{c.priority_tier !== 'READ_ONLY' ? ` ${c.priority_score}` : ''}</span></td>
                      <td className={`px-3 py-3 text-xs font-medium ${trajColor(c.trajectory)}`}>{c.trajectory}</td>
                      <td className="px-3 py-3 text-xs text-[#6B7C93]">{c.opportunity_count || '—'}</td>
                      <td className="px-3 py-3 text-[#6B7C93]">{fmt(c.last_activity_at)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-[#6B7C93]">No companies match.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="flex-1 bg-black/30" onClick={() => setSelected(null)} />
          <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div><h2 className="text-lg font-semibold text-[#0B1F33]">{selected.company_name}</h2><p className="text-xs text-[#6B7C93]">{selected.company_id}</p></div>
              <button onClick={() => setSelected(null)} className="rounded-lg px-2 py-1 text-sm text-[#6B7C93] hover:bg-slate-100">Close</button>
            </div>
            <div className="space-y-5 px-5 py-5 text-sm">
              {selected.narrative && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[#0B1F33]">{selected.narrative}</div>}
              <Section title="Identity">
                <Row k="Website" v={selected.website ?? '—'} /><Row k="Domain" v={selected.website_domain ?? '—'} />
                <Row k="Admin email domain" v={selected.admin_email_domain ?? '—'} /><Row k="Identity health" v={selected.identity_health} />
              </Section>
              <Section title="Subscription"><Row k="Plan" v={selected.plan} /><Row k="Paying" v={selected.paying ? 'Yes' : 'No'} /><Row k="Users / active(30d)" v={`${selected.user_count} / ${selected.active_user_count_30d}`} /></Section>
              <Section title="Readiness"><Row k="Score" v={`${selected.readiness_score}% (${selected.readiness_bucket})`} /></Section>
              <Section title="Priority"><Row k="Tier / score" v={`${selected.priority_tier} ${selected.priority_tier !== 'READ_ONLY' ? selected.priority_score : ''}`} /></Section>
              <Section title="Evolution"><Row k="Trajectory" v={`${selected.trajectory}${selected.score_delta != null ? ` (${selected.score_delta >= 0 ? '+' : ''}${selected.score_delta})` : selected.trajectory === 'UNKNOWN' ? ' (insufficient history)' : ''}`} /></Section>
              <Section title="Integrations"><Row k="GA / GSC" v={`${state(selected.ga)} / ${state(selected.gsc)}`} /><Row k="Social / Community" v={`${state(selected.social)} / ${state(selected.community)}`} /></Section>
              <Section title="Executive insights">
                {selected.key_insight ? <Row k="Key" v={`${selected.key_insight.title} (${selected.key_insight.severity})`} /> : <p className="text-[#6B7C93]">None</p>}
                {selected.primary_blocker && <Row k="Blocker" v={selected.primary_blocker.title} />}
                {selected.primary_opportunity && <Row k="Opportunity" v={selected.primary_opportunity.title} />}
              </Section>
              <Section title="Opportunities"><Row k="Count / top severity" v={`${selected.opportunity_count} / ${selected.highest_severity ?? '—'}`} /></Section>
              <p className="pt-2 text-xs text-[#9AA7B8]">Read-only view · no actions available.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">{title}</h3><div className="space-y-1">{children}</div></section>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><span className="text-[#6B7C93]">{k}</span><span className="text-right text-[#0B1F33]">{v}</span></div>;
}
