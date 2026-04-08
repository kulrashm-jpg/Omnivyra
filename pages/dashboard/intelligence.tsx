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
    if (view === 'market-pulse' || view === 'active-leads' || view === 'intelligence') {
      return view;
    }
    return 'intelligence';
  });

  useEffect(() => {
    const view = getQueryString(router.query.intelTab);
    if (view === 'market-pulse' || view === 'active-leads' || view === 'intelligence') {
      setActiveView(view);
    }
  }, [router.query.intelTab]);

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
        <div className="container mx-auto max-w-6xl p-6">
          <h1 className="text-2xl font-semibold text-slate-900">CMO Intelligence Dashboard</h1>
          <p className="mt-2 text-slate-600">Select a company to view intelligence.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>CMO Intelligence Dashboard</title>
      </Head>

      <div className="container mx-auto max-w-6xl space-y-6 p-6">
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
    </>
  );
}
