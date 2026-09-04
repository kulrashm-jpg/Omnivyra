/**
 * WS-10 — the Prospect list.
 *
 * The entry point to `/prospects/[id]`, which until now was reachable only by
 * typing a URL: nothing in the application linked to it. This page is that link
 * and deliberately nothing more.
 *
 * ─── IT DECIDES NOTHING ───────────────────────────────────────────────────
 * `listProspects` already orders, bounds and tenant-scopes the page, and its own
 * contract states it "applies no qualification rule, no ranking and no filter the
 * caller did not ask for". This component re-implements none of that: it renders
 * the rows in the order the API returned them. Sorting or filtering here would be
 * a second answer to a question the backend already answers.
 *
 * ─── UNSCORED IS NOT ZERO ─────────────────────────────────────────────────
 * `qualificationScore` is `canonical_leads.qualification_score` reported verbatim,
 * including its column default of 0, and WS-1 never writes it. The API therefore
 * ships `scored` alongside it to say whether any authority wrote a score. Showing
 * the raw number would render "0" for every prospect nobody has evaluated, so an
 * unscored prospect reads "Not scored" — the same distinction the detail panel
 * makes with its em dash.
 *
 * ─── THE TENANT IS NAMED, NEVER INFERRED ──────────────────────────────────
 * `companyId` comes from CompanyContext and is passed explicitly, exactly as the
 * detail panel does. It is not authorization: `/api/prospects` validates it
 * against live membership via `requireTenantAccess` before reading anything.
 */

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { useCompanyContext } from '@/components/CompanyContext';
import { apiFetch } from '@/lib/apiFetch';

/** Mirrors `ProspectListRow` from backend/apiHandlers/prospects/prospectIntelligenceRead.ts. */
interface ProspectListRow {
  prospectId: string;
  personId: string | null;
  source: string | null;
  externalLeadKey: string | null;
  createdAt: string | null;
  qualificationScore: number | null;
  scored: boolean;
}

/** Mirrors `ProspectListResult`. */
interface ProspectListResult {
  version: string;
  organizationId: string;
  rows: ProspectListRow[];
  page: { limit: number; offset: number; returned: number };
}

/** `null` renders as an em dash, never as a blank or a zero — matches the detail panel. */
const show = (v: string | null | undefined): React.ReactNode =>
  v === null || v === undefined || v === '' ? <span className="text-gray-400">—</span> : v;

/**
 * A stored 0 is the column default, not a verdict, so `scored` decides the label.
 * Kept as text rather than a badge colour so it cannot be read as a rating.
 */
const scoreLabel = (row: ProspectListRow): React.ReactNode =>
  row.scored && row.qualificationScore !== null
    ? <span className="font-semibold text-gray-900">{row.qualificationScore}</span>
    : <span className="text-gray-400">Not scored</span>;

/** ISO → locale date. An unparseable or absent value stays an em dash rather than "Invalid Date". */
const formatDate = (iso: string | null): React.ReactNode => {
  if (!iso) return <span className="text-gray-400">—</span>;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? <span className="text-gray-400">—</span>
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function ProspectListPage() {
  const { selectedCompanyId } = useCompanyContext();

  const key = selectedCompanyId
    ? `/api/prospects?companyId=${encodeURIComponent(selectedCompanyId)}`
    : null;

  const { data, error, isLoading } = useSWR<ProspectListResult>(
    key,
    (u: string) => apiFetch(u).then((r) => r.json()),
  );

  // A malformed payload is treated as "we could not read", never as "there are
  // none" — the same distinction the API draws between 503 and an empty list.
  const rows: ProspectListRow[] | null =
    data && Array.isArray(data.rows) ? data.rows : null;
  const malformed = Boolean(data) && rows === null;

  return (
    <>
      <Head><title>Prospects | Omnivyra</title></Head>
      <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">Prospects</p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Every prospect this company has</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              The canonical pursuit record, newest first. Open one to see the identity, account, engagement,
              scoring and outreach readiness the platform can evidence for it.
            </p>
            <Link href="/lead-intelligence" className="mt-3 inline-block text-xs font-medium text-purple-600 hover:underline">
              ← Lead Intelligence workspace
            </Link>
          </header>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            {!selectedCompanyId ? (
              <p className="text-sm text-gray-500">Select a company to view its prospects.</p>
            ) : isLoading ? (
              <p className="text-sm text-gray-500">Loading prospects…</p>
            ) : error || malformed ? (
              <p className="text-sm text-rose-600">
                Prospects are unavailable. Nothing has been altered — only unread.
              </p>
            ) : !rows ? (
              <p className="text-sm text-gray-500">No prospects found in this company.</p>
            ) : rows.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-gray-900">No prospects yet</p>
                <p className="mt-1 text-sm text-gray-500">
                  Prospects appear here once a lead source has been ingested for this company.
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                        <th scope="col" className="py-2 pr-4 font-medium">Prospect</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Source</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Created</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Qualification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.prospectId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="py-3 pr-4">
                            <Link
                              href={`/prospects/${encodeURIComponent(row.prospectId)}`}
                              className="font-medium text-purple-600 hover:underline"
                            >
                              {row.externalLeadKey ?? row.prospectId}
                            </Link>
                            {row.externalLeadKey ? (
                              <p className="mt-0.5 text-xs text-gray-400">{row.prospectId}</p>
                            ) : null}
                          </td>
                          <td className="py-3 pr-4 text-gray-600">{show(row.source)}</td>
                          <td className="py-3 pr-4 text-gray-600">{formatDate(row.createdAt)}</td>
                          <td className="py-3 pr-4">{scoreLabel(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 text-xs text-gray-500">
                  Showing {data?.page?.returned ?? rows.length} prospect{rows.length === 1 ? '' : 's'}.
                </p>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
