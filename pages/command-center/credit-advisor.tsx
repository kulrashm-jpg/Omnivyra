import React from 'react';
import Head from 'next/head';
import { useCompanyContext } from '@/components/CompanyContext';
import CreditAdvisorDashboard from '@/components/credit-advisor/CreditAdvisorDashboard';
import OptimizationPanel from '@/components/credit-advisor/OptimizationPanel';

/**
 * Credit Advisor — read-only consumption intelligence dashboard.
 * Route: /command-center/credit-advisor (AppLayout/nav injected by AuthGate).
 */
export default function CreditAdvisorPage() {
  const { selectedCompanyId } = useCompanyContext();

  return (
    <>
      <Head>
        <title>Credit Advisor | Omnivyra</title>
      </Head>
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <header id="overview" className="scroll-mt-24">
            <h1 className="text-2xl font-bold text-slate-900">Credit Advisor</h1>
            <p className="mt-1 text-sm text-slate-500">
              Understand consumption, forecast runway, and find savings. Read-only — nothing here
              changes your balance, plan, or top-ups.
            </p>
          </header>
          <CreditAdvisorDashboard orgId={selectedCompanyId} />

          <div className="pt-4">
            <h2 className="text-xl font-bold text-slate-900">Consumption Optimization</h2>
            <p className="mt-1 text-sm text-slate-500">
              Where credits go, why, and how to extend your runway — deterministic, read-only.
            </p>
            <div className="mt-4">
              <OptimizationPanel orgId={selectedCompanyId} />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
