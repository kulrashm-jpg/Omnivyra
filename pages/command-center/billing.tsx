import React from 'react';
import Head from 'next/head';
import { useCompanyContext } from '@/components/CompanyContext';
import BillingCenter from '@/components/billing/BillingCenter';

/** Billing & Subscription Center. Route: /command-center/billing. */
export default function BillingPage() {
  const { selectedCompanyId } = useCompanyContext();
  return (
    <>
      <Head><title>Billing | Omnivyra</title></Head>
      <main className="min-h-screen bg-[#F5F9FF] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-[#071D3A]">Billing &amp; Subscription</h1>
            <p className="mt-1 text-sm text-[#5D6F83]">Your plan, credits, purchases, and invoices.</p>
          </header>
          <BillingCenter orgId={selectedCompanyId} />
        </div>
      </main>
    </>
  );
}
