/**
 * StrategicInsightsPanel
 * Displays CMO-level strategic insights from the Strategic Insight Engine.
 * Fetches from GET /api/campaigns/[id]/strategic-insights.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Lightbulb, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface ContentIdea {
  title: string;
  format: string;
  summary: string;
}

export type InsightType =
  | 'campaign_direction'
  | 'content_strategy'
  | 'audience_shift'
  | 'market_opportunity'
  | 'engagement_risk';

export interface StrategicInsight {
  title: string;
  summary: string;
  insight_type: InsightType;
  insight_category?: string;
  confidence: number;
  supporting_signals: string[];
  recommended_action: string;
  impact_score?: number;
}

export interface StrategicInsightReport {
  report_id: string;
  generated_at: string;
  campaign_id: string;
  company_id: string;
  insights: StrategicInsight[];
}

const TYPE_LABELS: Record<InsightType, string> = {
  campaign_direction: 'Campaign Direction',
  content_strategy: 'Content Strategy',
  audience_shift: 'Audience Shift',
  market_opportunity: 'Market Opportunity',
  engagement_risk: 'Engagement Risk',
};

const FORMAT_LABELS: Record<string, string> = {
  post: 'Post',
  article: 'Article',
  video: 'Video',
  thread: 'Thread',
};

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
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
      <span className="text-xs font-medium text-slate-600">
        {formatConfidence(confidence)}
      </span>
    </div>
  );
}

export type DashboardInsight = {
  title: string;
  summary: string;
  confidence: number;
  recommended_action: string;
};

export interface StrategicInsightsPanelProps {
  campaignId?: string | null;
  companyId?: string | null;
  /** When provided, use pre-fetched insights (dashboard mode); skips fetch */
  insights?: DashboardInsight[] | null;
  /** In dashboard mode, show loading when true and insights not yet loaded */
  loading?: boolean;
  className?: string;
  onError?: (msg: string) => void;
}

export function StrategicInsightsPanel({
  campaignId = null,
  companyId,
  insights: insightsProp,
  loading: loadingProp,
  className = '',
  onError,
}: StrategicInsightsPanelProps) {
  const [report, setReport] = useState<StrategicInsightReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [contentIdeasByIdx, setContentIdeasByIdx] = useState<Record<number, ContentIdea[]>>({});

  const fetchInsights = useCallback(async () => {
    if (!campaignId || insightsProp != null || loadingProp) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      const res = await fetch(
        `/api/campaigns/${campaignId}/strategic-insights?${params.toString()}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.details || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as StrategicInsightReport;
      setReport(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load strategic insights';
      onError?.(msg);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId, companyId, insightsProp, loadingProp, onError]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const handleGenerateContentIdeas = useCallback(
    async (insight: StrategicInsight | DashboardInsight, idx: number) => {
      setGeneratingIdx(idx);
      try {
        const res = await fetch('/api/insight/content-ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            insight: {
              title: insight.title,
              summary: insight.summary,
              insight_type: (insight as StrategicInsight).insight_type,
              recommended_action: insight.recommended_action,
              supporting_signals: (insight as StrategicInsight).supporting_signals,
            },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to generate content ideas');
        const ideas = Array.isArray(data.contentIdeas) ? data.contentIdeas : [];
        setContentIdeasByIdx((prev) => ({ ...prev, [idx]: ideas }));
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Failed to generate content ideas');
      } finally {
        setGeneratingIdx(null);
      }
    },
    [onError]
  );

  const insightsList = insightsProp ?? report?.insights ?? [];
  const sortedInsights = [...insightsList].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
  );

  if (loadingProp && insightsProp === undefined) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Strategic Insights</CardTitle>
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

  if (insightsProp != null) {
    if (sortedInsights.length === 0) {
      return (
        <Card className={className}>
          <CardHeader>
            <CardTitle>Strategic Insights</CardTitle>
            <p className="text-sm text-slate-600">No strategic insights yet.</p>
          </CardHeader>
        </Card>
      );
    }
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Strategic Insights</CardTitle>
          <p className="text-sm text-slate-600">
            {sortedInsights.length} insight{sortedInsights.length !== 1 ? 's' : ''} — sorted by confidence
          </p>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {sortedInsights.map((insight, idx) => (
              <li
                key={idx}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-slate-900 mb-1">{insight.title}</h4>
                    <p className="text-sm text-slate-700 mb-2">{insight.summary}</p>
                    <p className="text-xs text-slate-600 font-medium">Recommended action</p>
                    <p className="text-sm text-indigo-700 mb-2">{insight.recommended_action}</p>
                    <button
                      type="button"
                      onClick={() => handleGenerateContentIdeas(insight, idx)}
                      disabled={generatingIdx === idx}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {generatingIdx === idx ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Lightbulb className="h-4 w-4" />
                      )}
                      {generatingIdx === idx ? 'Generating…' : 'Generate Content Ideas'}
                    </button>
                    {contentIdeasByIdx[idx]?.length ? (
                      <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                        <p className="text-xs font-medium text-slate-600">Content ideas</p>
                        <ul className="space-y-2">
                          {contentIdeasByIdx[idx].map((idea, i) => (
                            <li key={i} className="text-sm rounded-md bg-slate-50 p-2">
                              <Badge variant="outline" className="text-xs mr-1.5">
                                {FORMAT_LABELS[idea.format] ?? idea.format}
                              </Badge>
                              <span className="font-medium text-slate-900">{idea.title}</span>
                              {idea.summary && (
                                <p className="text-slate-600 mt-0.5 text-xs">{idea.summary}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0">
                    <ConfidenceIndicator confidence={insight.confidence} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  if (!campaignId) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Strategic Insights</CardTitle>
          <p className="text-sm text-slate-600">Select a campaign to view insights.</p>
        </CardHeader>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Strategic Insights</CardTitle>
          <p className="text-sm text-slate-600">Loading insights…</p>
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

  if (!report || report.insights.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Strategic Insights</CardTitle>
          <p className="text-sm text-slate-600">
            No strategic insights yet. Insights are generated by correlating campaign health, engagement, trends, and inbox signals.
          </p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Strategic Insights</CardTitle>
        <p className="text-sm text-slate-600">
          {report.insights.length} insight{report.insights.length !== 1 ? 's' : ''} — sorted by impact and confidence
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {report.insights.map((insight, idx) => (
            <li
              key={idx}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-xs">
                      {TYPE_LABELS[insight.insight_type]}
                    </Badge>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900 mb-1">
                    {insight.title}
                  </h4>
                  <p className="text-sm text-slate-700 mb-2">{insight.summary}</p>
                  <p className="text-xs text-slate-600 font-medium">Recommended action</p>
                  <p className="text-sm text-indigo-700 mb-2">{insight.recommended_action}</p>
                  <button
                    type="button"
                    onClick={() => handleGenerateContentIdeas(insight, idx)}
                    disabled={generatingIdx === idx}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {generatingIdx === idx ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Lightbulb className="h-4 w-4" />
                    )}
                    {generatingIdx === idx ? 'Generating…' : 'Generate Content Ideas'}
                  </button>
                  {contentIdeasByIdx[idx]?.length ? (
                    <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                      <p className="text-xs font-medium text-slate-600">Content ideas</p>
                      <ul className="space-y-2">
                        {contentIdeasByIdx[idx].map((idea, i) => (
                          <li key={i} className="text-sm rounded-md bg-slate-50 p-2">
                            <Badge variant="outline" className="text-xs mr-1.5">
                              {FORMAT_LABELS[idea.format] ?? idea.format}
                            </Badge>
                            <span className="font-medium text-slate-900">{idea.title}</span>
                            {idea.summary && (
                              <p className="text-slate-600 mt-0.5 text-xs">{idea.summary}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0">
                  <ConfidenceIndicator confidence={insight.confidence} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
