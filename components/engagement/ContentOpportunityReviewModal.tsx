/**
 * ContentOpportunityReviewModal — review content opportunity details.
 * Full lifecycle: Assign, Approve, Ignore, Send to Campaign Planner, Mark Content Created, Record Impact, Complete.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { ContentOpportunity, ContentOpportunityType } from './ContentOpportunitiesPanel';

const LABELS: Record<ContentOpportunityType, string> = {
  tutorial: 'Tutorial',
  comparison: 'Comparison',
  explainer: 'Explainer',
  thought_leadership: 'Thought Leadership',
  product_announcement: 'Product Announcement',
  landing_page: 'Landing Page',
};

type StoredOpportunity = {
  id: string;
  status: string;
  assigned_to?: string | null;
  campaign_id?: string | null;
  content_id?: string | null;
  impact_metrics?: Record<string, number> | null;
  created_at: string;
  updated_at: string | null;
};

const STATUS_ORDER = [
  'new',
  'reviewed',
  'approved',
  'assigned',
  'sent_to_campaign',
  'in_campaign',
  'content_created',
  'performance_tracked',
  'completed',
];

const STATUS_LABELS: Record<string, string> = {
  new: 'Opportunity Created',
  reviewed: 'Reviewed',
  approved: 'Approved',
  assigned: 'Assigned',
  sent_to_campaign: 'Campaign Created',
  in_campaign: 'In Campaign',
  content_created: 'Content Published',
  performance_tracked: 'Impact Recorded',
  completed: 'Completed',
  ignored: 'Ignored',
};

export interface ContentOpportunityReviewModalProps {
  opportunity: ContentOpportunity;
  opportunityId: string | null;
  organizationId: string | null;
  open: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  onIgnore: (id: string) => void;
  onSendToCampaign: (id: string, payload: { topic: string; suggested_title: string; opportunity_type: string; signal_summary: object }) => void;
  onAction?: () => void;
}

export const ContentOpportunityReviewModal = React.memo(function ContentOpportunityReviewModal({
  opportunity,
  opportunityId,
  organizationId,
  open,
  onClose,
  onApprove,
  onIgnore,
  onSendToCampaign,
  onAction,
}: ContentOpportunityReviewModalProps) {
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState<StoredOpportunity | null>(null);
  const [impactViews, setImpactViews] = useState('');
  const [impactEngagement, setImpactEngagement] = useState('');
  const [impactLeads, setImpactLeads] = useState('');
  const [impactConversion, setImpactConversion] = useState('');

  const fetchStored = useCallback(async () => {
    if (!opportunityId || !organizationId) return;
    try {
      const res = await fetch(
        `/api/engagement/content-opportunities?organization_id=${encodeURIComponent(organizationId)}&id=${encodeURIComponent(opportunityId)}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setStored(data);
      }
    } catch {
      setStored(null);
    }
  }, [opportunityId, organizationId]);

  useEffect(() => {
    if (open && opportunityId && organizationId) {
      void fetchStored();
    } else {
      setStored(null);
    }
  }, [open, opportunityId, organizationId, fetchStored]);

  if (!open) return null;

  const ss = opportunity.signal_summary;

  const runLifecycle = async (
    action: string,
    extra: Record<string, unknown> = {}
  ): Promise<boolean> => {
    if (!opportunityId || !organizationId) return false;
    const res = await fetch('/api/engagement/content-opportunities/lifecycle', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: opportunityId,
        action,
        organization_id: organizationId,
        ...extra,
      }),
    });
    return res.ok;
  };

  const handleApprove = async () => {
    if (!opportunityId || !organizationId) return;
    setBusy(true);
    try {
      await fetch('/api/engagement/content-opportunities/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: opportunityId,
          status: 'approved',
          organization_id: organizationId,
        }),
      });
      onApprove(opportunityId);
      onAction?.();
      await fetchStored();
    } finally {
      setBusy(false);
    }
  };

  const handleIgnore = async () => {
    if (!opportunityId || !organizationId) return;
    setBusy(true);
    try {
      await fetch('/api/engagement/content-opportunities/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: opportunityId,
          status: 'ignored',
          organization_id: organizationId,
        }),
      });
      onIgnore(opportunityId);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleSendToCampaign = async () => {
    if (!opportunityId || !organizationId) return;
    setBusy(true);
    try {
      const payload = {
        topic: opportunity.topic,
        suggested_title: opportunity.suggested_title,
        opportunity_type: opportunity.opportunity_type,
        signal_summary: opportunity.signal_summary,
      };
      await fetch('/api/engagement/content-opportunities/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: opportunityId,
          status: 'sent_to_campaign',
          organization_id: organizationId,
        }),
      });
      window.dispatchEvent(new CustomEvent('campaign_planner_content_seed', { detail: payload }));
      onSendToCampaign(opportunityId, payload);
      onAction?.();
      await fetchStored();
    } finally {
      setBusy(false);
    }
  };

  const handleAssign = async () => {
    setBusy(true);
    try {
      const ok = await runLifecycle('assign');
      if (ok) {
        onAction?.();
        await fetchStored();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleMarkContentCreated = async () => {
    setBusy(true);
    const contentId = prompt('Enter content ID (or leave blank to skip content linkage):');
    if (contentId === null) {
      setBusy(false);
      return;
    }
    const ok = contentId?.trim()
      ? await runLifecycle('link_content', { content_id: contentId.trim() })
      : await fetch('/api/engagement/content-opportunities/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            id: opportunityId,
            status: 'content_created',
            organization_id: organizationId,
          }),
        }).then((r) => r.ok);
    if (ok) {
      onAction?.();
      await fetchStored();
    }
    setBusy(false);
  };

  const handleRecordImpact = async () => {
    setBusy(true);
    const metrics: Record<string, number> = {};
    if (impactViews) metrics.views = parseFloat(impactViews) || 0;
    if (impactEngagement) metrics.engagement_rate = (parseFloat(impactEngagement) || 0) / 100;
    if (impactLeads) metrics.leads_generated = parseFloat(impactLeads) || 0;
    if (impactConversion) metrics.conversion_rate = (parseFloat(impactConversion) || 0) / 100;
    const ok = Object.keys(metrics).length > 0
      ? await runLifecycle('record_impact', { metrics })
      : false;
    if (ok) {
      setImpactViews('');
      setImpactEngagement('');
      setImpactLeads('');
      setImpactConversion('');
      onAction?.();
      await fetchStored();
    }
    setBusy(false);
  };

  const handleComplete = async () => {
    setBusy(true);
    const ok = await runLifecycle('complete');
    if (ok) {
      onAction?.();
      await fetchStored();
    }
    setBusy(false);
  };

  const currentStatusIdx = stored?.status ? STATUS_ORDER.indexOf(stored.status) : -1;
  const im = stored?.impact_metrics ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-w-lg w-full mx-4 rounded-lg border border-slate-200 bg-white shadow-xl p-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-slate-800">Review Content Opportunity</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-lg leading-none"
          >
            ×
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <span className="text-slate-500">Topic</span>
            <div className="font-medium text-slate-800">{opportunity.topic}</div>
          </div>
          <div>
            <span className="text-slate-500">Suggested Title</span>
            <div className="font-medium text-slate-800">{opportunity.suggested_title}</div>
          </div>
          <div>
            <span className="text-slate-500">Opportunity Type</span>
            <div className="text-slate-800">{LABELS[opportunity.opportunity_type]}</div>
          </div>
          <div>
            <span className="text-slate-500">Confidence Score</span>
            <div className="text-slate-800">{(opportunity.confidence_score * 100).toFixed(0)}%</div>
          </div>
          <div>
            <span className="text-slate-500">Signal Summary</span>
            <div className="text-slate-600 mt-1">
              Questions: {ss.questions} · Problems: {ss.problems} · Comparisons: {ss.comparisons} · Feature requests: {ss.feature_requests}
            </div>
          </div>
          {stored && (
            <>
              <div>
                <span className="text-slate-500">Assigned To</span>
                <div className="text-slate-800">{stored.assigned_to ?? '—'}</div>
              </div>
              <div>
                <span className="text-slate-500">Campaign</span>
                <div className="text-slate-800">{stored.campaign_id ?? '—'}</div>
              </div>
              <div>
                <span className="text-slate-500">Status Timeline</span>
                <div className="mt-1 space-y-1 text-xs">
                  {STATUS_ORDER.slice(0, currentStatusIdx + 1).map((s, i) => (
                    <div key={s} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-500" />
                      {STATUS_LABELS[s] ?? s}
                    </div>
                  ))}
                  {currentStatusIdx < 0 && stored.status && (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-slate-300" />
                      {STATUS_LABELS[stored.status] ?? stored.status}
                    </div>
                  )}
                </div>
              </div>
              {(im.views != null || im.engagement_rate != null || im.leads_generated != null) && (
                <div>
                  <span className="text-slate-500">Impact Metrics</span>
                  <div className="text-slate-600 mt-1">
                    {im.views != null && `Views: ${im.views}`}
                    {im.engagement_rate != null && ` · Engagement: ${(im.engagement_rate * 100).toFixed(1)}%`}
                    {im.leads_generated != null && ` · Leads: ${im.leads_generated}`}
                    {im.conversion_rate != null && ` · Conversion: ${(im.conversion_rate * 100).toFixed(1)}%`}
                  </div>
                </div>
              )}
            </>
          )}
          {stored?.status === 'content_created' || stored?.status === 'performance_tracked' ? (
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <span className="text-slate-500 block">Record Impact</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <input
                  type="text"
                  placeholder="Views"
                  value={impactViews}
                  onChange={(e) => setImpactViews(e.target.value)}
                  className="px-2 py-1 border border-slate-200 rounded"
                />
                <input
                  type="text"
                  placeholder="Engagement %"
                  value={impactEngagement}
                  onChange={(e) => setImpactEngagement(e.target.value)}
                  className="px-2 py-1 border border-slate-200 rounded"
                />
                <input
                  type="text"
                  placeholder="Leads"
                  value={impactLeads}
                  onChange={(e) => setImpactLeads(e.target.value)}
                  className="px-2 py-1 border border-slate-200 rounded"
                />
                <input
                  type="text"
                  placeholder="Conversion %"
                  value={impactConversion}
                  onChange={(e) => setImpactConversion(e.target.value)}
                  className="px-2 py-1 border border-slate-200 rounded"
                />
              </div>
              <button
                type="button"
                onClick={handleRecordImpact}
                disabled={busy}
                className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              >
                Record Impact
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
          {(!stored || ['new', 'reviewed'].includes(stored.status)) && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            >
              Approve
            </button>
          )}
          {(!stored || ['new', 'reviewed', 'approved'].includes(stored?.status ?? '')) && (
            <button
              type="button"
              onClick={handleIgnore}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            >
              Ignore
            </button>
          )}
          {(!stored || ['new', 'reviewed', 'approved', 'assigned'].includes(stored?.status ?? '')) && (
            <>
              <button
                type="button"
                onClick={handleAssign}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
              >
                Assign
              </button>
              <button
                type="button"
                onClick={handleSendToCampaign}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Send to Campaign Planner
              </button>
            </>
          )}
          {stored && ['sent_to_campaign', 'in_campaign'].includes(stored.status) && (
            <button
              type="button"
              onClick={handleMarkContentCreated}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            >
              Mark Content Created
            </button>
          )}
          {stored && ['content_created', 'performance_tracked'].includes(stored.status) && (
            <button
              type="button"
              onClick={handleComplete}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Complete Opportunity
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
