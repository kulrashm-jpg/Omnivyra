import React, { useState, useMemo } from 'react';
import { useOpportunities } from './useOpportunities';
import type { OpportunityTabProps, OpportunityWithPayload } from './types';
import { payloadHelpers } from './types';
import EngineContextPanel from '../EngineContextPanel';
import EngineOverridePanel from '../EngineOverridePanel';

const TYPE = 'INFLUENCER';
const ENGINE_LABEL = 'Influencers';

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
  const name = opportunity.title || 'Influencer';
  const platform = payloadHelpers.platform(opportunity.payload);
  const audienceOverlap = payloadHelpers.audienceOverlapScore(opportunity.payload);
  const engagementRate = payloadHelpers.engagementRate(opportunity.payload);

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      <h3 className="font-semibold text-gray-900">{name}</h3>
      <div className="text-xs text-gray-500 mt-1">Platform: {platform}</div>
      <dl className="mt-2 space-y-1 text-sm text-gray-600">
        <div>
          <span className="text-gray-500">Audience overlap:</span> {audienceOverlap}
        </div>
        <div>
          <span className="text-gray-500">Engagement rate:</span> {engagementRate}
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
  const { companyId, onPromote, onAction, fetchWithAuth, overrideText = '', onOverrideChange } = props;
  const { opportunities, loading, error, runEngine, hasRun, refetch, refetchGetOnly } = useOpportunities(
    companyId,
    TYPE,
    fetchWithAuth
  );

  const wrappedOnPromote = async (id: string) => {
    try {
      await onPromote(id);
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err?.status === 404) await refetchGetOnly();
      throw e;
    }
  };

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

  return (
    <div className="space-y-4">
      <EngineContextPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      <EngineOverridePanel value={overrideText} onChange={onOverrideChange ?? (() => {})} />
      <div>
        <button
          type="button"
          onClick={() => runEngine()}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Running…' : `Run ${ENGINE_LABEL}`}
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!hasRun && !loading && (
        <div className="text-sm text-gray-500 py-6">Run the engine to see opportunities.</div>
      )}
      {hasRun && !loading && (
        <>
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
                      onPromote={wrappedOnPromote}
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
        </>
      )}
      {loading && <div className="text-sm text-gray-500 py-4">Loading influencer opportunities…</div>}
    </div>
  );
}
