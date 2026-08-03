import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import OverviewPanel from '@/components/lead-intelligence/OverviewPanel';
import LeadListPanel from '@/components/lead-intelligence/LeadListPanel';

type Tab = 'overview' | 'leads';

export default function LeadIntelligenceWorkspacePage() {
  const { selectedCompanyId } = useCompanyContext();
  const router = useRouter();
  const initial: Tab = router.query.tab === 'leads' ? 'leads' : 'overview';
  const [tab, setTab] = useState<Tab>(initial);

  const select = (t: Tab) => {
    setTab(t);
    router.push({ pathname: '/lead-intelligence', query: t === 'leads' ? { tab: 'leads' } : {} }, undefined, { shallow: true });
  };

  const tabBtn = (t: Tab, label: string) =>
    `rounded-lg px-4 py-2 text-sm font-medium transition ${tab === t ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;

  return (
    <>
      <Head><title>Lead Intelligence | Omnivyra</title></Head>
      <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">Lead Intelligence</p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">The single workspace for every lead source</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Website, blog, forms, CRM, community, engagement, MarketPulse, referral, partner, API, import and more — unified,
              searchable, and scored. Everything here is served by the canonical Lead Intelligence repository.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button className={tabBtn('overview', 'Overview')} onClick={() => select('overview')}>Overview</button>
              <button className={tabBtn('leads', 'All Leads')} onClick={() => select('leads')}>All Leads</button>
              {/* INT-003 W4 — read-only analytics over persisted intelligence */}
              <Link href="/lead-intelligence/dashboard" className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100">
                Intelligence Dashboard
              </Link>
            </div>
          </section>

          {!selectedCompanyId ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
              Select a company to view its Lead Intelligence.
            </div>
          ) : tab === 'overview' ? (
            <OverviewPanel companyId={selectedCompanyId} />
          ) : (
            <LeadListPanel companyId={selectedCompanyId} />
          )}
        </div>
      </main>
    </>
  );
}
