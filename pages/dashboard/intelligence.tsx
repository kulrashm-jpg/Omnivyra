import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import IntelligenceWorkspace, {
  type IntelligenceWorkspaceView,
} from '@/components/dashboard/IntelligenceWorkspace';

function getQueryString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && value[0]) return String(value[0]).trim();
  return '';
}

export default function CMOIntelligenceDashboard() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [activeView, setActiveView] = useState<IntelligenceWorkspaceView>(() => {
    const view = getQueryString(router.query.intelTab);
    if (view === 'market-pulse' || view === 'active-leads') {
      return view;
    }
    return 'market-pulse';
  });

  useEffect(() => {
    const view = getQueryString(router.query.intelTab);
    if (view === 'intelligence') {
      const companyIdQuery = getQueryString(router.query.companyId);
      void router.replace(
        companyIdQuery ? `/intelligence?companyId=${encodeURIComponent(companyIdQuery)}` : '/intelligence'
      );
      return;
    }
    if (view === 'market-pulse' || view === 'active-leads') {
      setActiveView(view);
      return;
    }
    setActiveView('market-pulse');
  }, [router, router.query.companyId, router.query.intelTab]);

  const companyId = useMemo(
    () => getQueryString(router.query.companyId) || selectedCompanyId || '',
    [router.query.companyId, selectedCompanyId]
  );

  if (!companyId) {
    return (
      <>
        <Head>
          <title>CMO Intelligence Dashboard</title>
        </Head>
        <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="rounded-[28px] border border-white/80 bg-white/92 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">Signals Workspace</h1>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">Select a company to review market signals and active leads.</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Signals Workspace</title>
      </Head>

      <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Intelligence System</p>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">Review live signals</h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                  Use this workspace only for Market Pulse and Active Leads. Strategic Intelligence now lives on its own dedicated page.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Views</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">2</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Focus</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">Signals</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
                <p className="mt-1 text-sm text-gray-700">Teams reviewing market movement and buyer-intent signals without mixing them with the main intelligence page.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
                <p className="mt-1 text-sm text-gray-700">Keeps Market Pulse and Active Leads together while leaving broader Intelligence on its own operating page.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
                <p className="mt-1 text-sm text-gray-700">A cleaner two-view shell focused only on signals that need active monitoring and action.</p>
              </div>
            </div>
          </div>

          <IntelligenceWorkspace
            companyId={companyId}
            activeView={activeView}
            onViewChange={setActiveView}
            fetchWithAuth={(input, init) =>
              fetch(input, {
                ...init,
                credentials: 'include',
              })
            }
          />
        </div>
      </div>
    </>
  );
}
