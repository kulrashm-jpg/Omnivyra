import React, { useState } from 'react';
import { useOpportunities } from './useOpportunities';
import type { OpportunityTabProps, OpportunityWithPayload } from './types';
import { payloadHelpers } from './types';

const TYPE = 'LEAD';

function LeadRow({
  opportunity,
  onOutreachPlan,
  onPromote,
  onDismiss,
  onActionComplete,
}: {
  opportunity: OpportunityWithPayload;
  onOutreachPlan: (id: string) => Promise<void>;
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
  const platform = payloadHelpers.platform(opportunity.payload);
  const snippet = payloadHelpers.publicSnippet(opportunity.payload) || opportunity.summary || '—';
  const problemDomain = opportunity.problem_domain || '—';
  const icpMatch = payloadHelpers.icpMatch(opportunity.payload);
  const urgency = payloadHelpers.urgency(opportunity.payload);

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="py-3 px-3 text-sm text-gray-900 font-medium">{platform}</td>
      <td className="py-3 px-3 text-sm text-gray-600 max-w-[200px] truncate" title={snippet}>
        {snippet}
      </td>
      <td className="py-3 px-3 text-sm text-gray-600">{problemDomain}</td>
      <td className="py-3 px-3 text-sm text-gray-600">{icpMatch}</td>
      <td className="py-3 px-3 text-sm text-gray-600">{urgency}</td>
      <td className="py-3 px-3 text-sm">
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => run(() => onOutreachPlan(opportunity.id))}
            disabled={busy}
            className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 disabled:opacity-50"
          >
            Create Outreach Plan
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
            onClick={() => run(() => onDismiss(opportunity.id))}
            disabled={busy}
            className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function ActiveLeadsTab(props: OpportunityTabProps) {
  const { companyId, onPromote, onAction, fetchWithAuth } = props;
  const { opportunities, activeCount, loading, error, refetch } = useOpportunities(
    companyId,
    TYPE,
    fetchWithAuth
  );

  const handleOutreachPlan = async (_id: string) => {
    // Does NOT create campaign; placeholder for future outreach plan flow
    if (typeof window !== 'undefined') {
      window.alert('Outreach plan creation will open here. Not yet implemented.');
    }
  };
  const handleDismiss = async (id: string) => {
    await onAction(id, 'DISMISSED');
  };

  if (!companyId) {
    return <div className="text-sm text-gray-500 py-4">Select a company to view active leads.</div>;
  }
  if (loading) {
    return <div className="text-sm text-gray-500 py-4">Loading active leads...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-600 py-2">{error}</div>;
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Lead-based opportunities. Create an outreach plan or promote to campaign.
      </p>
      <div className="text-sm font-medium text-gray-700 mb-3">
        {activeCount} / 10 Active Opportunities
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
              <th className="py-2 px-3 font-semibold">Platform</th>
              <th className="py-2 px-3 font-semibold">Public snippet</th>
              <th className="py-2 px-3 font-semibold">Problem domain</th>
              <th className="py-2 px-3 font-semibold">ICP match</th>
              <th className="py-2 px-3 font-semibold">Urgency</th>
              <th className="py-2 px-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((opp) => (
              <LeadRow
                key={opp.id}
                opportunity={opp}
                onOutreachPlan={handleOutreachPlan}
                onPromote={onPromote}
                onDismiss={handleDismiss}
                onActionComplete={refetch}
              />
            ))}
          </tbody>
        </table>
      </div>
      {opportunities.length === 0 && (
        <div className="text-sm text-gray-500 py-4">No active leads.</div>
      )}
    </div>
  );
}
