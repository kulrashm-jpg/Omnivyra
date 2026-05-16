import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Activity, BarChart3, ClipboardList, GitBranch, History, ListChecks, Radio, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useCompanyContext } from '@/components/CompanyContext';
import ExecutiveMarketPulseExperience from '@/components/market-pulse/ExecutiveMarketPulseExperience';

const NAV_ITEMS = [
  { id: 'overview', label: 'Executive Overview', icon: Radio },
  { id: 'operational', label: 'Operational Intelligence', icon: Activity },
  { id: 'comparative', label: 'Comparative Intelligence', icon: BarChart3 },
  { id: 'opportunities', label: 'Opportunity Intelligence', icon: Search },
  { id: 'investigations', label: 'Investigations', icon: ClipboardList },
  { id: 'lifecycle', label: 'Lifecycle Management', icon: ListChecks },
  { id: 'watchlists', label: 'Watchlists', icon: SlidersHorizontal },
  { id: 'memory', label: 'Decision Memory', icon: ShieldCheck },
  { id: 'history', label: 'Historical Evolution', icon: History },
  { id: 'drilldown', label: 'Traceability', icon: GitBranch },
];

export default function MarketPulsePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [activeSection, setActiveSection] = useState('overview');
  const queryCompanyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';
  const companyId = useMemo(() => queryCompanyId || selectedCompanyId || '', [queryCompanyId, selectedCompanyId]);

  return (
    <>
      <Head>
        <title>MarketPulse Intelligence</title>
      </Head>
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 px-3 py-6 sm:px-4 lg:px-6">
        <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <p className="px-2 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                MarketPulse
              </p>
              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveSection(item.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                        active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          <main className="min-w-0 space-y-5">
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                Production MarketPulse
              </p>
              <h1 className="mt-2 text-2xl font-bold text-gray-950 md:text-3xl">
                Executive intelligence operating room
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                A dedicated MarketPulse experience for executive scanning, operational investigation,
                comparative changes, opportunity signals, lifecycle governance, and organizational memory.
              </p>
            </section>

            {companyId ? (
              <ExecutiveMarketPulseExperience
                companyId={companyId}
                routeMode
                externalSection={activeSection}
                fetchWithAuth={(input, init) => fetch(input, { ...init, credentials: 'include' })}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-sm text-gray-500">
                Select a company to load MarketPulse.
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
