/**
 * TrendingTopicsPanel — topic clusters from engagement conversations.
 * Click a topic to filter ThreadList by threads containing that topic.
 */

import React, { useState, useEffect, useCallback } from 'react';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_DISPLAY = 6;

export type TrendingTopic = {
  topic: string;
  conversation_count: number;
  message_count: number;
  lead_signals: number;
  opportunity_signals: number;
  thread_ids: string[];
  velocity_score?: number;
};

export interface TrendingTopicsPanelProps {
  organizationId: string;
  selectedTopic: TrendingTopic | null;
  onSelectTopic: (topic: TrendingTopic | null) => void;
  windowHours?: number;
  onTopicsLoaded?: (topics: TrendingTopic[]) => void;
  className?: string;
}

export const TrendingTopicsPanel = React.memo(function TrendingTopicsPanel({
  organizationId,
  selectedTopic,
  onSelectTopic,
  windowHours = 24,
  onTopicsLoaded,
  className = '',
}: TrendingTopicsPanelProps) {
  const [topics, setTopics] = useState<TrendingTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        organization_id: organizationId,
        window_hours: String(windowHours),
      });
      const res = await fetch(`/api/engagement/trending-topics?${params.toString()}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      const topicList = Array.isArray(json.topics) ? json.topics : [];
      setTopics(topicList);
      onTopicsLoaded?.(topicList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setTopics([]);
      onTopicsLoaded?.([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, windowHours]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!organizationId) return;
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [organizationId, load]);

  if (!organizationId) return null;

  if (loading && topics.length === 0) {
    return (
      <div className={`shrink-0 border-b border-slate-200 bg-white px-4 py-3 ${className}`}>
        <h3 className="text-sm font-medium text-slate-700 mb-2">Trending Engagement Topics</h3>
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 w-32 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const displayTopics = topics.slice(0, MAX_DISPLAY);

  return (
    <div className={`shrink-0 border-b border-slate-200 bg-white px-4 py-3 ${className}`}>
      <h3 className="text-sm font-medium text-slate-700 mb-2">Trending Engagement Topics</h3>
      {error && topics.length === 0 ? (
        <p className="text-sm text-amber-600">{error}</p>
      ) : displayTopics.length === 0 ? (
        <p className="text-sm text-slate-500">No trending topics in the last {windowHours}h.</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {displayTopics.map((t) => {
            const isSelected = selectedTopic?.topic === t.topic;
            return (
              <button
                key={t.topic}
                type="button"
                onClick={() => onSelectTopic(isSelected ? null : t)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="font-medium text-slate-800">{t.topic}</div>
                  {(t.velocity_score ?? 0) > 1.2 && (
                    <span className="text-emerald-600 text-xs" title="Rising">↑</span>
                  )}
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  {t.conversation_count} conversation{t.conversation_count !== 1 ? 's' : ''}
                </div>
                {(t.lead_signals > 0 || t.opportunity_signals > 0) && (
                  <div className="flex gap-2 mt-1 text-xs">
                    {t.lead_signals > 0 && (
                      <span className="text-emerald-600">{t.lead_signals} lead{t.lead_signals !== 1 ? 's' : ''}</span>
                    )}
                    {t.opportunity_signals > 0 && (
                      <span className="text-blue-600">
                        {t.opportunity_signals} opportunit{t.opportunity_signals !== 1 ? 'ies' : 'y'}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
