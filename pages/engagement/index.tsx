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
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <InboxDashboard organizationId={organizationId} className="flex-1 min-h-0" />
      </div>
    </>
  );
}
