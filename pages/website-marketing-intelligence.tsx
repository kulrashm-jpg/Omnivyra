import React, { useCallback, useEffect, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';

/**
 * Marketing Intelligence Console — business-facing.
 *
 * Consumes ONLY the read-only intelligence endpoints (next-best-action,
 * content/CTA/timing/conversion/campaign intelligence, optimization history).
 * Plain-language UI; orchestration / queue / lease / replay terminology is
 * deliberately absent. Role-aware (company context), tenant-safe, export-safe
 * (JSON download of the active view), mobile-safe.
 */
type Tab = 'nba' | 'content' | 'cta' | 'timing' | 'conversion' | 'campaign' | 'history';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'nba', label: 'Next best action' },
  { id: 'content', label: 'Content intelligence' },
  { id: 'cta', label: 'CTA intelligence' },
  { id: 'timing', label: 'Publish timing' },
  { id: 'conversion', label: 'Conversion predictions' },
  { id: 'campaign', label: 'Campaign performance' },
  { id: 'history', label: 'Optimization history' },
];

export default function WebsiteMarketingIntelligencePage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';
  const [tab, setTab] = useState<Tab>('nba');
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const url: Record<Tab, string> = {
    nba: `/api/website-intelligence/next-best-action?company_id=${encodeURIComponent(companyId)}`,
    content: `/api/website-intelligence/content-intelligence?company_id=${encodeURIComponent(companyId)}`,
    cta: `/api/website-intelligence/cta-intelligence?company_id=${encodeURIComponent(companyId)}`,
    timing: `/api/website-intelligence/timing-intelligence?company_id=${encodeURIComponent(companyId)}`,
    conversion: `/api/website-intelligence/conversion-prediction?company_id=${encodeURIComponent(companyId)}`,
    campaign: `/api/website-intelligence/campaign-analytics?company_id=${encodeURIComponent(companyId)}`,
    history: `/api/website-intelligence/optimization-history?company_id=${encodeURIComponent(companyId)}`,
  };

  const load = useCallback(async (t: Tab) => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(url[t], { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load');
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

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(cur ?? {}, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `intelligence-${tab}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Marketing intelligence</h1>
          <p className="mt-1 text-sm text-gray-600">
            Recommended actions, derived from your real attribution and engagement data.
          </p>
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
          <button onClick={() => load(tab)} className="ml-auto rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600">Refresh</button>
          <button onClick={exportJson} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600">Export</button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {loading && <div className="py-8 text-center text-sm text-gray-500">Loading…</div>}

        {!loading && cur && tab === 'nba' && (
          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p className="text-gray-500">
              {cur.summary?.total ?? 0} recommended action(s) · {cur.summary?.critical ?? 0} critical · {cur.summary?.high ?? 0} high
            </p>
            <ul className="space-y-2">
              {(cur.actions ?? []).map((a: any) => (
                <li key={a.id} className="rounded border border-gray-100 p-3">
                  <div className="flex justify-between">
                    <span className="font-medium">{a.title}</span>
                    <span className={a.severity === 'critical' || a.severity === 'high' ? 'text-red-600' : 'text-amber-600'}>
                      {a.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{a.rationale}</p>
                  <p className="mt-1 text-xs text-emerald-700"><strong>Try:</strong> {a.recommendedAction}</p>
                  <p className="mt-1 text-[11px] text-gray-400">confidence {a.confidence}%</p>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-gray-400">{cur.capabilityNote}</p>
          </section>
        )}

        {!loading && cur && tab === 'content' && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">Top performing content</h2>
            <ul className="space-y-1 text-xs">
              {(cur.top ?? []).map((c: any) => (
                <li key={c.blogId} className="flex justify-between border-b border-gray-100 py-1">
                  <span className="truncate">{c.title}</span>
                  <span>{c.score} · conf {c.confidence}%</span>
                </li>
              ))}
            </ul>
            <h2 className="mb-2 mt-4 font-semibold">Needs attention</h2>
            <ul className="space-y-1 text-xs">
              {(cur.underperforming ?? []).map((c: any) => (
                <li key={c.blogId} className="flex justify-between border-b border-gray-100 py-1">
                  <span className="truncate">{c.title}</span>
                  <span className="text-red-600">{c.score}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && cur && tab === 'cta' && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p className="text-gray-500">{cur.ctas?.length ?? 0} CTA(s) measured · top: <strong>{cur.summary?.topCta ?? '—'}</strong></p>
            <ul className="space-y-1 text-xs">
              {(cur.ctas ?? []).slice(0, 20).map((c: any) => (
                <li key={c.ctaKey} className="flex justify-between border-b border-gray-100 py-1">
                  <span>{c.ctaKey}</span>
                  <span>{(c.conversionRate * 100).toFixed(1)}% · {c.clicks30d} clicks</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && cur && tab === 'timing' && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p className="font-medium">{cur.recommendation}</p>
            <p className="text-xs text-gray-500">confidence {cur.confidence}%</p>
          </section>
        )}

        {!loading && cur && tab === 'conversion' && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p>High <strong className="text-emerald-600">{cur.distribution?.high ?? 0}</strong> · medium {cur.distribution?.medium ?? 0} · low {cur.distribution?.low ?? 0} · cold <strong className="text-red-600">{cur.distribution?.cold ?? 0}</strong></p>
            <ul className="mt-2 space-y-1 text-xs">
              {(cur.predictions ?? []).slice(0, 20).map((p: any) => (
                <li key={p.leadId} className="flex justify-between border-b border-gray-100 py-1">
                  <span className="truncate">{p.leadId}</span>
                  <span className={p.tier === 'high' ? 'text-emerald-600' : p.tier === 'cold' ? 'text-red-600' : 'text-gray-600'}>{p.tier} · {p.conversionScore}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && cur && tab === 'campaign' && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p className="text-gray-500">mean conversion rate {(cur.meanConversionRate * 100).toFixed(2)}%</p>
            <ul className="mt-2 space-y-1 text-xs">
              {(cur.campaigns ?? []).map((c: any) => (
                <li key={c.campaignKey} className="flex justify-between border-b border-gray-100 py-1">
                  <span>{c.campaignKey}{c.anomalous ? ' ⚠' : ''}</span>
                  <span>{(c.conversionRate * 100).toFixed(2)}% · {c.touches} touches</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && cur && tab === 'history' && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <div className="flex items-center justify-between">
              <p>Snapshots: <strong>{(cur.snapshots ?? []).length}</strong> · drift in total actions: <strong>{cur.drift?.totalActions ?? 0}</strong></p>
              <button
                onClick={async () => {
                  await fetch('/api/website-intelligence/optimization-history', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ company_id: companyId }),
                  });
                  void load('history');
                }}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Capture snapshot
              </button>
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {(cur.snapshots ?? []).slice(-30).map((s: any, i: number) => (
                <li key={i} className="flex justify-between border-b border-gray-100 py-1">
                  <span>{new Date(s.capturedAt).toLocaleString()}</span>
                  <span>{s.totalActions} action(s) · {s.criticalActions} critical</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
