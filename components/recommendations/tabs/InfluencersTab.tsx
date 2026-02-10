import React, { useState, useMemo } from 'react';
import { useOpportunities } from './useOpportunities';
import type { OpportunityTabProps, OpportunityWithPayload } from './types';
import { payloadHelpers } from './types';

const TYPE = 'INFLUENCER';

function InfluencerCard({
  opportunity,
  onCollaborationPlan,
  onPromote,
  onDismiss,
  onActionComplete,
}: {
  opportunity: OpportunityWithPayload;
  onCollaborationPlan: (id: string) => Promise<void>;
  onPromote: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
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
  const name = payloadHelpers.influencerName(opportunity.payload) || opportunity.title || 'Influencer';
  const platform = payloadHelpers.platform(opportunity.payload) || '—';
  const audienceOverlap = payloadHelpers.audienceOverlap(opportunity.payload);
  const engagementQuality = payloadHelpers.engagementQuality(opportunity.payload);

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      <h3 className="font-semibold text-gray-900">{name}</h3>
      <div className="text-xs text-gray-500 mt-1">Platform: {platform}</div>
      <dl className="mt-2 space-y-1 text-sm text-gray-600">
        <div>
          <span className="text-gray-500">Audience overlap:</span> {audienceOverlap}
        </div>
        <div>
          <span className="text-gray-500">Engagement quality:</span> {engagementQuality}
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run(() => onCollaborationPlan(opportunity.id))}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 text-gray-700 disabled:opacity-50"
        >
          Create Collaboration Plan
        </button>
        <button
          type="button"
          onClick={() => run(() => onPromote(opportunity.id))}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white disabled:opacity-50"
        >
          Promote to Campaign
        </button>
        <button
          type="button"
          onClick={() => run(() => onDismiss(opportunity.id))}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 text-gray-600 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default function InfluencersTab(props: OpportunityTabProps) {
  const { companyId, onPromote, onAction, fetchWithAuth } = props;
  const { opportunities, activeCount, loading, error, refetch } = useOpportunities(
    companyId,
    TYPE,
    fetchWithAuth
  );

  const byPlatform = useMemo(() => {
    const map = new Map<string, OpportunityWithPayload[]>();
    for (const opp of opportunities) {
      const platform = payloadHelpers.platform(opp.payload) || 'Other';
      if (!map.has(platform)) map.set(platform, []);
      map.get(platform)!.push(opp);
    }
    return Array.from(map.entries());
  }, [opportunities]);

  const handleCollaborationPlan = async (_id: string) => {
    if (typeof window !== 'undefined') {
      window.alert('Collaboration plan (non-campaign artifact) will open here. Not yet implemented.');
    }
  };
  const handleDismiss = async (id: string) => {
    await onAction(id, 'DISMISSED');
  };

  if (!companyId) {
    return (
      <div className="text-sm text-gray-500 py-4">Select a company to view influencer opportunities.</div>
    );
  }
  if (loading) {
    return <div className="text-sm text-gray-500 py-4">Loading influencer opportunities...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-600 py-2">{error}</div>;
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Influencer opportunities grouped by platform. Create a collaboration plan or promote to campaign.
      </p>
      <div className="text-sm font-medium text-gray-700 mb-3">
        {activeCount} / 10 Active Opportunities
      </div>
      <div className="space-y-6">
        {byPlatform.map(([platform, list]) => (
          <div key={platform}>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">{platform}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {list.map((opp) => (
                <InfluencerCard
                  key={opp.id}
                  opportunity={opp}
                  onCollaborationPlan={handleCollaborationPlan}
                  onPromote={onPromote}
                  onDismiss={handleDismiss}
                  onActionComplete={refetch}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {opportunities.length === 0 && (
        <div className="text-sm text-gray-500 py-4">No influencer opportunities.</div>
      )}
    </div>
  );
}
