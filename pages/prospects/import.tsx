/**
 * PI-LDB — `/prospects/import`.
 *
 * A route shell around `ImportWizard`, following the pattern
 * `pages/prospects/[id].tsx` and `pages/prospects/icp.tsx` already establish:
 * the page owns the title, the chrome and the tenant, and fetches nothing
 * itself.
 *
 * ─── WHY IT LIVES UNDER /prospects ────────────────────────────────────────
 * Because the thing it creates is a Prospect. `canonical_leads` IS the
 * Prospect — `prospectIntelligenceRead` maps `prospectId` to
 * `canonical_leads.id`, and the navigation group's own note records that Lead
 * Intelligence is one lens over that row rather than a separate domain. An
 * importer under `/lead-intelligence` would have put the creation of a
 * prospect inside a read-only lens over it.
 *
 * ─── THE TENANT IS NAMED, NEVER INFERRED ──────────────────────────────────
 * `companyId` comes from CompanyContext and is passed explicitly, exactly as
 * the prospect list and detail pages do. It is not authorization: every route
 * the wizard calls re-validates it against live membership before reading or
 * writing anything.
 */

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import ImportWizard from '@/components/prospects/import/ImportWizard';

export default function ProspectImportPage() {
  const { selectedCompanyId } = useCompanyContext();

  return (
    <>
      <Head><title>Import Prospects | Omnivyra</title></Head>
      <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">
              Prospects
            </p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Import prospects from a file</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Upload a CSV export from your CRM or a spreadsheet. We read it in your browser, work
              out what each column means, and ask you about anything genuinely ambiguous before a
              single record is created. You can change any destination without uploading the file
              again.
            </p>
            <Link
              href="/prospects"
              className="mt-3 inline-block text-xs font-medium text-purple-600 hover:underline"
            >
              ← Prospects
            </Link>
          </header>

          {!selectedCompanyId ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
              Select a company to import prospects into.
            </div>
          ) : (
            // Keyed on the tenant so switching companies mid-flow resets the
            // wizard rather than carrying one company's parsed file into
            // another's import.
            <ImportWizard key={selectedCompanyId} companyId={selectedCompanyId} />
          )}
        </div>
      </main>
    </>
  );
}
