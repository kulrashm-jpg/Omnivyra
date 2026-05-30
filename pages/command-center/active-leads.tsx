import React, { useCallback } from 'react';
import Head from 'next/head';
import ActiveLeadsTab from '@/components/recommendations/tabs/ActiveLeadsTab';
import { useCompanyContext } from '@/components/CompanyContext';
import { fetchWithAuth } from '@/components/community-ai/fetchWithAuth';

export default function ActiveLeadsCommandCenterPage() {
  const { selectedCompanyId } = useCompanyContext();
  const handleOpportunityAction = useCallback(async () => {}, []);
  const handleOpportunityPromote = useCallback(async () => {}, []);

  return (
    <>
      <Head>
        <title>Active Leads | Omnivyra</title>
      </Head>
      <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">
              Active Leads
            </p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">
              Opportunity discovery workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              See where to listen, what to monitor, and what opportunities exist — all in one workspace. Recommendations are advisory; you stay in control.
            </p>
          </section>

          <ActiveLeadsTab
            companyId={selectedCompanyId || null}
            onPromote={handleOpportunityPromote}
            onAction={handleOpportunityAction}
            fetchWithAuth={fetchWithAuth}
          />
        </div>
      </main>
    </>
  );
}
