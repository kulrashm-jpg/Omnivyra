/**
 * INT-003 Wave 4 — Intelligence Dashboard page.
 *
 * Read-only management view over persisted Lead Intelligence. All data flows
 * through the authenticated INT-003 read APIs; the page itself is a shell.
 */

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import IntelligenceDashboard from '@/components/lead-intelligence/IntelligenceDashboard';

export default function IntelligenceDashboardPage() {
  const { selectedCompanyId } = useCompanyContext();

  return (
    <>
      <Head><title>Intelligence Dashboard | Omnivyra</title></Head>
      <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <Link href="/lead-intelligence" className="inline-flex items-center text-sm font-medium text-purple-600 hover:text-purple-700">
            ← Back to lead intelligence
          </Link>
          {!selectedCompanyId ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
              Select a company to view the intelligence dashboard.
            </div>
          ) : (
            <IntelligenceDashboard companyId={selectedCompanyId} />
          )}
        </div>
      </main>
    </>
  );
}
