import React, { useState } from 'react';
import { useOpportunities } from './useOpportunities';
import type { OpportunityTabProps, OpportunityWithPayload } from './types';
import { payloadHelpers } from './types';

const TYPE = 'TREND';

function TrendCard({
  opportunity,
  companyId,
  onPromote,
  onSaveAsPossibility,
  onDismiss,
  onActionComplete,
}: {
  opportunity: OpportunityWithPayload;
  companyId: string;
  onPromote: (id: string) => Promise<void>;
  onSaveAsPossibility: (id: string) => Promise<void>;
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
  const topicCluster = opportunity.title || 'Topic cluster';
  const expectedReach = payloadHelpers.expectedReach(opportunity.payload);
  const formats = payloadHelpers.suggestedFormats(opportunity.payload);
  const suggestedFormats = formats.length ? formats.join(', ') : (opportunity.summary || '—');

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
      <h3 className="font-semibold text-gray-900">{topicCluster}</h3>
      <dl className="mt-2 space-y-1 text-sm text-gray-600">
        <div>
          <span className="text-gray-500">Expected reach:</span> {expectedReach}
        </div>
        <div>
          <span className="text-gray-500">Suggested formats:</span> {suggestedFormats}
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
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
          onClick={() => run(() => onSaveAsPossibility(opportunity.id))}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 text-gray-700 disabled:opacity-50"
        >
          Save as Possibility
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

export default function TrendCampaignsTab(props: OpportunityTabProps) {
  const { companyId, onPromote, onAction, fetchWithAuth } = props;
  const { opportunities, activeCount, loading, error, refetch } = useOpportunities(
    companyId,
    TYPE,
    fetchWithAuth
  );

  const handleSaveAsPossibility = async (id: string) => {
    await onAction(id, 'REVIEWED');
  };
  const handleDismiss = async (id: string) => {
    await onAction(id, 'DISMISSED');
  };

  if (!companyId) {
    return (
      <div className="text-sm text-gray-500 py-4">Select a company to view trend campaigns.</div>
    );
  }
  if (loading) {
    return <div className="text-sm text-gray-500 py-4">Loading trend campaigns...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-600 py-2">{error}</div>;
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Strategic topic clusters. Promote to create a DRAFT campaign or save as a possibility.
      </p>
      <div className="text-sm font-medium text-gray-700 mb-3">
        {activeCount} / 10 Active Opportunities
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {opportunities.map((opp) => (
          <TrendCard
            key={opp.id}
            opportunity={opp}
            companyId={companyId}
            onPromote={onPromote}
            onSaveAsPossibility={handleSaveAsPossibility}
            onDismiss={handleDismiss}
            onActionComplete={refetch}
          />
        ))}
      </div>
      {opportunities.length === 0 && (
        <div className="text-sm text-gray-500 py-4">No trend campaign opportunities.</div>
      )}
    </div>
  );
}
