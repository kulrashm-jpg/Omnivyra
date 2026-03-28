/**
 * Performance Insights Card
 * Displays issues, opportunities, and recommendations derived from
 * the deterministic performance analyzer.
 *
 * Usage:
 *   <PerformanceInsightsCard campaignId="abc-123" />
 *
 * Self-fetching — calls /api/campaigns/performance-insights internally.
 * Shows a loading skeleton, empty state, or populated insight sections.
 */

import React, { useEffect, useState } from 'react';
import type { PerformanceInsight } from '../../lib/performance/performanceAnalyzer';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

interface PerformanceInsightResponse {
  campaignId: string;
  insight: PerformanceInsight;
  meta: {
    totalSlots: number;
    publishedSlots: number;
    analysedAt: string;
  };
}

interface PerformanceInsightsCardProps {
  campaignId: string;
  /** Optional: collapse-by-default for use in dense layouts. */
  defaultCollapsed?: boolean;
}

export function PerformanceInsightsCard({
  campaignId,
  defaultCollapsed = false,
}: PerformanceInsightsCardProps) {
  const [data, setData] = useState<PerformanceInsightResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchWithAuth(`/api/campaigns/performance-insights?campaignId=${encodeURIComponent(campaignId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.insight) {
          setData(json as PerformanceInsightResponse);
        } else {
          setError(json?.error || 'No insight data returned.');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load performance insights.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
        <div className="space-y-2">
          <div className="h-3 bg-gray-100 rounded w-full" />
          <div className="h-3 bg-gray-100 rounded w-4/5" />
          <div className="h-3 bg-gray-100 rounded w-3/5" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { insight, meta } = data;
  const hasIssues = insight.issues.length > 0;
  const hasOpportunities = insight.opportunities.length > 0;
  const hasRecommendations = insight.recommendations.length > 0;

  const publishPct = meta.totalSlots > 0
    ? Math.round((meta.publishedSlots / meta.totalSlots) * 100)
    : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Performance Insights</span>
          <span className="text-xs text-gray-400 font-normal">
            {meta.publishedSlots}/{meta.totalSlots} posts published ({publishPct}%)
          </span>
          {hasIssues && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
              {insight.issues.length} issue{insight.issues.length !== 1 ? 's' : ''}
            </span>
          )}
          {hasOpportunities && !hasIssues && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
              {insight.opportunities.length} signal{insight.opportunities.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100">

          {/* Issues */}
          {hasIssues && (
            <section>
              <h4 className="text-xs font-semibold text-red-700 uppercase tracking-wide mt-3 mb-2">
                Issues
              </h4>
              <ul className="space-y-1.5">
                {insight.issues.map((issue, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="mt-0.5 flex-shrink-0 h-4 w-4 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold">!</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Opportunities */}
          {hasOpportunities && (
            <section>
              <h4 className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                Opportunities
              </h4>
              <ul className="space-y-1.5">
                {insight.opportunities.map((opp, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="mt-0.5 flex-shrink-0 text-green-500">↑</span>
                    <span>{opp}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Recommendations */}
          {hasRecommendations && (
            <section>
              <h4 className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2">
                Recommendations
              </h4>
              <ul className="space-y-1.5">
                {insight.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="mt-0.5 flex-shrink-0 text-indigo-400">→</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Footer */}
          <p className="text-xs text-gray-400 pt-1 border-t border-gray-100">
            Analysed {new Date(meta.analysedAt).toLocaleString()} · Rule-based · No AI
          </p>
        </div>
      )}
    </div>
  );
}
