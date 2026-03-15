/**
 * TopicPlaybookPanel — recommended actions for a selected topic.
 * Shown below TrendingTopicsPanel when a topic is selected.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { TrendingTopic } from './TrendingTopicsPanel';

export type PlaybookAction = {
  type: string;
  count?: number;
  description: string;
};

export type TopicPlaybook = {
  topic: string;
  actions: PlaybookAction[];
};

export interface TopicPlaybookPanelProps {
  organizationId: string;
  selectedTopic: TrendingTopic | null;
  className?: string;
}

export const TopicPlaybookPanel = React.memo(function TopicPlaybookPanel({
  organizationId,
  selectedTopic,
  className = '',
}: TopicPlaybookPanelProps) {
  const [playbook, setPlaybook] = useState<TopicPlaybook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !selectedTopic) {
      setPlaybook(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        organization_id: organizationId,
        topic: selectedTopic.topic,
        thread_ids: selectedTopic.thread_ids.join(','),
      });
      const res = await fetch(`/api/engagement/topic-playbook?${params.toString()}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      setPlaybook(json.playbook ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playbook');
      setPlaybook(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, selectedTopic]);

  useEffect(() => {
    load();
  }, [load]);

  if (!selectedTopic) return null;

  if (loading && !playbook) {
    return (
      <div className={`shrink-0 border-b border-slate-200 bg-white px-4 py-3 ${className}`}>
        <h3 className="text-sm font-medium text-slate-700 mb-2">Recommended Actions</h3>
        <div className="space-y-2 animate-pulse">
          <div className="h-10 rounded bg-slate-100" />
          <div className="h-10 rounded bg-slate-100" />
          <div className="h-10 rounded bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`shrink-0 border-b border-slate-200 bg-white px-4 py-3 ${className}`}>
        <h3 className="text-sm font-medium text-slate-700 mb-2">Recommended Actions</h3>
        <p className="text-sm text-amber-600">{error}</p>
      </div>
    );
  }

  if (!playbook || !playbook.actions.length) {
    return null;
  }

  return (
    <div className={`shrink-0 border-b border-slate-200 bg-white px-4 py-3 ${className}`}>
      <h3 className="text-sm font-medium text-slate-700 mb-2">Recommended Actions</h3>
      <ul className="space-y-1.5">
        {playbook.actions.map((action, i) => (
          <li key={`${action.type}-${i}`} className="text-sm text-slate-800">
            {action.description}
          </li>
        ))}
      </ul>
    </div>
  );
});
