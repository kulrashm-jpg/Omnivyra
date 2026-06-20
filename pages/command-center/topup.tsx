import React from 'react';
import Head from 'next/head';
import { useCompanyContext } from '@/components/CompanyContext';
import TopUpPanel from '@/components/billing/TopUpPanel';

/** Top-up purchase page (staging). Route: /command-center/topup. */
export default function TopUpPage() {
  const { selectedCompanyId } = useCompanyContext();
  return (
    <>
      <Head><title>Buy Credits | Omnivyra</title></Head>
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Buy top-up credits</h1>
            <p className="mt-1 text-sm text-slate-500">
              Add credits for heavier periods. Top-up credits are consumed after monthly plan credits and never expire.
            </p>
          </header>
          <TopUpPanel orgId={selectedCompanyId} />
        </div>
      </main>
    </>
  );
}
