import React, { useCallback, useEffect, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';

/**
 * Enterprise Control Center — READ-ONLY console.
 *
 * Consumes ONLY existing endpoints (no new data layer):
 *   - /api/website-intelligence/enterprise-readiness
 *   - /api/website-intelligence/replay-control (GET dead-letters)
 *   - /api/website-intelligence/security-telemetry
 *   - /api/website-intelligence/oauth-lifecycle (GET diagnostics)
 *   - /api/website-intelligence/intelligence-diagnostics
 * Role-aware (company context), tenant-safe (company_id scoped), mobile-safe.
 */
type Tab = 'operations' | 'replay' | 'security' | 'publishing' | 'load' | 'workers' | 'credentials' | 'lineage' | 'maturity' | 'liveness' | 'predictions';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'operations', label: 'Operations' },
  { id: 'replay', label: 'Replay & Recovery' },
  { id: 'security', label: 'Security & OAuth' },
  { id: 'publishing', label: 'Publishing' },
  { id: 'load', label: 'Load & Resilience' },
  { id: 'workers', label: 'Workers' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'lineage', label: 'Replay Lineage' },
  { id: 'maturity', label: 'Maturity Trend' },
  { id: 'liveness', label: 'Liveness' },
  { id: 'predictions', label: 'Predictions' },
];

export default function OpsCenterPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';
  const [tab, setTab] = useState<Tab>('operations');
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const endpoints: Record<Tab, { url: string; method?: 'GET' | 'POST'; body?: any }> = {
    operations: { url: `/api/website-intelligence/enterprise-readiness?company_id=${encodeURIComponent(companyId)}` },
    replay: { url: `/api/website-intelligence/replay-control?company_id=${encodeURIComponent(companyId)}` },
    security: { url: `/api/website-intelligence/security-telemetry?company_id=${encodeURIComponent(companyId)}` },
    publishing: { url: `/api/website-intelligence/intelligence-diagnostics?company_id=${encodeURIComponent(companyId)}` },
    load: { url: `/api/website-intelligence/scale-validation`, method: 'POST', body: { company_id: companyId } },
    workers: { url: `/api/website-intelligence/worker-orchestration?company_id=${encodeURIComponent(companyId)}` },
    credentials: { url: `/api/website-intelligence/credential-rotation?company_id=${encodeURIComponent(companyId)}` },
    lineage: { url: `/api/website-intelligence/replay-lineage?company_id=${encodeURIComponent(companyId)}` },
    maturity: { url: `/api/website-intelligence/maturity-history?company_id=${encodeURIComponent(companyId)}` },
    liveness: { url: `/api/website-intelligence/worker-liveness?company_id=${encodeURIComponent(companyId)}` },
    predictions: { url: `/api/website-intelligence/predictive-ops?company_id=${encodeURIComponent(companyId)}` },
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data[tab] ?? {}, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ops-${tab}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const load = useCallback(async (t: Tab) => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const ep = endpoints[t];
      const res = await fetch(ep.url, {
        method: ep.method ?? 'GET',
        credentials: 'include',
        headers: ep.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.method === 'POST' ? JSON.stringify(ep.body ?? {}) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Request failed');
      setData((d) => ({ ...d, [t]: json }));
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => { void load(tab); /* eslint-disable-next-line */ }, [tab, companyId]);

  const cur = data[tab];

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Operations Center</h1>
          <p className="mt-1 text-sm text-gray-600">Read-only enterprise operational view. Admin / super-admin only.</p>
        </header>

        {!companyId && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Select a company.</div>
        )}

        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${
                tab === t.id ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => load(tab)}
            className="ml-auto rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600"
          >
            Refresh
          </button>
          <button
            onClick={exportJson}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600"
          >
            Export
          </button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {loading && <div className="py-8 text-center text-sm text-gray-500">Loading…</div>}

        {!loading && cur && tab === 'operations' && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <Grade label="Final maturity" value={cur.grades?.finalEnterpriseMaturityGrade ?? cur.maturityBand} />
            <Grade label="Scalability" value={cur.grades?.scalabilityReadinessGrade} />
            <Grade label="AI maturity" value={cur.grades?.aiMaturityGrade} />
            <Grade label="Security automation" value={cur.grades?.securityAutomationGrade} />
            <p className="text-xs text-gray-500">Maturity score: <strong>{cur.operationalMaturityScore}</strong> · rollout: <strong>{cur.rolloutRecommendation}</strong></p>
            <BlockerList items={cur.unresolvedCriticalBlockers ?? cur.unresolvedEnterpriseBlockers} />
          </section>
        )}

        {!loading && cur && tab === 'replay' && (
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Dead-letter records</h2>
            {(cur.deadLetters ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No dead-letter records.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {(cur.deadLetters ?? []).slice(0, 50).map((d: any, i: number) => (
                  <li key={i} className="rounded border border-gray-100 p-2">
                    <span className="font-medium">{d.target}</span> · {d.source} · <span className="text-gray-500">{d.dedupeKey}</span>
                    <div className="text-gray-500">{d.at}</div>
                  </li>
                ))}
              </ul>
            )}
            <h2 className="mb-2 mt-4 text-sm font-semibold text-gray-900">Captured replay payloads</h2>
            {(cur.replayPayloads ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">None (or capture tables not yet migrated — using audit fallback).</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {(cur.replayPayloads ?? []).slice(0, 50).map((p: any) => (
                  <li key={p.id} className="flex justify-between rounded border border-gray-100 p-2">
                    <span>{p.target} · {p.source}</span>
                    <span className="text-gray-500">{p.status} · attempts {p.attempts}</span>
                  </li>
                ))}
              </ul>
            )}
            <h2 className="mb-2 mt-4 text-sm font-semibold text-gray-900">Quarantine</h2>
            <p className="text-sm text-gray-500">{(cur.quarantine ?? []).length} quarantined payload(s) — never executed.</p>
          </section>
        )}

        {!loading && cur && tab === 'security' && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>Replay volume (24h): <strong>{cur.replayVolume}</strong> · dead-letters: <strong>{cur.deadLetterVolume}</strong> · auth-failure events: <strong>{cur.authFailureEvents}</strong></p>
            {cur.replayAbuseSuspected && <p className="text-red-700">⚠ Replay abuse suspected.</p>}
            <div>
              <h3 className="mb-1 font-semibold text-gray-900">Connection trust</h3>
              {(cur.connections ?? []).map((c: any) => (
                <div key={c.connectionId} className="flex justify-between border-b border-gray-100 py-1">
                  <span>{c.provider}</span>
                  <span className={c.trustScore < 50 ? 'text-red-600' : 'text-emerald-600'}>{c.trustScore}</span>
                </div>
              ))}
            </div>
            <BlockerList items={(cur.advisories ?? [])} title="Advisories" />
          </section>
        )}

        {!loading && cur && tab === 'publishing' && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>Tracking: <strong>{cur.tracking?.overall ?? 'n/a'}</strong></p>
            <p>Attribution confidence: <strong>{cur.attribution?.attributionConfidence ?? 'n/a'}%</strong></p>
            <p>Ingestion delivery confidence: <strong>{cur.leadIngestion?.deliveryConfidence ?? 'n/a'}%</strong></p>
          </section>
        )}

        {!loading && cur && tab === 'load' && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <div className="flex items-center justify-between">
              <p>Deterministic resilience suite (seed {cur.seed}) — isolated, no production mutation.</p>
              <button onClick={() => load('load')} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">Re-run</button>
            </div>
            <p>Overall: <strong className={cur.overallPassed ? 'text-emerald-600' : 'text-red-600'}>{cur.overallPassed ? 'PASS' : 'FAIL'}</strong> · {cur.summary?.passed}/{cur.summary?.total} scenarios</p>
            <ul className="space-y-1 text-xs">
              {(cur.scenarios ?? []).map((s: any) => (
                <li key={s.scenario} className="flex justify-between border-b border-gray-100 py-1">
                  <span>{s.scenario}</span>
                  <span className={s.passed ? 'text-emerald-600' : 'text-red-600'}>{s.passed ? 'pass' : 'fail'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && cur && tab === 'workers' && (
          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <div className="flex items-center justify-between">
              <p>Worker health (atomic-leased, heartbeat-tracked).</p>
              <button
                onClick={async () => {
                  await fetch('/api/website-intelligence/worker-orchestration', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ company_id: companyId }),
                  });
                  void load('workers');
                }}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Run coordinated pass
              </button>
            </div>
            {(cur.workers ?? []).length === 0 ? (
              <p className="text-gray-500">No worker heartbeats yet.</p>
            ) : (
              (cur.workers ?? []).map((w: any) => (
                <div key={w.worker_id} className="flex justify-between border-b border-gray-100 py-1 text-xs">
                  <span>{w.worker_type}</span>
                  <span className={w.status === 'healthy' ? 'text-emerald-600' : 'text-red-600'}>
                    {w.status} · {new Date(w.heartbeat_at).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </section>
        )}

        {!loading && cur && tab === 'credentials' && (
          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <div className="flex items-center justify-between">
              <p>Credential rotation candidates (real OAuth refresh; approval-gated).</p>
              <button
                onClick={async () => {
                  await fetch('/api/website-intelligence/credential-rotation', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ company_id: companyId }), // dry-run (no approve)
                  });
                  void load('credentials');
                }}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Dry-run rotation
              </button>
            </div>
            {(cur.candidates ?? []).length === 0 ? (
              <p className="text-gray-500">No credentials need rotation.</p>
            ) : (
              (cur.candidates ?? []).map((c: any) => (
                <div key={c.connectionId} className="flex justify-between border-b border-gray-100 py-1 text-xs">
                  <span>{c.provider} · {c.reason}</span>
                  <span className={c.rotatable ? 'text-amber-600' : 'text-gray-500'}>
                    {c.rotatable ? 'rotatable' : 'advisory-only'}
                  </span>
                </div>
              ))
            )}
          </section>
        )}
        {!loading && cur && tab === 'lineage' && (
          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              Replay chains: <strong>{cur.summary?.total ?? 0}</strong> · executed{' '}
              <strong className="text-emerald-600">{cur.summary?.executed ?? 0}</strong> · failed{' '}
              <strong className="text-red-600">{cur.summary?.failed ?? 0}</strong> · quarantined{' '}
              <strong>{cur.summary?.quarantined ?? 0}</strong>
            </p>
            <ul className="space-y-1 text-xs">
              {(cur.nodes ?? []).slice(0, 40).map((n: any) => (
                <li key={n.dedupeKey} className="rounded border border-gray-100 p-2">
                  <div className="flex justify-between">
                    <span className="truncate">{n.dedupeKey}</span>
                    <span className={n.terminal === 'failed' ? 'text-red-600' : 'text-gray-600'}>{n.terminal}</span>
                  </div>
                  <div className="text-gray-400">{n.chain?.length ?? 0} stage(s) · {n.firstSeen} → {n.lastSeen}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && cur && tab === 'maturity' && (
          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <div className="flex items-center justify-between">
              <p>
                Trend: <strong>{cur.trend}</strong> · drift{' '}
                <strong className={cur.drift >= 0 ? 'text-emerald-600' : 'text-red-600'}>{cur.drift}</strong>{' '}
                · source {cur.source}
              </p>
              <button
                onClick={async () => {
                  await fetch('/api/website-intelligence/maturity-history', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ company_id: companyId }),
                  });
                  void load('maturity');
                }}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Capture snapshot
              </button>
            </div>
            <ul className="space-y-1 text-xs">
              {(cur.snapshots ?? []).slice(-30).map((s: any, i: number) => (
                <li key={i} className="flex justify-between border-b border-gray-100 py-1">
                  <span>{new Date(s.capturedAt).toLocaleString()}</span>
                  <span className="font-medium">{s.maturityScore}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!loading && cur && tab === 'liveness' && (
          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>
              Heartbeat pipeline:{' '}
              <strong className={cur.heartbeatPipelineLive ? 'text-emerald-600' : 'text-red-600'}>
                {cur.heartbeatPipelineLive ? 'live' : 'degraded'}
              </strong>{' '}
              · round-trip {cur.probeRoundTripMs ?? '—'}ms · wedged{' '}
              <strong className={cur.wedgedCount > 0 ? 'text-red-600' : 'text-emerald-600'}>{cur.wedgedCount}</strong>
            </p>
            {(cur.workers ?? []).map((w: any) => (
              <div key={w.workerId} className="flex justify-between border-b border-gray-100 py-1 text-xs">
                <span>{w.workerType} {w.wedged ? '· WEDGED' : ''}</span>
                <span className={w.reliabilityScore < 50 ? 'text-red-600' : 'text-emerald-600'}>
                  {w.reliabilityScore} {w.heartbeatAdvanced ? '↑' : '·'}
                </span>
              </div>
            ))}
          </section>
        )}

        {!loading && cur && tab === 'predictions' && (
          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p className="text-xs text-gray-500">{cur.capabilityNote}</p>
            {(cur.forecasts ?? []).map((f: any) => (
              <div key={f.metric} className="border-b border-gray-100 py-1 text-xs">
                <div className="flex justify-between">
                  <span>{f.metric}</span>
                  <span className={f.direction === 'up' ? 'text-amber-600' : f.direction === 'down' ? 'text-emerald-600' : 'text-gray-600'}>
                    {f.current} → {f.projected} ({f.direction})
                  </span>
                </div>
                <div className="text-gray-400">conf {f.confidence}% · {f.basis}</div>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function Grade({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-800">{value ?? '—'}</span>
    </div>
  );
}

function BlockerList({ items, title = 'Unresolved blockers' }: { items?: string[]; title?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <ul className="list-disc space-y-1 pl-4 text-xs text-gray-700">
        {items.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </div>
  );
}
