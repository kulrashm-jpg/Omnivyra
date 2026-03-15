/**
 * ContentOpportunitiesPanel — displays structured content opportunities from engagement signals.
 * Receives opportunities from parent (parent fetches from /api/engagement/content-opportunities).
 * Supports Review, Ignore, Send to Campaign Planner actions.
 */

import React, { useState, useCallback } from 'react';
import { ContentOpportunityReviewModal } from './ContentOpportunityReviewModal';

const MAX_DISPLAY = 5;

export type ContentOpportunityType =
  | 'tutorial'
  | 'comparison'
  | 'explainer'
  | 'thought_leadership'
  | 'product_announcement'
  | 'landing_page';

export type ContentOpportunity = {
  topic: string;
  opportunity_type: ContentOpportunityType;
  suggested_title: string;
  signal_summary: {
    questions: number;
    problems: number;
    comparisons: number;
    feature_requests: number;
  };
  confidence_score: number;
  source_signals?: string[];
  quality_warning?: boolean;
};

export interface ContentOpportunitiesPanelProps {
  opportunities: ContentOpportunity[];
  organizationId?: string | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  className?: string;
}

const LABELS: Record<ContentOpportunityType, string> = {
  tutorial: 'Tutorial',
  comparison: 'Comparison',
  explainer: 'Explainer',
  thought_leadership: 'Thought Leadership',
  product_announcement: 'Product Announcement',
  landing_page: 'Landing Page',
};

export const ContentOpportunitiesPanel = React.memo(function ContentOpportunitiesPanel({
  opportunities,
  organizationId = null,
  loading = false,
  error = null,
  onRefresh,
  className = '',
}: ContentOpportunitiesPanelProps) {
  const [modalOpp, setModalOpp] = useState<ContentOpportunity | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const storeAndGetId = useCallback(
    async (opp: ContentOpportunity): Promise<string | null> => {
      if (!organizationId) return null;
      const res = await fetch('/api/engagement/content-opportunities/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: organizationId,
          opportunity: {
            topic: opp.topic,
            opportunity_type: opp.opportunity_type,
            suggested_title: opp.suggested_title,
            confidence_score: opp.confidence_score,
            signal_summary: opp.signal_summary,
          },
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.id ?? null;
    },
    [organizationId]
  );

  const handleReview = useCallback(
    async (opp: ContentOpportunity) => {
      if (!organizationId) return;
      setActionBusy('review');
      try {
        const id = await storeAndGetId(opp);
        if (id) {
          setModalId(id);
          setModalOpp(opp);
        }
      } finally {
        setActionBusy(null);
      }
    },
    [organizationId, storeAndGetId]
  );

  const handleIgnore = useCallback(
    async (opp: ContentOpportunity) => {
      if (!organizationId) return;
      setActionBusy(`${opp.topic}-ignore`);
      try {
        const id = await storeAndGetId(opp);
        if (id) {
          await fetch('/api/engagement/content-opportunities/update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              id,
              status: 'ignored',
              organization_id: organizationId,
            }),
          });
          onRefresh?.();
        }
      } finally {
        setActionBusy(null);
      }
    },
    [organizationId, storeAndGetId, onRefresh]
  );

  const handleSendToCampaign = useCallback(
    async (opp: ContentOpportunity) => {
      if (!organizationId) return;
      setActionBusy(`${opp.topic}-send`);
      try {
        const id = await storeAndGetId(opp);
        if (id) {
          await fetch('/api/engagement/content-opportunities/update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              id,
              status: 'sent_to_campaign',
              organization_id: organizationId,
            }),
          });
          window.dispatchEvent(
            new CustomEvent('campaign_planner_content_seed', {
              detail: {
                topic: opp.topic,
                suggested_title: opp.suggested_title,
                opportunity_type: opp.opportunity_type,
                signal_summary: opp.signal_summary,
              },
            })
          );
          onRefresh?.();
        }
      } finally {
        setActionBusy(null);
      }
    },
    [organizationId, storeAndGetId, onRefresh]
  );

  const closeModal = useCallback(() => {
    setModalOpp(null);
    setModalId(null);
  }, []);

  const display = opportunities.slice(0, MAX_DISPLAY);

  const getBadges = (opp: ContentOpportunity) => {
    const badges: { label: string; className: string }[] = [];
    if ((opp.confidence_score ?? 0) >= 0.7) {
      badges.push({ label: 'High Confidence', className: 'bg-emerald-100 text-emerald-800 text-xs px-1.5 py-0.5 rounded' });
    }
    if (opp.source_signals?.includes('topic_growth')) {
      badges.push({ label: 'Rising Topic', className: 'bg-blue-100 text-blue-800 text-xs px-1.5 py-0.5 rounded' });
    }
    if (opp.source_signals?.includes('lead')) {
      badges.push({ label: 'Lead Driven', className: 'bg-amber-100 text-amber-800 text-xs px-1.5 py-0.5 rounded' });
    }
    const signalCount = opp.source_signals?.length ?? 0;
    if (signalCount >= 2 && (opp.confidence_score ?? 0) >= 0.5) {
      badges.push({ label: 'Learning Boosted', className: 'bg-purple-100 text-purple-800 text-xs px-1.5 py-0.5 rounded' });
    }
    return badges;
  };

  if (loading) {
    return <div className={`text-sm text-slate-500 ${className}`}>Loading…</div>;
  }
  if (error) {
    return <div className={`text-sm text-amber-700 ${className}`}>{error}</div>;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {display.length === 0 ? (
        <div className="text-sm text-slate-500">No content opportunities detected yet.</div>
      ) : (
        display.map((opp, i) => (
          <div
            key={`${opp.topic}-${opp.opportunity_type}-${i}`}
            className="rounded border border-slate-100 bg-slate-50 p-3 text-sm"
          >
            <div className="font-medium text-slate-800">{opp.suggested_title}</div>
            <div className="text-xs text-slate-500 mt-1">
              {LABELS[opp.opportunity_type]} · {opp.topic}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Confidence: {(opp.confidence_score * 100).toFixed(0)}%
            </div>
            {opp.quality_warning && (
              <div className="text-xs text-amber-700 mt-0.5 font-medium">⚠ Low quality signal</div>
            )}
            <div className="flex flex-wrap gap-1 mt-1">
              {getBadges(opp).map((b) => (
                <span key={b.label} className={b.className}>
                  {b.label}
                </span>
              ))}
            </div>
            {opp.source_signals && opp.source_signals.length > 0 && (
              <div className="text-xs text-slate-400 mt-0.5">
                Signals: {opp.source_signals.join(' + ')}
              </div>
            )}
            {organizationId && (
              <div className="flex gap-1 mt-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleReview(opp)}
                  disabled={!!actionBusy}
                  className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
                >
                  Review
                </button>
                <button
                  type="button"
                  onClick={() => handleIgnore(opp)}
                  disabled={!!actionBusy}
                  className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
                >
                  Ignore
                </button>
                <button
                  type="button"
                  onClick={() => handleSendToCampaign(opp)}
                  disabled={!!actionBusy}
                  className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-800 hover:bg-indigo-200 disabled:opacity-50"
                >
                  Send to Campaign Planner
                </button>
              </div>
            )}
          </div>
        ))
      )}
      {modalOpp && (
        <ContentOpportunityReviewModal
          opportunity={modalOpp}
          opportunityId={modalId}
          organizationId={organizationId}
          open={!!modalOpp}
          onClose={closeModal}
          onApprove={() => onRefresh?.()}
          onIgnore={() => onRefresh?.()}
          onSendToCampaign={() => onRefresh?.()}
          onAction={() => onRefresh?.()}
        />
      )}
    </div>
  );
});
