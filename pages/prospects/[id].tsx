/**
 * WS-10 — the Prospect Intelligence detail page.
 *
 * A route shell around `ProspectIntelligencePanel`. It holds no state beyond
 * the ids in the URL and the selected company, and it fetches nothing itself.
 *
 * ─── WHY A NEW SURFACE RATHER THAN AN EXTENSION ───────────────────────────
 * `/lead-intelligence` renders the LEGACY lead read model — `leads` and its
 * projections, served by `leadIntelligenceReadService`. This page renders the
 * CANONICAL Prospect (`canonical_leads`) and its intelligence, which is a
 * different entity with a different identity key. The manifest is explicit that
 * "Prospect ≠ Person ≠ Account" and that `leads` is capture observation while
 * `canonical_leads` is the pursuit record, so folding one into the other's
 * screen would present two entities as one. The legacy workspace is untouched.
 */

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import ProspectIntelligencePanel from '@/components/prospects/ProspectIntelligencePanel';

export default function ProspectDetailPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const raw = router.query.id;
  const prospectId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';

  return (
    <>
      <Head><title>Prospect Intelligence | Omnivyra</title></Head>
      <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">Prospect Intelligence</p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Everything the platform can evidence</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Identity, account, engagement, ICP fit, scoring, next best action and outreach readiness — each shown
              with the state the canonical services reported. Where a capability is not implemented or has not been
              evaluated, this page says so rather than showing a number.
            </p>
            <Link href="/prospects" className="mt-3 inline-block text-xs font-medium text-purple-600 hover:underline">
              ← Prospects
            </Link>
          </header>

          {prospectId
            ? <ProspectIntelligencePanel companyId={selectedCompanyId ?? ''} prospectId={prospectId} />
            : <p className="text-sm text-gray-500">No prospect selected.</p>}
        </div>
      </main>
    </>
  );
}
