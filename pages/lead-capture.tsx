import React, { useCallback, useEffect, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';

/**
 * Lead Capture — business-facing universal capture console.
 *
 * Plain-language guided onboarding for six capture modes (same-site form,
 * external landing page, embedded form, SPA, webhook-only, universal SDK).
 * Consumes ONLY read-only diagnostics endpoints — orchestration/queue/replay
 * terminology deliberately absent. Role-aware (CompanyContext), tenant-safe.
 */
type Tab = 'guide' | 'topology' | 'continuity' | 'landing' | 'embedded' | 'funnel' | 'forms' | 'abandonment' | 'journey' | 'lead_digest' | 'revenue' | 'diagnostics' | 'cohorts' | 'identity' | 'cms_reconciliation' | 'crm_outbound' | 'warehouse' | 'repair' | 'architecture';

// Core tabs operators actually need. Overengineered tabs (cohorts, identity,
// cms_reconciliation, crm_outbound, warehouse, repair, architecture) are
// hidden by default; the code stays on disk and the endpoints remain callable.
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'guide', label: 'How do you capture leads?' },
  { id: 'topology', label: 'Topology & integrations' },
  { id: 'continuity', label: 'Attribution continuity' },
  { id: 'landing', label: 'External landing pages' },
  { id: 'embedded', label: 'Embedded forms' },
  { id: 'funnel', label: 'Funnel intelligence' },
  { id: 'forms', label: 'Best-performing forms' },
  { id: 'abandonment', label: 'Abandoned forms' },
  { id: 'journey', label: 'Customer journey' },
  { id: 'lead_digest', label: 'Lead digest' },
  { id: 'revenue', label: 'Revenue attribution' },
  { id: 'diagnostics', label: 'Orchestration diagnostics' },
];

const TOPOLOGY_OPTIONS: Array<{ key: string; title: string; description: string }> = [
  { key: 'SAME_SITE', title: 'Same-site only', description: 'Forms live on the same domain as your content.' },
  { key: 'EXTERNAL_LANDING_PAGES', title: 'External landing pages', description: 'ClickFunnels, Leadpages, Unbounce, Instapage, HubSpot.' },
  { key: 'EMBEDDED_FORMS', title: 'Embedded forms', description: 'HubSpot, Typeform, Tally, Jotform, Calendly, Google Forms.' },
  { key: 'SPA_FUNNEL', title: 'SPA / web app', description: 'React / Vue / Angular / Next.js client-side routing.' },
  { key: 'WEBHOOK_ONLY', title: 'Webhook-only', description: 'Provider posts conversions server-to-server.' },
  { key: 'HYBRID_MULTI_SOURCE', title: 'Hybrid / multi-source', description: 'A mix of the above.' },
];

const ATTR_MODE_OPTIONS: Array<{ key: string; title: string }> = [
  { key: 'same_domain', title: 'Same-domain continuity' },
  { key: 'cross_domain', title: 'Cross-domain propagation' },
  { key: 'iframe_embed', title: 'Iframe / embed attribution' },
  { key: 'webhook_reconciliation', title: 'Webhook conversion callbacks' },
  { key: 'sdk_instrumentation', title: 'SDK instrumentation' },
];

const SDK_SNIPPET = `<script src="/omnivera-attribution.js"></script>
<script>
  OmnivyraAttribution.init({ tokenParam: '_attr', autoTagLinks: true });
</script>`;

const CAPTURE_OPTIONS = [
  { key: 'same_site', title: 'Same-site form', why: 'Forms live on your own domain.', how: 'Use the existing tracker snippet + your form posts to /api/leads. Attribution is automatic.' },
  { key: 'external_landing', title: 'External landing pages', why: 'Pages on ClickFunnels, Unbounce, Leadpages, Instapage, HubSpot, etc.', how: 'Register the page below; we append a signed _attr token to outbound links so conversions stay attributed.' },
  { key: 'embedded_form', title: 'Embedded forms', why: 'HubSpot, Typeform, Tally, Jotform, Calendly, Google Forms.', how: 'Register the form below + add the universal SDK to your page — it bridges attribution into iframes via postMessage.' },
  { key: 'spa', title: 'SPA / web app', why: 'React / Vue / Angular / Next.js app with client-side routing.', how: 'Add the universal SDK — it persists attribution across route changes (no full reload needed).' },
  { key: 'webhook', title: 'Webhook-only conversion', why: 'Your CRM / form provider notifies you via webhook.', how: 'Configure an internal handoff secret and POST conversion+attribution token to the isolated handoff endpoint.' },
  { key: 'sdk', title: 'Universal SDK', why: 'Cover all of the above in one drop-in.', how: 'Add omnivera-attribution.js to your site head.' },
];

export default function LeadCapturePage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';
  const [tab, setTab] = useState<Tab>('guide');
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string>('same_site');
  const [copied, setCopied] = useState(false);
  // Topology selection state (multi-select for HYBRID, plus attribution modes).
  const [pickedTopologies, setPickedTopologies] = useState<string[]>([]);
  const [pickedModes, setPickedModes] = useState<string[]>([]);
  const [savingTopology, setSavingTopology] = useState(false);

  const toggle = (list: string[], v: string): string[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const saveTopology = async () => {
    if (!companyId || pickedTopologies.length === 0) return;
    setSavingTopology(true);
    try {
      await fetch('/api/website-intelligence/lead-capture-topology', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, topologies: pickedTopologies, attribution_modes: pickedModes }),
      });
      void load('topology');
    } finally {
      setSavingTopology(false);
    }
  };

  const endpoints: Record<Tab, string | null> = {
    guide: null,
    topology: `/api/website-intelligence/lead-capture-topology?company_id=${encodeURIComponent(companyId)}`,
    continuity: `/api/website-intelligence/attribution-handoff?company_id=${encodeURIComponent(companyId)}`,
    landing: `/api/website-intelligence/landing-pages?company_id=${encodeURIComponent(companyId)}&view=diagnostics`,
    embedded: `/api/website-intelligence/embedded-forms?company_id=${encodeURIComponent(companyId)}&view=diagnostics`,
    funnel: `/api/website-intelligence/universal-funnel?company_id=${encodeURIComponent(companyId)}`,
    forms: `/api/website-intelligence/form-performance?company_id=${encodeURIComponent(companyId)}`,
    abandonment: `/api/website-intelligence/form-abandonment?company_id=${encodeURIComponent(companyId)}`,
    journey: `/api/website-intelligence/customer-journey?company_id=${encodeURIComponent(companyId)}`,
    lead_digest: `/api/website-intelligence/lead-digest?company_id=${encodeURIComponent(companyId)}`,
    revenue: `/api/website-intelligence/revenue-attribution?company_id=${encodeURIComponent(companyId)}`,
    diagnostics: `/api/website-intelligence/orchestration-diagnostics?company_id=${encodeURIComponent(companyId)}`,
    cohorts: `/api/website-intelligence/cohort-funnel?company_id=${encodeURIComponent(companyId)}&kind=session`,
    identity: `/api/website-intelligence/identity-continuity?company_id=${encodeURIComponent(companyId)}`,
    cms_reconciliation: `/api/website-intelligence/cms-reconciliation?company_id=${encodeURIComponent(companyId)}`,
    crm_outbound: `/api/website-intelligence/outbound-crm-sync?company_id=${encodeURIComponent(companyId)}`,
    warehouse: `/api/website-intelligence/warehouse-export?company_id=${encodeURIComponent(companyId)}`,
    repair: `/api/website-intelligence/repair-plan?company_id=${encodeURIComponent(companyId)}`,
    architecture: null,
  };

  const load = useCallback(async (t: Tab) => {
    if (!companyId || !endpoints[t]) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(endpoints[t] as string, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load');
      setData((d) => ({ ...d, [t]: json }));
    } catch (e: any) { setError(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => { void load(tab); /* eslint-disable-next-line */ }, [tab, companyId]);

  const cur = data[tab];
  const [activation, setActivation] = useState<{ activated: boolean; checks: Array<{ id: string; label: string; done: boolean; detail: string; nextActionHref: string; nextActionLabel: string }> } | null>(null);
  const [observability, setObservability] = useState<{ axes: Array<{ id: string; label: string; status: string; detail: string; nextActionHref?: string; nextActionLabel?: string }>; publishTimeline: Array<{ at: string; provider: string; status: string; message: string | null }> } | null>(null);
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/activation/readiness?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json) setActivation(json);
      } catch { /* silent */ }
    })();
    (async () => {
      try {
        const res = await fetch(`/api/website-intelligence/operator-observability?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json) setObservability(json);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const copySdk = async () => {
    try { await navigator.clipboard?.writeText(SDK_SNIPPET); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked */ }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Capture leads from anywhere</h1>
          <p className="mt-1 text-sm text-gray-600">Same-site forms, external landing pages, embedded forms, web apps, or webhook providers — pick what matches your setup.</p>
        </header>

        {!companyId && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Select a company.</div>}

        {observability && (
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
            <div className="flex items-center justify-between">
              <strong className="text-gray-800">Operator observability (7d)</strong>
              <span className="text-[11px] text-gray-500">{observability.axes.filter((a) => a.status === 'healthy').length}/{observability.axes.length} healthy</span>
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-5">
              {observability.axes.map((a) => (
                <li key={a.id} className={`rounded-lg border p-2 ${
                  a.status === 'healthy' ? 'border-emerald-200 bg-emerald-50' :
                  a.status === 'warning' ? 'border-amber-200 bg-amber-50' :
                  a.status === 'degraded' ? 'border-red-200 bg-red-50' :
                  'border-gray-200 bg-gray-50'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.label}</span>
                    <span className="text-[10px] uppercase tracking-wider opacity-70">{a.status}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-700">{a.detail}</p>
                  {a.nextActionHref && <a href={a.nextActionHref} className="mt-0.5 inline-block text-[11px] text-indigo-700 underline">{a.nextActionLabel ?? 'Inspect'}</a>}
                </li>
              ))}
            </ul>
            {observability.publishTimeline.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] font-medium text-gray-600">Recent publish events ({observability.publishTimeline.length})</summary>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-[11px]">
                  {observability.publishTimeline.map((t, i) => (
                    <li key={i} className="flex items-center justify-between border-b border-gray-100 py-0.5">
                      <span><strong>{t.provider}</strong> · <span className={t.status === 'published' ? 'text-emerald-700' : t.status === 'failed' || t.status === 'dead_letter' ? 'text-red-700' : 'text-amber-700'}>{t.status}</span></span>
                      <span className="text-gray-500">{new Date(t.at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {activation && (
          <div className={`rounded-xl border p-3 text-sm ${activation.activated ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            <div className="flex items-center justify-between">
              <strong>{activation.activated ? 'Activation complete' : 'Activation in progress'}</strong>
              <span className="text-[11px]">{activation.checks.filter((c) => c.done).length}/{activation.checks.length} steps done</span>
            </div>
            {!activation.activated && (
              <ul className="mt-2 grid grid-cols-1 gap-1 text-[12px] sm:grid-cols-3">
                {activation.checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-1.5">
                    <span className={c.done ? 'text-emerald-600' : 'text-amber-700'}>{c.done ? '✓' : '○'}</span>
                    <span>
                      <span className="font-medium">{c.label}</span>
                      {!c.done && (
                        <>
                          {' '}— <a href={c.nextActionHref} className="underline">{c.nextActionLabel}</a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${tab === t.id ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {loading && <div className="py-8 text-center text-sm text-gray-500">Loading…</div>}

        {tab === 'guide' && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p className="text-gray-600">Pick what best describes how your leads come in. We'll show what to do next.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CAPTURE_OPTIONS.map((o) => (
                <button key={o.key} onClick={() => setSelected(o.key)}
                  className={`rounded-lg border p-3 text-left ${selected === o.key ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="font-semibold text-gray-900">{o.title}</div>
                  <div className="mt-1 text-xs text-gray-500">{o.why}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
              <p className="font-medium text-gray-800">Next step:</p>
              <p className="mt-1 text-gray-700">{CAPTURE_OPTIONS.find((o) => o.key === selected)?.how}</p>
              {(selected === 'sdk' || selected === 'spa' || selected === 'embedded_form' || selected === 'external_landing') && (
                <div className="mt-3">
                  <p className="font-medium text-gray-800">Universal SDK snippet</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 text-[11px] text-emerald-300">{SDK_SNIPPET}</pre>
                  <button onClick={copySdk} className="mt-1 rounded border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-700">{copied ? 'Copied' : 'Copy snippet'}</button>
                </div>
              )}
            </div>
          </section>
        )}

        {!loading && tab === 'topology' && cur && (
          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <div>
              <h2 className="font-semibold">Your topology</h2>
              <p className="mt-1 text-xs text-gray-500">
                Tell us where your leads come from. We'll show only the integrations that apply.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {TOPOLOGY_OPTIONS.map((t) => {
                  const on = pickedTopologies.includes(t.key);
                  return (
                    <button key={t.key} type="button" onClick={() => setPickedTopologies((s) => toggle(s, t.key))}
                      className={`rounded-lg border p-3 text-left ${on ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{t.title}</span>
                        <span className="text-xs text-gray-500">{on ? '✓' : ''}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">{t.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="font-semibold">Attribution continuity modes</h3>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ATTR_MODE_OPTIONS.map((m) => {
                  const on = pickedModes.includes(m.key);
                  return (
                    <button key={m.key} type="button" onClick={() => setPickedModes((s) => toggle(s, m.key))}
                      className={`rounded-lg border p-2 text-left text-xs ${on ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                      <span className="font-medium">{m.title}</span>
                      {on && <span className="float-right">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={saveTopology} disabled={savingTopology || pickedTopologies.length === 0}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {savingTopology ? 'Saving…' : 'Save topology'}
              </button>
              {cur.topology && (
                <span className="text-xs text-gray-500">
                  Current: <strong>{(cur.topology.topologies ?? []).join(', ')}</strong>
                </span>
              )}
            </div>

            {(cur.integrationOptions ?? []).length > 0 && (
              <div>
                <h3 className="font-semibold">Recommended integrations for your topology</h3>
                <ul className="mt-2 space-y-1 text-xs">
                  {(cur.integrationOptions ?? []).map((o: any) => (
                    <li key={o.key} className="flex justify-between border-b border-gray-100 py-1">
                      <span>
                        <strong>{o.title}</strong> — {o.description}
                      </span>
                      {o.href && <a href={o.href} className="ml-2 shrink-0 text-indigo-600">Open →</a>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
              <p>
                Setup completeness: <strong>{cur.completenessScore}%</strong>
              </p>
              {(cur.attributionGapWarnings ?? []).length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-700">
                  {(cur.attributionGapWarnings ?? []).map((w: string, i: number) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {(cur.recommendedNextActions ?? []).length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-emerald-700">
                  {(cur.recommendedNextActions ?? []).map((a: string, i: number) => <li key={i}>{a}</li>)}
                </ul>
              )}
            </div>
          </section>
        )}

        {!loading && tab === 'continuity' && cur && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              Cross-domain attribution: <strong className={cur.configured ? 'text-emerald-600' : 'text-amber-600'}>{cur.configured ? 'configured' : 'not configured (set CROSS_DOMAIN_ATTR_SECRET)'}</strong>
            </p>
            <p>Issued (24h) <strong>{cur.issued24h}</strong> · Verified <strong>{cur.verified24h}</strong> · Tampered <strong className="text-red-600">{cur.tampered24h}</strong></p>
            <p>Continuity rate: <strong>{(cur.continuityRate * 100).toFixed(1)}%</strong></p>
          </section>
        )}

        {!loading && tab === 'landing' && cur && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>Registered: <strong>{cur.registered}</strong> · Known-page handoffs (24h): <strong>{cur.handoffsToKnownPages24h}</strong> · Orphan conversions: <strong className={cur.orphanConversions24h > 0 ? 'text-amber-600' : 'text-emerald-600'}>{cur.orphanConversions24h}</strong></p>
            <p className="mt-1 text-gray-500">{cur.detail}</p>
          </section>
        )}

        {!loading && tab === 'embedded' && cur && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>Registered: <strong>{cur.registered}</strong> · Handoffs (24h): <strong>{cur.handoffsRecorded24h}</strong> · Duplicates: <strong className={cur.duplicateHandoffs24h > 0 ? 'text-amber-600' : 'text-emerald-600'}>{cur.duplicateHandoffs24h}</strong></p>
            <p className="mt-1 text-gray-500">{cur.detail}</p>
          </section>
        )}

        {!loading && tab === 'funnel' && cur && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>30-day funnel · attribution-break rate <strong className={cur.attributionBreakRate > 0.2 ? 'text-amber-600' : 'text-emerald-600'}>{(cur.attributionBreakRate * 100).toFixed(1)}%</strong> · bottleneck <strong>{cur.bottleneckStage ?? '—'}</strong></p>
            <ul className="mt-2 space-y-1 text-xs">
              {(cur.stages ?? []).map((s: any) => (
                <li key={s.stage} className="flex justify-between border-b border-gray-100 py-1">
                  <span>{s.stage}</span>
                  <span>{s.count} {s.dropFromPrev > 0 ? `· ↓${(s.dropFromPrev * 100).toFixed(0)}%` : ''}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && tab === 'journey' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              30-day journey · <strong>{cur.totalLeads}</strong> leads · <strong>{cur.attributedLeads}</strong> with attributed touch path
            </p>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
              <p className="font-medium text-gray-800">Touch path coverage by source</p>
              <ul className="mt-1 space-y-0.5">
                {Object.entries((cur.bySource ?? {}) as Record<string, number>).map(([src, n]) => (
                  <li key={src} className="flex justify-between border-b border-gray-100 py-0.5">
                    <span>{src}</span><span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-gray-800">Recent journeys (multi-touch credit, 4 models)</p>
              <ul className="mt-1 space-y-2 text-xs">
                {(cur.journeys ?? []).slice(0, 10).map((j: any) => (
                  <li key={j.leadId} className="rounded border border-gray-100 p-2">
                    <div className="flex justify-between"><span><strong>{j.leadId}</strong></span><span className="text-gray-500">{j.touches.length} touch(es)</span></div>
                    <div className="mt-1 text-[11px] text-gray-600">
                      first_touch · last_touch · linear · time_decay credit distributions in <code>cur.journeys[i].credits</code>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && tab === 'revenue' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              30-day revenue · <strong>${(cur.totalRevenueUsd ?? 0).toLocaleString()}</strong> across <strong>{cur.revenueEvents}</strong> event(s) · attribution rate <strong>{((cur.attributionRate ?? 0) * 100).toFixed(0)}%</strong>
            </p>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
              <p className="font-medium text-gray-800">By provider</p>
              <ul className="mt-1 space-y-0.5">
                {Object.entries((cur.byProvider ?? {}) as Record<string, { count: number; revenue: number }>).map(([p, agg]) => (
                  <li key={p} className="flex justify-between border-b border-gray-100 py-0.5">
                    <span>{p}</span>
                    <span>{agg.count} · ${agg.revenue.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-gray-500">
              Outbound CRM API: <strong>{cur.outboundCapability ?? 'not_configured'}</strong> · inbound webhook handoff is isolated and HMAC-gated.
            </p>
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && tab === 'cohorts' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              30-day cohort funnels (session-keyed) · <strong>{cur.totalCohorts}</strong> cohorts · <strong>{cur.totalLeads}</strong> leads · <strong>${(cur.totalRevenueUsd ?? 0).toLocaleString()}</strong> revenue
            </p>
            <ul className="mt-2 space-y-2 text-xs">
              {(cur.cohorts ?? []).slice(0, 10).map((c: any) => (
                <li key={c.cohortId} className="rounded border border-gray-100 p-2">
                  <div className="flex justify-between"><span><strong>{c.key}</strong> ({c.size} signals)</span><span className="text-gray-500">conf {c.confidence}</span></div>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {(c.stages ?? []).map((s: any) => (
                      <li key={s.stage} className="rounded bg-gray-50 px-2 py-0.5 text-[11px]">
                        {s.stage}: {s.count}{s.dropFromPrev > 0 ? ` ↓${(s.dropFromPrev * 100).toFixed(0)}%` : ''}
                      </li>
                    ))}
                  </ul>
                  {c.bottleneckStage && <div className="mt-1 text-[11px] text-amber-700">bottleneck: {c.bottleneckStage}</div>}
                  {c.attributionBreaks > 0 && <div className="text-[11px] text-amber-700">attribution breaks: {c.attributionBreaks}</div>}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && tab === 'identity' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              30-day identity continuity · <strong>{cur.totalClusters}</strong> clusters · <strong>{cur.multiSignalClusters}</strong> multi-signal · drift flags <strong className={cur.driftFlags?.length > 0 ? 'text-amber-600' : 'text-emerald-600'}>{cur.driftFlags?.length ?? 0}</strong>
            </p>
            {(cur.driftFlags ?? []).length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-700">
                {(cur.driftFlags ?? []).map((f: any, i: number) => <li key={i}><strong>{f.clusterId}</strong> — {f.reason}</li>)}
              </ul>
            )}
            <ul className="mt-2 space-y-2 text-xs">
              {(cur.clusters ?? []).slice(0, 10).map((cl: any) => (
                <li key={cl.clusterId} className="rounded border border-gray-100 p-2">
                  <div className="flex justify-between"><span><strong>{cl.clusterId}</strong></span><span className="text-gray-500">conf {cl.confidence}</span></div>
                  <div className="mt-1 text-[11px] text-gray-600">leads: {cl.leads.length} · sessions: {cl.sessions.length} · devices: {cl.devices.length} · nonces: {cl.attributionNonces.length}</div>
                  <ul className="mt-1 space-y-0.5">
                    {(cl.edges ?? []).slice(0, 4).map((e: any, i: number) => <li key={i} className="text-[10px] text-gray-500">{e.kind}: {e.evidence}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && tab === 'cms_reconciliation' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              CMS reconciliation · drift <strong className={cur.driftDetected > 0 ? 'text-amber-600' : 'text-emerald-600'}>{cur.driftDetected}</strong> event(s)
            </p>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
              <p className="font-medium text-gray-800">By kind</p>
              <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {Object.entries((cur.byKind ?? {}) as Record<string, number>).map(([k, n]) => (
                  <li key={k} className="flex justify-between"><span>{k}</span><span className={n > 0 ? 'text-amber-700 font-semibold' : 'text-gray-400'}>{n}</span></li>
                ))}
              </ul>
            </div>
            {(cur.recentLineage ?? []).length > 0 && (
              <div>
                <p className="font-medium text-gray-800">Recent lineage</p>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto text-[11px]">
                  {(cur.recentLineage ?? []).slice(0, 20).map((r: any, i: number) => (
                    <li key={i} className="border-b border-gray-100 py-0.5">
                      <span className="text-gray-500">{new Date(r.at).toLocaleString()}</span> · <strong>{r.action}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && tab === 'crm_outbound' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              30-day outbound CRM sync · <strong>{cur.totalEvents}</strong> events · <strong className="text-emerald-700">{cur.syncedEvents}</strong> synced · <strong className="text-red-700">{cur.failedEvents}</strong> failed
            </p>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
              <p className="font-medium text-gray-800">Capability flags</p>
              <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {Object.entries((cur.capabilityFlags ?? {}) as Record<string, boolean>).map(([k, v]) => (
                  <li key={k} className="flex justify-between"><span>{k}</span><span className={v ? 'text-emerald-700' : 'text-gray-400'}>{v ? 'configured' : 'not configured'}</span></li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && tab === 'warehouse' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              Warehouse export · destination <strong>{cur.configuredDestination}</strong> · datasets {(cur.datasets ?? []).join(', ')}
            </p>
            {(cur.recentJobs ?? []).length > 0 && (
              <div>
                <p className="font-medium text-gray-800">Recent jobs (30d)</p>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto text-[11px]">
                  {(cur.recentJobs ?? []).slice(0, 20).map((j: any, i: number) => (
                    <li key={i} className="flex justify-between border-b border-gray-100 py-0.5">
                      <span>{new Date(j.at).toLocaleString()} · <strong>{j.dataset}</strong> → {j.destination}</span>
                      <span className={j.status === 'completed' ? 'text-emerald-700' : j.status === 'failed' ? 'text-red-700' : 'text-gray-500'}>{j.status} · {j.rowCount} rows</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && tab === 'repair' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              Repair plan · <strong className="text-red-700">{cur.recommendationsHigh}</strong> high · <strong className="text-amber-700">{cur.recommendationsMedium}</strong> medium · <strong className="text-gray-700">{cur.recommendationsLow}</strong> low
            </p>
            <ul className="mt-2 space-y-2 text-xs">
              {(cur.recommendations ?? []).map((r: any) => (
                <li key={r.id} className="rounded border border-gray-100 p-2">
                  <div className="flex items-center justify-between">
                    <span><span className={r.priority === 'high' ? 'rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700' : r.priority === 'medium' ? 'rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700' : 'rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700'}>{r.priority}</span> <strong className="ml-2">{r.label}</strong></span>
                    <span className="text-[10px] text-gray-400">{r.category}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-600">{r.detail}</div>
                  <div className="mt-0.5 text-[11px] text-indigo-700">{r.nextAction}{r.remediationHref ? <> · <a href={r.remediationHref} className="underline">Open</a></> : null}</div>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && tab === 'forms' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              Best-performing forms · <strong>{(cur.rows ?? []).length}</strong> form-day(s) in window {cur.from} → {cur.to}
            </p>
            <ul className="mt-2 space-y-2 text-xs">
              {(() => {
                const agg = new Map<string, { impressions: number; starts: number; submissions: number; abandonments: number; ctaToSubmit: number }>();
                for (const r of (cur.rows ?? []) as Array<{ form_id: string; impressions: number; starts: number; submissions: number; abandonments: number; cta_to_submit_count: number }>) {
                  const key = String(r.form_id);
                  const cur2 = agg.get(key) ?? { impressions: 0, starts: 0, submissions: 0, abandonments: 0, ctaToSubmit: 0 };
                  cur2.impressions += Number(r.impressions ?? 0);
                  cur2.starts += Number(r.starts ?? 0);
                  cur2.submissions += Number(r.submissions ?? 0);
                  cur2.abandonments += Number(r.abandonments ?? 0);
                  cur2.ctaToSubmit += Number(r.cta_to_submit_count ?? 0);
                  agg.set(key, cur2);
                }
                const ranked = [...agg.entries()].map(([formId, v]) => ({
                  formId,
                  ...v,
                  conversionRate: v.starts > 0 ? v.submissions / v.starts : 0,
                  abandonmentRate: v.starts > 0 ? v.abandonments / v.starts : 0,
                })).sort((a, b) => b.submissions - a.submissions).slice(0, 25);
                return ranked.map((r) => (
                  <li key={r.formId} className="rounded border border-gray-100 p-2">
                    <div className="flex items-center justify-between">
                      <span><strong>{r.formId}</strong></span>
                      <span className="text-[10px] text-gray-500">{r.impressions} impressions · {r.starts} starts</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700"><strong>{r.submissions}</strong> submits · {(r.conversionRate * 100).toFixed(1)}%</span>
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700"><strong>{r.abandonments}</strong> abandons · {(r.abandonmentRate * 100).toFixed(1)}%</span>
                      <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">CTA→submit: {r.ctaToSubmit}</span>
                    </div>
                  </li>
                ));
              })()}
            </ul>
            {(cur.rows ?? []).length === 0 && <p className="text-xs text-gray-500">No form events recorded yet in this window.</p>}
          </section>
        )}

        {!loading && tab === 'lead_digest' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              30-day lead digest · <strong>{cur.totalLeads}</strong> leads · advisory-only suggestions below
            </p>
            {(cur.practicalSuggestions ?? []).length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-lg border border-indigo-100 bg-indigo-50 p-3 pl-6 text-[12px] text-indigo-900">
                {(cur.practicalSuggestions ?? []).map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ul>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
                <p className="font-medium text-gray-800">Top campaigns</p>
                <ul className="mt-1 space-y-0.5">
                  {(cur.topCampaigns ?? []).map((c: any, i: number) => (
                    <li key={i} className="flex justify-between border-b border-gray-100 py-0.5">
                      <span>{c.campaign}<span className="ml-1 text-[10px] text-gray-500">{c.source ?? ''}{c.medium ? '/' + c.medium : ''}</span></span>
                      <span>{c.leads} leads · {(c.conversionRate * 100).toFixed(1)}%</span>
                    </li>
                  ))}
                  {(cur.topCampaigns ?? []).length === 0 && <li className="text-gray-500">No campaign data yet.</li>}
                </ul>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
                <p className="font-medium text-gray-800">Top landing pages</p>
                <ul className="mt-1 space-y-0.5">
                  {(cur.topLandingPages ?? []).map((p: any, i: number) => (
                    <li key={i} className="flex justify-between border-b border-gray-100 py-0.5">
                      <span className="truncate">{p.pageUrl}</span>
                      <span>{p.leads}/{p.sessions} · {(p.conversionRate * 100).toFixed(1)}%</span>
                    </li>
                  ))}
                  {(cur.topLandingPages ?? []).length === 0 && <li className="text-gray-500">No landing-page data yet.</li>}
                </ul>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
                <p className="font-medium text-gray-800">High-dropoff pages</p>
                <ul className="mt-1 space-y-0.5">
                  {(cur.highDropoffPages ?? []).map((p: any, i: number) => (
                    <li key={i} className="flex justify-between border-b border-gray-100 py-0.5">
                      <span className="truncate">{p.pageUrl}</span>
                      <span className="text-red-700">{p.abandoned}/{p.pageviews} · {(p.abandonmentRate * 100).toFixed(0)}%</span>
                    </li>
                  ))}
                  {(cur.highDropoffPages ?? []).length === 0 && <li className="text-gray-500">No high-dropoff pages.</li>}
                </ul>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
                <p className="font-medium text-gray-800">Lead sources</p>
                <ul className="mt-1 space-y-0.5">
                  {(cur.leadSourceComparison ?? []).map((s: any, i: number) => (
                    <li key={i} className="flex justify-between border-b border-gray-100 py-0.5">
                      <span>{s.source}</span>
                      <span>{s.leads} · {(s.share * 100).toFixed(0)}%</span>
                    </li>
                  ))}
                  {(cur.leadSourceComparison ?? []).length === 0 && <li className="text-gray-500">No leads yet.</li>}
                </ul>
              </div>
            </div>
          </section>
        )}

        {!loading && tab === 'abandonment' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              30-day abandoned forms · <strong>{cur.totalForms ?? 0}</strong> form(s) with starts; sorted by abandoned sessions desc.
            </p>
            <ul className="mt-2 space-y-2 text-xs">
              {((cur.forms ?? []) as Array<any>).slice(0, 25).map((f: any) => (
                <li key={f.formId} className="rounded border border-gray-100 p-2">
                  <div className="flex items-center justify-between">
                    <span><strong>{f.formId}</strong></span>
                    <span className={f.abandonmentRate > 0.5 ? 'text-red-700' : f.abandonmentRate > 0.3 ? 'text-amber-700' : 'text-emerald-700'}>
                      {(f.abandonmentRate * 100).toFixed(1)}% abandoned
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-600">
                    starts {f.starts} · submits {f.submits} · abandoned {f.abandoned}
                    {f.topAbandonedField && <> · last field touched: <code>{f.topAbandonedField}</code></>}
                  </div>
                  {(f.pages ?? []).length > 0 && (
                    <div className="mt-1 text-[11px] text-gray-500">
                      Top dropoff pages: {(f.pages as Array<{ pageUrl: string; abandoned: number }>).slice(0, 3).map((p) => `${p.pageUrl} (${p.abandoned})`).join(' · ')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {(cur.forms ?? []).length === 0 && <p className="text-xs text-gray-500">No form_start events without form_submit in the window — nothing to report.</p>}
          </section>
        )}

        {tab === 'architecture' && (
          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p className="text-xs text-gray-600">
              Visual integration architecture — deterministic, role-aware, mobile-safe (no canvas; pure HTML/CSS so it exports as PDF/print).
            </p>
            <div>
              <h3 className="font-semibold">CMS → Landing → Form → CRM flow</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                {['CMS', 'Landing page', 'Form / SDK', 'Lead', 'Cohort funnel', 'CRM revenue'].map((stage, i) => (
                  <React.Fragment key={stage}>
                    <span className="rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">{stage}</span>
                    {i < 5 && <span className="text-gray-400">→</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold">Attribution chain</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                {['_attr token issued', 'Cross-domain handoff', 'Verified on conversion', 'Lead lineage', 'Revenue lineage'].map((stage, i) => (
                  <React.Fragment key={stage}>
                    <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">{stage}</span>
                    {i < 4 && <span className="text-gray-400">→</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold">Topology architecture</h3>
              <ul className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                {TOPOLOGY_OPTIONS.map((t) => (
                  <li key={t.key} className="rounded border border-gray-200 bg-gray-50 p-2">
                    <strong>{t.title}</strong>
                    <div className="text-gray-500">{t.description}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold">Integration health map</h3>
              <p className="text-[11px] text-gray-500">Live signal: see the Repair plan tab for prioritised drift events.</p>
            </div>
            <p className="text-[11px] text-gray-400">
              The architecture map is a deterministic static rendering of the topology, attribution chain, and integration roles. Live health data is sourced from the Repair plan + Orchestration diagnostics tabs.
            </p>
          </section>
        )}

        {!loading && tab === 'diagnostics' && cur && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              Composed completeness · <strong className={cur.overallScore >= 80 ? 'text-emerald-600' : cur.overallScore >= 50 ? 'text-amber-600' : 'text-red-600'}>{cur.overallScore}/100</strong> · drift {cur.driftDetected ? <strong className="text-amber-600">detected</strong> : <strong className="text-emerald-600">none</strong>}
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {(cur.checks ?? []).map((c: any) => (
                <li key={c.id} className="rounded border border-gray-100 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.label}</span>
                    <span className={
                      c.status === 'pass' ? 'text-emerald-600' :
                      c.status === 'warn' ? 'text-amber-600' :
                      c.status === 'fail' ? 'text-red-600' :
                      'text-gray-400'
                    }>{c.status}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-600">{c.detail}</div>
                  {c.repairGuidance && <div className="mt-0.5 text-[11px] text-indigo-600">{c.repairGuidance}</div>}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}
      </div>
    </main>
  );
}
