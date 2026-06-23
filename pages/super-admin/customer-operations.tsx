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
import type { PortfolioOutcomes } from '../../backend/services/customerOutcomeIntelligenceService';
import type { PortfolioImpact } from '../../backend/services/customerImpactAttributionService';
import type { PortfolioSignalHealth } from '../../backend/services/customerSignalConfidenceService';
import type { AcquisitionResult } from '../../backend/services/customerAcquisitionIntelligenceService';
import type { PlaybookPortfolio } from '../../backend/services/customerActionPlaybookService';
import type { TelemetryCoverageResult } from '../../backend/services/customerTelemetryCoverageService';
import type { OnboardingConversionResult } from '../../backend/services/onboardingConversionService';

const confColor = (c: string) =>
  c === 'HIGH' ? 'text-emerald-600' : c === 'MEDIUM' ? 'text-amber-600' : c === 'LOW' ? 'text-red-600' : 'text-[#9AA7B8]';

const outcomeBadge = (o: string) =>
  o === 'IMPROVED' ? { label: '↑ Improved', cls: 'text-emerald-600' } :
  o === 'DECLINED' ? { label: '↓ Declined', cls: 'text-red-600' } :
  o === 'UNCHANGED' ? { label: '→ Stable', cls: 'text-slate-600' } : { label: '—', cls: 'text-[#9AA7B8]' };
const impactBadge = (s: string) =>
  s === 'ATTRIBUTED' ? { label: 'Attributed', cls: 'text-emerald-600' } :
  s === 'POSSIBLY_ATTRIBUTED' ? { label: 'Possible', cls: 'text-amber-600' } :
  s === 'NOT_ATTRIBUTED' ? { label: 'Unattributed', cls: 'text-slate-600' } : { label: '—', cls: 'text-[#9AA7B8]' };

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
  const [outcomes, setOutcomes] = useState<PortfolioOutcomes | null>(null);
  const [impact, setImpact] = useState<PortfolioImpact | null>(null);
  const [signalHealth, setSignalHealth] = useState<PortfolioSignalHealth | null>(null);
  const [acquisition, setAcquisition] = useState<AcquisitionResult | null>(null);
  const [playbooks, setPlaybooks] = useState<PlaybookPortfolio | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryCoverageResult | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingConversionResult | null>(null);
  const [execSummary, setExecSummary] = useState<string[]>([]);
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
        setOutcomes(json.outcomes ?? null); setExecSummary(json.executive_outcome_summary ?? []);
        setImpact(json.impact ?? null);
        setSignalHealth(json.signal_health ?? null);
        setAcquisition(json.acquisition ?? null);
        setPlaybooks(json.playbooks ?? null);
        setTelemetry(json.telemetry ?? null);
        setOnboarding(json.onboarding_conversion ?? null);
      } catch { setError('Failed to load customer operations.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const onboardingByCompany = useMemo(
    () => new Map((onboarding?.companies.classifications ?? []).map((c) => [c.id, c])),
    [onboarding],
  );
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

          {/* Outcome intelligence */}
          {outcomes && (
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Outcomes (since first snapshot)</p>
                <div className="mt-2 flex gap-4 text-sm">
                  <span className="text-emerald-600">↑ {outcomes.improved_companies} improved</span>
                  <span className="text-slate-600">→ {outcomes.unchanged_companies} stable</span>
                  <span className="text-red-600">↓ {outcomes.declined_companies} declined</span>
                </div>
                <p className="mt-1 text-xs text-[#9AA7B8]">{outcomes.no_history_companies} awaiting history · avg Δ {outcomes.average_readiness_change ?? '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 lg:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Executive outcome summary</p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-[#0B1F33]">
                  {execSummary.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* Impact attribution */}
          {impact && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Impact attribution</p>
                <div className="flex gap-4 text-sm">
                  <span className="text-emerald-600">{impact.attributed_improvements} attributed</span>
                  <span className="text-amber-600">{impact.possible_improvements} possible</span>
                  <span className="text-slate-600">{impact.unattributed_improvements} unattributed</span>
                  {impact.insufficient_data_companies > 0 && <span className="text-[#9AA7B8]">{impact.insufficient_data_companies} awaiting history</span>}
                </div>
              </div>
              {impact.top_impact_drivers.length > 0 && (
                <p className="mt-2 text-xs text-[#6B7C93]">Top drivers: {impact.top_impact_drivers.slice(0, 4).map((d) => `${d.intervention_type} (${d.attributed}✓/${d.possible}?)`).join(' · ')}</p>
              )}
              {impact.most_common_improvement_paths.length > 0 && (
                <p className="mt-1 text-xs text-[#6B7C93]">Common paths: {impact.most_common_improvement_paths.slice(0, 3).map((p) => `${p.path} ×${p.count}`).join(' · ')}</p>
              )}
            </div>
          )}

          {/* Signal health */}
          {signalHealth && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Signal health</p>
                <div className="flex gap-4 text-sm">
                  <span className="text-emerald-600">{signalHealth.healthy_signals} healthy</span>
                  <span className="text-amber-600">{signalHealth.stale_signals} stale</span>
                  <span className="text-red-600">{signalHealth.low_confidence_signals} low</span>
                  <span className="text-[#9AA7B8]">{signalHealth.unknown_signals} unknown</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {signalHealth.per_area.map((a) => (
                  <span key={a.area} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-[#0B1F33]" title={`confidence H/M/L/?: ${a.confidence_distribution.HIGH}/${a.confidence_distribution.MEDIUM}/${a.confidence_distribution.LOW}/${a.confidence_distribution.UNKNOWN}`}>
                    {a.area} <span className="text-emerald-600">{a.confidence_distribution.HIGH}</span>/<span className="text-amber-600">{a.confidence_distribution.MEDIUM}</span>/<span className="text-red-600">{a.confidence_distribution.LOW}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Acquisition intelligence */}
          {acquisition && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Customer acquisition intelligence</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                {acquisition.funnel.map((s, idx) => (
                  <React.Fragment key={s.stage}>
                    {idx > 0 && <span className="text-[#9AA7B8]">→</span>}
                    <span className={`rounded-lg border px-2 py-1 ${s.measurable ? 'border-slate-200 bg-slate-50 text-[#0B1F33]' : 'border-dashed border-slate-300 text-[#9AA7B8]'}`} title={`${s.source} · ${s.coverage}`}>
                      {s.stage.replace(/_/g, ' ')} <strong>{s.count ?? '—'}</strong>
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#6B7C93]">
                {acquisition.conversions.filter((c) => c.rate != null).map((c) => (
                  <span key={c.label}>{c.label}: <strong className="text-[#0B1F33]">{c.rate}%</strong></span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {acquisition.loss_reasons.map((l) => (
                  <span key={l.reason} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-[#0B1F33]" title={l.evidence}>
                    {l.reason} <strong className={l.count > 0 ? 'text-red-600' : 'text-[#9AA7B8]'}>{l.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recommended admin actions (read-only) */}
          {playbooks && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Recommended admin actions <span className="font-normal normal-case text-[#9AA7B8]">(visibility only — no execution)</span></p>
                <span className="text-xs text-[#6B7C93]">{playbooks.total_recommended} recommended · {playbooks.total_suppressed} suppressed · {playbooks.blocked_playbooks} blocked</span>
              </div>
              <table className="mt-2 w-full text-xs">
                <thead className="text-left text-[#9AA7B8]"><tr>{['Playbook', 'Company', 'Reason', 'Confidence', 'Value'].map((h) => <th key={h} className="py-1 pr-3">{h}</th>)}</tr></thead>
                <tbody>
                  {playbooks.top_recommendations.slice(0, 12).map((p, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1 pr-3 font-medium text-[#0B1F33]">{p.playbook_name}</td>
                      <td className="py-1 pr-3 text-[#6B7C93]">{p.company_name}</td>
                      <td className="py-1 pr-3 text-[#6B7C93]" title={p.evidence}>{p.reason}</td>
                      <td className={`py-1 pr-3 font-medium ${confColor(p.confidence)}`}>{p.confidence}</td>
                      <td className="py-1 pr-3 text-[#6B7C93]">{p.expected_value_band} ({p.expected_value})</td>
                    </tr>
                  ))}
                  {playbooks.top_recommendations.length === 0 && <tr><td colSpan={5} className="py-2 text-[#9AA7B8]">No recommendations (all suppressed or no gaps).</td></tr>}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-[#9AA7B8]">Suppressed by: {Object.entries(playbooks.suppressed_by_reason).filter(([, n]) => n > 0).map(([r, n]) => `${r}=${n}`).join(' · ') || 'none'}</p>
            </div>
          )}

          {/* Telemetry completeness */}
          {telemetry && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Telemetry completeness</p>
                <div className="flex gap-4 text-sm">
                  <span className="font-semibold text-[#0B1F33]">{telemetry.coverage_percentage}% coverage</span>
                  <span className="text-emerald-600">{telemetry.fully_observable_signals} complete</span>
                  <span className="text-amber-600">{telemetry.partially_observable_signals} partial</span>
                  <span className="text-red-600">{telemetry.unknown_signals} unknown</span>
                  <span className="text-[#9AA7B8]">{telemetry.unobservable_signals} unobservable</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {telemetry.by_domain.map((d) => (
                  <span key={d.domain} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-[#0B1F33]" title={`${d.complete} complete / ${d.partial} partial / ${d.unknown} unknown / ${d.unobservable} unobservable`}>
                    {d.domain} <strong>{d.coverage_percentage ?? '—'}%</strong>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-[#6B7C93]">Top blind spots: {telemetry.highest_impact_blind_spots.slice(0, 5).map((b) => `${b.id} (${b.observability})`).join(' · ')}</p>
            </div>
          )}

          {/* Onboarding conversion intelligence */}
          {onboarding && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Onboarding conversion intelligence</p>
                <span className="text-xs text-[#6B7C93]">signup completion {onboarding.portfolio.completion_rate ?? '—'}% · company activation {onboarding.portfolio.company_completion_rate ?? '—'}%</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                {onboarding.funnel.map((s, idx) => (
                  <React.Fragment key={s.stage}>
                    {idx > 0 && <span className="text-[#9AA7B8]">→</span>}
                    <span className={`rounded-lg border px-2 py-1 ${s.measurable ? 'border-slate-200 bg-slate-50 text-[#0B1F33]' : 'border-dashed border-slate-300 text-[#9AA7B8]'}`} title={`${s.source} · ${s.confidence}`}>
                      {s.stage.replace(/_/g, ' ')} <strong>{s.count ?? '—'}</strong>
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {onboarding.portfolio.dropoff_by_reason.map((r) => (
                  <span key={r.reason} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-[#0B1F33]">
                    {r.reason} <strong className={r.reason === 'UNKNOWN' ? 'text-[#9AA7B8]' : 'text-red-600'}>{r.count}</strong>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-[#9AA7B8]">Visibility gaps: {onboarding.portfolio.unknown_visibility_gaps.join(' · ')}</p>
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
                  <tr>{['Company', 'Plan', 'Users', 'Status', 'Readiness', 'Priority', 'Trajectory', 'Outcome', 'Impact', 'Confidence', 'Opps', 'Last activity'].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr>
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
                      <td className={`px-3 py-3 text-xs font-medium ${outcomeBadge(c.outcome_classification).cls}`} title={c.net_change != null ? `Δ ${c.net_change}` : 'insufficient history'}>{outcomeBadge(c.outcome_classification).label}{c.net_change != null && c.net_change !== 0 ? ` (${c.net_change > 0 ? '+' : ''}${c.net_change})` : ''}</td>
                      <td className={`px-3 py-3 text-xs font-medium ${impactBadge(c.impact_status).cls}`}>{impactBadge(c.impact_status).label}</td>
                      <td className={`px-3 py-3 text-xs font-medium ${confColor(c.overall_signal_confidence)}`} title={`${c.stale_sources} stale · ${c.low_confidence_sources} low · ${c.unknown_sources} unknown`}>{c.overall_signal_confidence}{c.stale_sources > 0 ? ` ⏳${c.stale_sources}` : ''}</td>
                      <td className="px-3 py-3 text-xs text-[#6B7C93]">{c.opportunity_count || '—'}</td>
                      <td className="px-3 py-3 text-[#6B7C93]">{fmt(c.last_activity_at)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={12} className="px-4 py-8 text-center text-[#6B7C93]">No companies match.</td></tr>}
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
              <Section title="Evolution">
                <Row k="Trajectory" v={`${selected.trajectory}${selected.score_delta != null ? ` (${selected.score_delta >= 0 ? '+' : ''}${selected.score_delta})` : selected.trajectory === 'UNKNOWN' ? ' (insufficient history)' : ''}`} />
                <Row k="Outcome" v={`${outcomeBadge(selected.outcome_classification).label}${selected.net_change != null ? ` (${selected.net_change >= 0 ? '+' : ''}${selected.net_change})` : ''}`} />
                <Row k="Impact" v={impactBadge(selected.impact_status).label} />
              </Section>
              <Section title="Signal confidence">
                <Row k="Overall" v={selected.overall_signal_confidence} />
                <Row k="Stale / low / unknown sources" v={`${selected.stale_sources} / ${selected.low_confidence_sources} / ${selected.unknown_sources}`} />
              </Section>
              <Section title="Integrations"><Row k="GA / GSC" v={`${state(selected.ga)} / ${state(selected.gsc)}`} /><Row k="Social / Community" v={`${state(selected.social)} / ${state(selected.community)}`} /></Section>
              <Section title="Executive insights">
                {selected.key_insight ? <Row k="Key" v={`${selected.key_insight.title} (${selected.key_insight.severity})`} /> : <p className="text-[#6B7C93]">None</p>}
                {selected.primary_blocker && <Row k="Blocker" v={selected.primary_blocker.title} />}
                {selected.primary_opportunity && <Row k="Opportunity" v={selected.primary_opportunity.title} />}
              </Section>
              <Section title="Opportunities"><Row k="Count / top severity" v={`${selected.opportunity_count} / ${selected.highest_severity ?? '—'}`} /></Section>
              <Section title="Onboarding">
                {(() => { const o = onboardingByCompany.get(selected.company_id); return o
                  ? <><Row k="Status" v={o.label} /><Row k="Blocker" v={o.reason ?? '—'} /></>
                  : <p className="text-[#6B7C93]">No onboarding record</p>; })()}
              </Section>
              <Section title="Recommended actions">
                {selected.recommended_playbooks.length ? selected.recommended_playbooks.map((p) => (
                  <Row key={p.playbook_id} k={p.playbook_name} v={`${p.confidence} · ${p.expected_value_band}`} />
                )) : <p className="text-[#6B7C93]">None (suppressed or no gaps)</p>}
              </Section>
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
