/**
 * Engagement Center
 * Operational workspace for inbox, replies, and engagement next steps.
 */

import React from 'react';
import Head from 'next/head';
import { useCompanyContext } from '@/components/CompanyContext';
import { InboxDashboard } from '@/components/engagement/InboxDashboard';

export default function EngagementCommandCenterPage() {
  const { selectedCompanyId } = useCompanyContext();
  const organizationId = selectedCompanyId || '';

  return (
    <>
      <Head>
        <title>Engagement Center</title>
      </Head>
      <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-6 sm:px-4 lg:px-6">
        <div className="mx-auto h-[calc(100vh-7rem)] max-w-7xl overflow-hidden rounded-[28px] border border-white/80 bg-white/92 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm">
          <InboxDashboard organizationId={organizationId} className="h-full min-h-0" />
        </div>
      </div>
    </>
  );
}
