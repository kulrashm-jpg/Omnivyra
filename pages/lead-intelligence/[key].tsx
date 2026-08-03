import React, { useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useCompanyContext } from '@/components/CompanyContext';
import LeadProfileView from '@/components/lead-intelligence/LeadProfileView';
import LeadIntelligenceSection from '@/components/lead-intelligence/LeadIntelligenceSection';
import OperationalPanel from '@/components/lead-intelligence/OperationalPanel';
import { fetchLeadProfile, leadProfileKey } from '@/components/lead-intelligence/leadIntelligenceClient';
import type { LeadProfile } from '@/lib/leadIntelligence';

export default function LeadProfilePage() {
  const { selectedCompanyId } = useCompanyContext();
  const router = useRouter();
  const key = typeof router.query.key === 'string' ? router.query.key : '';

  // OPT-005 Phase 2C: the profile is an SWR entry keyed on the exact request
  // URL (company + lead key). Loading covers "router key not ready yet" plus
  // any uncached first fetch — the same span the old hook flagged; error
  // contract unchanged ('Lead not found' on 404 comes from the fetcher).
  const swrKey = selectedCompanyId && key ? leadProfileKey(selectedCompanyId, key) : null;
  const { data, error: swrError, isLoading } = useSWR<LeadProfile>(
    swrKey,
    () => fetchLeadProfile(selectedCompanyId as string, key)
  );
  const profile = data ?? null;
  const loading = !key || isLoading;
  const error = swrError ? (swrError instanceof Error ? swrError.message : 'Failed to load lead') : null;

  const onExport = useCallback(() => {
    if (!profile) return;
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lead-${profile.view.source}-${profile.view.sourceRef?.id ?? 'profile'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [profile]);

  return (
    <>
      <Head><title>Lead Profile | Omnivyra</title></Head>
      <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <Link href="/lead-intelligence?tab=leads" className="inline-flex items-center text-sm font-medium text-purple-600 hover:text-purple-700">← Back to all leads</Link>

          {!selectedCompanyId ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Select a company to view this lead.</div>
          ) : loading ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading lead profile…</div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
          ) : profile ? (
            <>
              {/* W2b — operational console (consumes the single Operations API) */}
              <OperationalPanel companyId={selectedCompanyId} entityId={profile.leadKey} />
              <LeadProfileView profile={profile} onExport={onExport} />
              {/* INT-003 W2 — persisted engine output (read-only; distinct from the profile panels above) */}
              <LeadIntelligenceSection companyId={selectedCompanyId} leadId={profile.view.sourceRef?.id ?? null} />
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}
