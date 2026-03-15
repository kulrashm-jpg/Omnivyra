/**
 * OpportunityPanel
 * Displays marketing opportunities from the Opportunity Detection Engine.
 * Fetches from GET /api/company/opportunities.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Rocket } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export type OpportunityType =
  | 'content_opportunity'
  | 'campaign_opportunity'
  | 'audience_opportunity'
  | 'market_opportunity'
  | 'engagement_opportunity';

export interface Opportunity {
  title: string;
  description: string;
  opportunity_type: OpportunityType;
  confidence: number;
  opportunity_score: number;
  supporting_signals: string[];
  recommended_action: string;
}

export interface OpportunityReport {
  report_id: string;
  generated_at: string;
  company_id: string;
  opportunities: Opportunity[];
}

const TYPE_LABELS: Record<OpportunityType, string> = {
  content_opportunity: 'Content',
  campaign_opportunity: 'Campaign',
  audience_opportunity: 'Audience',
  market_opportunity: 'Market',
  engagement_opportunity: 'Engagement',
};

function ScoreIndicator({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-slate-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-slate-600">{score}</span>
    </div>
  );
}

function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  return (
    <span className="text-xs text-slate-600">{pct}% confidence</span>
  );
}

export type DashboardOpportunity = {
  title: string;
  description: string;
  opportunity_score: number;
  confidence: number;
  opportunity_type?: OpportunityType | string;
};

export interface OpportunityPanelProps {
  companyId?: string | null;
  /** When provided, use pre-fetched opportunities (dashboard mode); skips fetch */
  opportunities?: DashboardOpportunity[] | null;
  /** In dashboard mode, show loading when true and opportunities not yet loaded */
  loading?: boolean;
  className?: string;
  onError?: (msg: string) => void;
}

const OPPORTUNITY_CONTEXT_KEY = 'omnivyra_opportunity_context_';

function storeOpportunityContext(key: string, context: object): void {
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(OPPORTUNITY_CONTEXT_KEY + key, JSON.stringify(context));
    } catch {
      // ignore storage errors
    }
  }
}

export function OpportunityPanel({
  companyId = null,
  opportunities: opportunitiesProp,
  loading: loadingProp,
  className = '',
  onError,
}: OpportunityPanelProps) {
  const router = useRouter();
  const [report, setReport] = useState<OpportunityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [launchingId, setLaunchingId] = useState<number | null>(null);

  const fetchOpportunities = useCallback(async () => {
    if (!companyId || opportunitiesProp != null || loadingProp) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/company/opportunities?companyId=${encodeURIComponent(companyId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.details || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as OpportunityReport;
      setReport(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load opportunities';
      onError?.(msg);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, opportunitiesProp, loadingProp, onError]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  const handleLaunchCampaign = useCallback(
    async (opp: Opportunity | DashboardOpportunity, index: number) => {
      if (!companyId) return;
      setLaunchingId(index);
      try {
        const res = await fetch('/api/opportunity/build-campaign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            opportunity: {
              title: opp.title,
              description: opp.description,
              opportunity_type: opp.opportunity_type,
              confidence: opp.confidence,
              opportunity_score: opp.opportunity_score,
              supporting_signals: (opp as Opportunity).supporting_signals,
              recommended_action: (opp as Opportunity).recommended_action,
            },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to build campaign');
        const key = `opp_${Date.now()}`;
        storeOpportunityContext(key, {
          idea_spine: data.idea_spine,
          strategy_context: data.strategy_context,
          campaign_direction: data.campaign_direction,
        });
        router.push(
          `/campaign-planner?opportunityId=${encodeURIComponent(key)}&companyId=${encodeURIComponent(companyId)}`
        );
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Failed to launch campaign');
      } finally {
        setLaunchingId(null);
      }
    },
    [companyId, router, onError]
  );

  const opportunitiesList = opportunitiesProp ?? report?.opportunities ?? [];
  const sortedOpps = [...opportunitiesList].sort(
    (a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0)
  );

  if (loadingProp && opportunitiesProp === undefined) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Market Opportunities</CardTitle>
          <p className="text-sm text-slate-600">Loading…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (opportunitiesProp != null) {
    if (sortedOpps.length === 0) {
      return (
        <Card className={className}>
          <CardHeader>
            <CardTitle>Market Opportunities</CardTitle>
            <p className="text-sm text-slate-600">No opportunities detected yet.</p>
          </CardHeader>
        </Card>
      );
    }
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Market Opportunities</CardTitle>
          <p className="text-sm text-slate-600">
            {sortedOpps.length} opportunity{sortedOpps.length !== 1 ? 'ies' : ''} — sorted by score
          </p>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {sortedOpps.map((opp, idx) => (
              <li
                key={idx}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {opp.opportunity_type && TYPE_LABELS[opp.opportunity_type as OpportunityType] && (
                      <Badge variant="secondary" className="text-xs mb-1">
                        {TYPE_LABELS[opp.opportunity_type as OpportunityType]}
                      </Badge>
                    )}
                    <h4 className="text-sm font-semibold text-slate-900 mb-1">{opp.title}</h4>
                    <p className="text-sm text-slate-700 mb-2">{opp.description}</p>
                    {companyId && (
                      <button
                        type="button"
                        onClick={() => handleLaunchCampaign(opp, idx)}
                        disabled={launchingId === idx}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Rocket className="h-4 w-4" />
                        {launchingId === idx ? 'Launching…' : 'Launch Campaign'}
                      </button>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <ScoreIndicator score={opp.opportunity_score} />
                    <ConfidenceIndicator confidence={opp.confidence} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  if (!companyId) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Opportunities</CardTitle>
          <p className="text-sm text-slate-600">Select a company to view opportunities.</p>
        </CardHeader>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Opportunities</CardTitle>
          <p className="text-sm text-slate-600">Loading opportunities…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!report || report.opportunities.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Opportunities</CardTitle>
          <p className="text-sm text-slate-600">
            No opportunities detected yet. Opportunities are generated from trends, engagement, strategic insights, and inbox signals.
          </p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Opportunities</CardTitle>
        <p className="text-sm text-slate-600">
          {report.opportunities.length} opportunity{report.opportunities.length !== 1 ? 'ies' : ''} — sorted by score and confidence
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {report.opportunities.map((opp, idx) => (
            <li
              key={idx}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-xs">
                      {TYPE_LABELS[opp.opportunity_type]}
                    </Badge>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900 mb-1">
                    {opp.title}
                  </h4>
                  <p className="text-sm text-slate-700 mb-2">{opp.description}</p>
                  <p className="text-xs text-slate-600 font-medium">Recommended action</p>
                  <p className="text-sm text-indigo-700 mb-2">{opp.recommended_action}</p>
                  {companyId && (
                    <button
                      type="button"
                      onClick={() => handleLaunchCampaign(opp, idx)}
                      disabled={launchingId === idx}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <Rocket className="h-4 w-4" />
                      {launchingId === idx ? 'Launching…' : 'Launch Campaign'}
                    </button>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <ScoreIndicator score={opp.opportunity_score} />
                  <ConfidenceIndicator confidence={opp.confidence} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
