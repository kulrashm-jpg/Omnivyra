import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useOpportunities } from './useOpportunities';
import type { OpportunityTabProps, OpportunityWithPayload } from './types';
import { payloadHelpers } from './types';

const TYPE = 'DAILY_FOCUS';
const MAX_ITEMS = 10;

function DailyItem({
  opportunity,
  onActNow,
  onPromote,
  onMarkReviewed,
  onActionComplete,
}: {
  opportunity: OpportunityWithPayload;
  onActNow: (id: string, actionType: string | null) => Promise<void>;
  onPromote: (id: string) => Promise<void>;
  onMarkReviewed: (id: string) => Promise<void>;
  onActionComplete?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onActionComplete?.();
    } finally {
      setBusy(false);
    }
  };
  const headline = opportunity.title || 'Headline';
  const whyToday = payloadHelpers.whyToday(opportunity.payload) || opportunity.summary || '—';
  const expectedImpact = payloadHelpers.expectedImpact(opportunity.payload);
  const actionType = payloadHelpers.actionType(opportunity.payload);

  return (
    <div className="flex items-start justify-between gap-3 py-2 px-3 border-b border-gray-100 hover:bg-gray-50 rounded">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-gray-900">{headline}</div>
        <div className="text-sm text-gray-600 mt-0.5">Why today: {whyToday}</div>
        {expectedImpact && (
          <div className="text-xs text-indigo-600 mt-1">Expected impact: {expectedImpact}</div>
        )}
      </div>
      <div className="flex flex-wrap gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => run(() => onActNow(opportunity.id, actionType))}
          disabled={busy}
          className="px-2 py-1 text-xs rounded bg-amber-500 text-white disabled:opacity-50"
        >
          Act Now
        </button>
        <button
          type="button"
          onClick={() => run(() => onPromote(opportunity.id))}
          disabled={busy}
          className="px-2 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
        >
          Promote to Campaign
        </button>
        <button
          type="button"
          onClick={() => run(() => onMarkReviewed(opportunity.id))}
          disabled={busy}
          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 disabled:opacity-50"
        >
          Mark Reviewed
        </button>
      </div>
    </div>
  );
}

export default function DailyFocusTab(props: OpportunityTabProps) {
  const router = useRouter();
  const { companyId, onPromote, onAction, fetchWithAuth } = props;
  const { opportunities, activeCount, loading, error, refetch } = useOpportunities(
    companyId,
    TYPE,
    fetchWithAuth
  );

  const displayList = opportunities.slice(0, MAX_ITEMS);

  const handleActNow = async (id: string, actionType: string | null) => {
    if (actionType === 'promote' || actionType === 'campaign') {
      await onPromote(id);
      return;
    }
    if (actionType === 'trend') {
      router.push('/recommendations?tab=TREND');
      return;
    }
    if (actionType === 'lead') {
      router.push('/recommendations?tab=LEAD');
      return;
    }
    if (actionType === 'pulse') {
      router.push('/recommendations?tab=PULSE');
      return;
    }
    if (actionType === 'seasonal') {
      router.push('/recommendations?tab=SEASONAL');
      return;
    }
    if (actionType === 'influencer') {
      router.push('/recommendations?tab=INFLUENCER');
      return;
    }
    // Default: promote to campaign
    await onPromote(id);
  };
  const handleMarkReviewed = async (id: string) => {
    await onAction(id, 'REVIEWED');
  };

  if (!companyId) {
    return (
      <div className="text-sm text-gray-500 py-4">Select a company to view daily focus.</div>
    );
  }
  if (loading) {
    return <div className="text-sm text-gray-500 py-4">Loading daily focus...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-600 py-2">{error}</div>;
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Compact list (max {MAX_ITEMS}). Act now routes by payload or creates a campaign.
      </p>
      <div className="text-sm font-medium text-gray-700 mb-3">
        {activeCount} / 10 Active Opportunities
      </div>
      <div className="space-y-0 rounded-lg border border-gray-200 overflow-hidden">
        {displayList.map((opp) => (
          <DailyItem
            key={opp.id}
            opportunity={opp}
            onActNow={handleActNow}
            onPromote={onPromote}
            onMarkReviewed={handleMarkReviewed}
            onActionComplete={refetch}
          />
        ))}
      </div>
      {opportunities.length === 0 && (
        <div className="text-sm text-gray-500 py-4">No daily focus items.</div>
      )}
      {opportunities.length > MAX_ITEMS && (
        <div className="text-xs text-gray-500 mt-2">
          Showing first {MAX_ITEMS} of {opportunities.length}.
        </div>
      )}
    </div>
  );
}
