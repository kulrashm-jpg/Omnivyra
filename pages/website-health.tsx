import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useCompanyContext } from '../components/CompanyContext';
import { WebsiteExecutiveSummary, WebsiteModuleCard, WebsiteRoadmap, BusinessImpactGraph, buildWebsitePresentationModel } from '../components/websiteIntelligence';

/**
 * Website Health — pure presentation layer (Phase 18).
 *
 * Consumes ONLY the canonical Website Intelligence Repository via
 * GET /api/website-intelligence/canonical. It computes no scores, aggregates no
 * reports, builds no recommendations, derives no readiness and merges no telemetry —
 * the repository owns all of that. This file renders the snapshot, nothing more.
 * (The /api/websites call is navigation only — the website picker, not intelligence.)
 */

const PILL: Record<string, string> = {
  ready: 'bg-emerald-100 text-emerald-700', healthy: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700', warning: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
  unavailable: 'bg-gray-100 text-gray-500', disconnected: 'bg-gray-100 text-gray-500',
};

const pill = (k: string) => PILL[k] ?? PILL.unavailable;
const ago = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const t = Date.parse(iso); if (Number.isNaN(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}
function Row({ label, status, detail, source, updated }: { label: string; status: string; detail?: string | null; source?: string; updated?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-50 py-1.5 text-sm last:border-0">
      <span className="min-w-0 text-gray-700">{label}{detail ? <span className="ml-1 text-xs text-gray-400">· {detail}</span> : null}</span>
      <span className="flex shrink-0 items-center gap-2">
        {source && <span className="text-[10px] uppercase tracking-wide text-gray-400">{source}</span>}
        {updated && <span className="text-[10px] text-gray-400">{ago(updated)}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${pill(status)}`}>{status.replace('_', ' ')}</span>
      </span>
    </div>
  );
}

export default function WebsiteHealthPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';

  const [websites, setWebsites] = useState<any[]>([]);
  const [websiteId, setWebsiteId] = useState('');
  const [snap, setSnap] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/websites?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null)).then((d) => {
        const list = d?.websites ?? [];
        setWebsites(list);
        setWebsiteId((cur) => cur || list[0]?.id || '');
      }).catch(() => {});
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const q = `company_id=${encodeURIComponent(companyId)}${websiteId ? `&website_id=${encodeURIComponent(websiteId)}` : ''}`;
      const r = await fetch(`/api/website-intelligence/canonical?${q}`, { credentials: 'include' });
      setSnap(r.ok ? (await r.json()).snapshot : null);
    } catch { setSnap(null); } finally { setLoading(false); }
  }, [companyId, websiteId]);

  useEffect(() => { void load(); }, [load]);

  const health = snap?.health;
  const summary = snap?.summary;
  const modules: any[] = snap?.modules ?? [];
  const validation = snap?.validation ?? { checks: [], passed: 0, total: 0 };
  const half = Math.ceil(modules.length / 2);
  const modStatus = (key: string, fallback = 'unavailable') => modules.find((m) => m.key === key)?.status ?? fallback;
  const model = useMemo(() => (snap ? buildWebsitePresentationModel(snap) : null), [snap]);

  return (
    <>
      <Head><title>Website Health | Omnivyra</title></Head>
      <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">Website Health</p>
                <h1 className="mt-1 text-2xl font-bold text-gray-900">{snap?.website?.name || 'Operational command center'}</h1>
                <p className="text-sm text-gray-600">{snap?.website?.canonical_url}</p>
              </div>
              <div className="flex items-center gap-3">
                {websites.length > 1 && (
                  <select value={websiteId} onChange={(e) => setWebsiteId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    {websites.map((w) => <option key={w.id} value={w.id}>{w.name || w.canonical_url}</option>)}
                  </select>
                )}
                <span className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ${pill(health?.overall ?? 'unavailable')}`}>{health?.overall ?? 'unknown'}</span>
                <button onClick={() => void load()} disabled={loading} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? 'Running…' : 'Run validation'}</button>
              </div>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">{Math.round(Number(summary?.overallScore ?? 0))}<span className="text-sm font-medium text-gray-400">/100 composite</span></p>
            <p className="text-xs text-gray-400">Validation {validation.passed}/{validation.total} · intelligence updated {ago(summary?.lastIntelligenceUpdate)}</p>
          </section>

          {!companyId && <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Select a company.</div>}

          {companyId && snap && (
            <>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Section title="Integration">
                  <Row label="Domain verification" status={snap.domain?.verified ? 'ready' : 'unavailable'} detail={snap.domain?.finalDomain} source="domain" />
                  <Row label="Tracking" status={snap.tracking?.status ?? 'disconnected'} updated={snap.tracking?.lastSeenAt} source="tracking" />
                  <Row label="Website status" status={snap.website?.status === 'active' ? 'healthy' : 'warning'} detail={snap.website?.status} />
                  <Row label="Failed publishes (30d)" status={(health?.failedPublishCount ?? 0) === 0 ? 'healthy' : 'warning'} detail={`${health?.failedPublishCount ?? 0}`} />
                  {(snap.integrations ?? []).map((x: any) => (
                    <Row key={x.id} label={x.type === 'lead_webhook' ? 'Webhook' : `CMS · ${x.type}`} status={x.status === 'connected' ? 'healthy' : x.status === 'failed' ? 'warning' : 'unavailable'} detail={x.name} updated={x.lastSuccessAt} />
                  ))}
                </Section>

                <Section title="Data Collection">
                  <Row label="Last tracking event" status={snap.tracking?.active ? 'healthy' : 'disconnected'} updated={snap.tracking?.lastSeenAt} />
                  <Row label="CMS connections" status={(health?.connections?.length ?? 0) > 0 ? 'healthy' : 'disconnected'} detail={`${health?.connections?.length ?? 0}`} />
                  <Row label="Tracking health" status={modStatus('tracking')} source="health-score" />
                  <Row label="Conversion" status={modStatus('conversion')} source="health-score" />
                </Section>

                <Section title="Lead Capture">
                  <Row label="Forms" status={modStatus('forms')} source="form intel" />
                  <Row label="Lead capture ready" status={modStatus('lead_readiness', 'partial')} source="readiness" />
                  <Row label="Attribution" status={modStatus('attribution')} source="health-score" />
                  <Row label="Repository" status={modStatus('repository', 'partial')} source="lead intel" />
                </Section>

                <Section title="Tracking">
                  <Row label="Tracker installed" status={snap.tracking?.installed ? 'healthy' : 'disconnected'} />
                  <Row label="Session creation" status={snap.tracking?.active ? 'healthy' : 'disconnected'} />
                  <Row label="Attribution capture" status={modStatus('attribution')} source="health-score" />
                  <Row label="Event collection" status={snap.tracking?.active ? 'healthy' : 'disconnected'} updated={snap.tracking?.lastSeenAt} />
                </Section>
              </div>

              <Section title="Intelligence Status">
                <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                  {[modules.slice(0, half), modules.slice(half)].map((col, ci) => (
                    <div key={ci}>
                      {col.map((m: any) => <Row key={m.key} label={m.label} status={m.status} detail={!m.available ? m.detail : undefined} source={m.source !== '—' ? m.source : undefined} updated={m.lastUpdated} />)}
                    </div>
                  ))}
                </div>
              </Section>

              {model && <WebsiteExecutiveSummary summary={model.executiveSummary} />}

              <Section title="Website Intelligence Engines">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {model?.modules.map((m) => <WebsiteModuleCard key={m.key} module={m} />)}
                </div>
                <p className="mt-2 text-xs text-gray-400">Deterministic engines over crawled data — checks without stored signals are reported as gaps, never fabricated.</p>
              </Section>

              {model && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <BusinessImpactGraph businessImpact={model.businessImpact} />
                  <WebsiteRoadmap roadmap={model.roadmap} />
                </div>
              )}

              <Section title="Intelligence Summary">
                {!summary ? <p className="text-sm text-gray-500">Intelligence summary unavailable.</p> : (
                  <div className="space-y-3 text-sm">
                    <p className="text-gray-700">{summary.executiveSummary}</p>
                    <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                      {(summary.sections ?? []).map((sec: any) => (
                        <div key={sec.key} className="flex items-center justify-between border-b border-gray-50 py-1">
                          <span className="text-gray-600">{sec.label}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${pill(sec.status)}`}>{sec.status}</span>
                        </div>
                      ))}
                    </div>
                    {(summary.topRisks ?? []).length > 0 && (
                      <div><p className="font-semibold text-gray-900">Top risks</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-700">{summary.topRisks.map((r: any, i: number) => <li key={i}>{r.key} <span className="text-xs text-gray-400">({r.severity})</span></li>)}</ul></div>
                    )}
                    {(summary.recommendedActions ?? []).length > 0 && (
                      <div><p className="font-semibold text-gray-900">Recommended actions</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-700">{summary.recommendedActions.map((r: any, i: number) => <li key={i}>{r.recommendation} <span className="text-[10px] uppercase text-gray-400">· {r.source}</span></li>)}</ul></div>
                    )}
                    {(summary.topOpportunities ?? []).length > 0 && <p className="text-gray-600">Top opportunities: {summary.topOpportunities.map((p: any) => p.category).join(', ')}</p>}
                    <p className="text-xs text-gray-400">Last intelligence update {ago(summary.lastIntelligenceUpdate)} · last crawl {ago(summary.lastCrawl)} · last scan {ago(summary.lastScan)}</p>
                  </div>
                )}
              </Section>

              <Section title="Integration Diagnostics">
                {(snap.diagnostics ?? []).length === 0 ? <p className="text-sm text-gray-500">No integrations connected.</p> : (
                  <div className="space-y-2">
                    {snap.diagnostics.map((x: any) => (
                      <div key={x.id} className="rounded-xl border border-gray-100 p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-900">{x.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pill(x.status === 'connected' ? 'healthy' : x.status === 'failed' ? 'warning' : 'unavailable')}`}>{x.status}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">type {x.type} · health {x.healthState}{x.reasons?.length ? ` · ${x.reasons.join(', ')}` : ''}{x.lastError ? ` · ${x.lastError}` : ''}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="One-click Validation">
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {(validation.checks ?? []).map((v: any) => (
                    <li key={v.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-gray-700">{v.label}{v.source ? <span className="ml-1 text-[10px] uppercase text-gray-400">{v.source}</span> : null}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${v.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{v.ok ? '✓' : 'pending'}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-gray-400">Orchestrated by the Website Intelligence Repository — no validation logic in this page.</p>
              </Section>
            </>
          )}
        </div>
      </main>
    </>
  );
}
