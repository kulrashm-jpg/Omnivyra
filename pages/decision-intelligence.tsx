import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useCompanyContext } from '../components/CompanyContext';
import { WebsiteIntelligenceReport } from '../components/platformIntelligence';

/**
 * Decision Intelligence executive dashboard (Phase 27). Presentation only — it consumes the
 * canonical /api/decision-intelligence presentation model and renders it through the SINGLE
 * platform React renderer (WebsiteIntelligenceReport = the platform IntelligenceReport). No
 * new renderer, no duplicated cards/widgets, no UI-side intelligence.
 */
export default function DecisionIntelligenceDashboard() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';
  const [model, setModel] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    fetch(`/api/decision-intelligence?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setModel(d?.presentation ?? null))
      .catch(() => setModel(null))
      .finally(() => setLoading(false));
  }, [companyId]);

  return (
    <>
      <Head><title>Decision Intelligence | Omnivyra</title></Head>
      <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">Executive</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Decision Intelligence</h1>
            <p className="text-sm text-gray-600">Unified executive view across every Platform Intelligence domain.</p>
          </section>
          {!companyId && <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Select a company.</div>}
          {companyId && loading && <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Loading…</div>}
          {model && <WebsiteIntelligenceReport model={model} />}
        </div>
      </main>
    </>
  );
}
