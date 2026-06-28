import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import PageLoader from '../../components/PageLoader';
import { MarketingCreationWorkspace } from '../../components/creator/MarketingCreationWorkspace';
import { creatorOutcomeFirstEnabled } from '../../lib/creator-outcomes/outcomeRegistry';

/**
 * Unified Marketing Creation Workspace entry (CREATOR-058). One starting point
 * for Writer + Creator + Campaign. Flag-gated: when off, the existing entry
 * points remain the default and this redirects to them. Orchestration only —
 * each asset opens in its existing generator; no runtime change.
 */
export default function MarketingCreatePage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();

  React.useEffect(() => {
    if (authChecked && !user?.userId) { router.replace('/login'); return; }
    if (authChecked && user?.userId && !creatorOutcomeFirstEnabled()) {
      router.replace('/command-center/creator-content'); // legacy entry until cutover
    }
  }, [authChecked, user?.userId, router]);

  if (!authChecked || isLoading) return <PageLoader message="Loading your workspace…" />;
  if (!user?.userId) return <PageLoader message="Redirecting…" statuses={[]} />;
  if (!creatorOutcomeFirstEnabled()) return <PageLoader message="Opening creator…" statuses={[]} />;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f8fafc, #f1f5f9)' }}>
      <MarketingCreationWorkspace onNavigate={(url) => router.push(url)} />
    </div>
  );
}
