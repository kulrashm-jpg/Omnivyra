/**
 * InsightPanel — Engagement insights with evidence.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { InsightEvidenceModal } from './InsightEvidenceModal';

const PLATFORM_ICONS: Record<string, string> = {
  linkedin: '💼',
  twitter: '🐦',
  youtube: '▶️',
  reddit: '🤖',
  slack: '💬',
  discord: '🎮',
  github: '🐙',
  stackoverflow: '📚',
};

export type Insight = {
  id: string;
  insight_title: string;
  insight_summary: string;
  insight_type: string;
  change_percentage: number | null;
  evidence_count: number;
  evidence: Array<{
    thread_id: string;
    message_id: string;
    author_name: string | null;
    platform: string;
    text_snippet: string | null;
  }>;
};

export interface InsightPanelProps {
  organizationId: string | null;
  limit?: number;
  onCountChange?: (count: number) => void;
  onOpenConversation?: (threadId: string) => void;
  className?: string;
}

export const InsightPanel = React.memo(function InsightPanel({
  organizationId,
  limit = 10,
  onCountChange,
  onOpenConversation,
  className = '',
}: InsightPanelProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidenceModal, setEvidenceModal] = useState<Insight | null>(null);

  const fetchInsights = useCallback(async () => {
    if (!organizationId) {
      setInsights([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/engagement/insights?organization_id=${encodeURIComponent(organizationId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      const list = (json.insights ?? []).slice(0, limit);
      setInsights(list);
      onCountChange?.(list.length);
    } catch (e) {
      setError((e as Error).message);
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, limit, onCountChange]);

  useEffect(() => {
    void fetchInsights();
  }, [fetchInsights]);

  if (!organizationId) {
    return (
      <div className={`text-sm text-slate-500 ${className}`}>
        Select an organization to view insights.
      </div>
    );
  }

  if (loading) {
    return <div className={`text-sm text-slate-500 ${className}`}>Loading insights…</div>;
  }

  if (error) {
    return <div className={`text-sm text-amber-700 ${className}`}>{error}</div>;
  }

  if (insights.length === 0) {
    return (
      <div className={`text-sm text-slate-500 ${className}`}>
        No insights yet. The system analyzes engagement trends every 6 hours.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide">Insights</h4>
      <div className="space-y-2">
        {insights.map((insight) => (
          <div
            key={insight.id}
            className="rounded border border-slate-100 bg-slate-50 p-2 text-sm"
          >
            <div className="font-medium text-slate-700">{insight.insight_title}</div>
            {insight.change_percentage != null && (
              <div className="text-xs text-slate-500 mt-0.5">
                {insight.change_percentage > 0 ? '↑' : insight.change_percentage < 0 ? '↓' : ''}{' '}
                {insight.change_percentage}% this week
              </div>
            )}
            <button
              type="button"
              onClick={() => setEvidenceModal(insight)}
              className="mt-2 text-xs text-blue-600 hover:text-blue-800"
            >
              View Evidence ({insight.evidence_count})
            </button>
          </div>
        ))}
      </div>
      {evidenceModal && (
        <InsightEvidenceModal
          insight={evidenceModal}
          onClose={() => setEvidenceModal(null)}
          onOpenConversation={(threadId) => {
            onOpenConversation?.(threadId);
            setEvidenceModal(null);
          }}
        />
      )}
    </div>
  );
});
