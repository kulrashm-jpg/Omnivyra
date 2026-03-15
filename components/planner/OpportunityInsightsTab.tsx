/**
 * Opportunity Insights Tab
 * Displays opportunities from opportunity_radar (campaign_engagement source).
 * Apply to Campaign | Ignore buttons.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Target, Check, X, Loader2, Sparkles } from 'lucide-react';

export interface OpportunityInsightsTabProps {
  companyId?: string | null;
  campaignId?: string | null;
  onApplied?: () => void;
}

type OpportunityItem = {
  id: string;
  title: string;
  description: string | null;
  signal_count: number;
  confidence_score: number;
  topic_keywords: string[];
  related_campaign_id: string | null;
  suggested_action: string | null;
  campaign_proposal_available?: boolean;
};

export function OpportunityInsightsTab({
  companyId,
  campaignId,
  onApplied,
}: OpportunityInsightsTabProps) {
  const [items, setItems] = useState<OpportunityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [ignoringId, setIgnoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const params = new URLSearchParams({
      organization_id: companyId,
      source: 'campaign_engagement',
      format: 'items',
    });
    if (campaignId) params.set('campaignId', campaignId);

    fetch(`/api/engagement/opportunity-radar?${params}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = (data as { error?: string })?.error || res.statusText;
          const e = new Error(msg) as Error & { status?: number };
          e.status = res.status;
          throw e;
        }
        return data;
      })
      .then((data) => setItems((data.items ?? []).slice(0, 10)))
      .catch((err) => {
        const status = (err as Error & { status?: number }).status;
        setError(
          status === 500 || status === 403
            ? 'Unable to load opportunity insights. Please try again later.'
            : err?.message ?? 'Failed to load'
        );
      })
      .finally(() => setLoading(false));
  }, [companyId, campaignId]);

  const handleApply = async (oppId: string) => {
    if (!campaignId) return;
    setApplyingId(oppId);
    try {
      const res = await fetch('/api/campaigns/planner/apply-opportunity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ campaignId, opportunityId: oppId, companyId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to apply');
      setItems((prev) => prev.filter((o) => o.id !== oppId));
      onApplied?.();
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to apply');
    } finally {
      setApplyingId(null);
    }
  };

  const handleIgnore = async (oppId: string) => {
    setIgnoringId(oppId);
    try {
      const res = await fetch('/api/campaigns/planner/ignore-opportunity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ opportunityId: oppId, companyId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to ignore');
      setItems((prev) => prev.filter((o) => o.id !== oppId));
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to ignore');
    } finally {
      setIgnoringId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center gap-2 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading opportunities…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-amber-700 bg-amber-50 rounded-lg">
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No opportunity insights from campaign engagement signals yet. The scanner runs every 4 hours.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <p className="text-xs text-gray-600 mb-3">
        Opportunities surfaced from engagement signals. Apply to add topics to your campaign plan.
      </p>
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
        >
          <div className="font-medium text-sm text-gray-900">{item.title}</div>
          {item.description && (
            <p className="text-xs text-gray-600 mt-1 line-clamp-2">{item.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
            <span>{item.signal_count} signals</span>
            <span>·</span>
            <span>{(item.confidence_score * 100).toFixed(0)}% confidence</span>
          </div>
          {item.suggested_action && (
            <p className="text-xs text-indigo-600 mt-1.5 flex items-center gap-1">
              {item.campaign_proposal_available && <Sparkles className="w-3.5 h-3.5 text-emerald-500" />}
              {item.suggested_action}
            </p>
          )}
          {item.campaign_proposal_available && (
            <Link
              href={companyId ? `/campaign-proposals?companyId=${encodeURIComponent(companyId)}` : '/campaign-proposals'}
              className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-200"
            >
              <Sparkles className="w-3.5 h-3.5" />
              View Campaign Proposal
            </Link>
          )}
          <div className="flex gap-2 mt-3">
            {campaignId && (
              <button
                type="button"
                onClick={() => handleApply(item.id)}
                disabled={!!applyingId}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {applyingId === item.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Apply to Campaign
              </button>
            )}
            <button
              type="button"
              onClick={() => handleIgnore(item.id)}
              disabled={!!ignoringId}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {ignoringId === item.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Ignore
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
