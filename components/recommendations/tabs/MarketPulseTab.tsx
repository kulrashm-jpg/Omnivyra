import React, { useState } from 'react';
import { useOpportunities } from './useOpportunities';
import type { OpportunityTabProps, OpportunityWithPayload } from './types';
import { payloadHelpers } from './types';

const TYPE = 'PULSE';

function PulseRow({
  index,
  opportunity,
  onQuickDraft,
  onPromote,
  onArchive,
  onActionComplete,
}: {
  index: number;
  opportunity: OpportunityWithPayload;
  onQuickDraft: (id: string) => Promise<void>;
  onPromote: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
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
  const topic = opportunity.title || 'Topic';
  const spikeReason = payloadHelpers.spikeReason(opportunity.payload) || opportunity.summary || '—';
  const shelfLife = payloadHelpers.shelfLife(opportunity.payload);

  return (
    <div className="flex items-start gap-3 py-3 px-3 border-b border-gray-100 hover:bg-gray-50 rounded">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-sm font-semibold">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900">{topic}</div>
        <div className="text-sm text-gray-600 mt-0.5">
          <span className="text-amber-600 font-medium">Spike:</span> {spikeReason}
        </div>
        <div className="text-xs text-gray-500 mt-1">Shelf life: {shelfLife}</div>
      </div>
      <div className="flex flex-wrap gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => run(() => onQuickDraft(opportunity.id))}
          disabled={busy}
          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 disabled:opacity-50"
        >
          Generate Quick Content Draft
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
          onClick={() => run(() => onArchive(opportunity.id))}
          disabled={busy}
          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 disabled:opacity-50"
        >
          Archive
        </button>
      </div>
    </div>
  );
}

export default function MarketPulseTab(props: OpportunityTabProps) {
  const { companyId, onPromote, onAction, fetchWithAuth } = props;
  const { opportunities, activeCount, loading, error, refetch } = useOpportunities(
    companyId,
    TYPE,
    fetchWithAuth
  );

  const handleQuickDraft = async (_id: string) => {
    if (typeof window !== 'undefined') {
      window.alert('Quick content draft generation will open here. Not yet implemented.');
    }
  };
  const handleArchive = async (id: string) => {
    await onAction(id, 'ARCHIVED');
  };

  if (!companyId) {
    return <div className="text-sm text-gray-500 py-4">Select a company to view market pulse.</div>;
  }
  if (loading) {
    return <div className="text-sm text-gray-500 py-4">Loading market pulse...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-600 py-2">{error}</div>;
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Ranked market pulse with spike indicators. Generate a quick draft or promote to campaign.
      </p>
      <div className="text-sm font-medium text-gray-700 mb-3">
        {activeCount} / 10 Active Opportunities
      </div>
      <div className="space-y-0 rounded-lg border border-gray-200 overflow-hidden">
        {opportunities.map((opp, i) => (
          <PulseRow
            key={opp.id}
            index={i}
            opportunity={opp}
            onQuickDraft={handleQuickDraft}
            onPromote={onPromote}
            onArchive={handleArchive}
            onActionComplete={refetch}
          />
        ))}
      </div>
      {opportunities.length === 0 && (
        <div className="text-sm text-gray-500 py-4">No market pulse opportunities.</div>
      )}
    </div>
  );
}
