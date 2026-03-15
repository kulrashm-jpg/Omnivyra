/**
 * ConversationMonitorHeader — real-time engagement workload metrics.
 * Computes from inbox items; no additional API calls.
 */

import React, { useMemo } from 'react';
import type { InboxThread } from '@/hooks/useEngagementInbox';

export interface ConversationMonitorHeaderProps {
  items: InboxThread[];
  loading?: boolean;
  trendingTopicsCount?: number;
  className?: string;
}

export const ConversationMonitorHeader = React.memo(function ConversationMonitorHeader({
  items,
  loading = false,
  trendingTopicsCount = 0,
  className = '',
}: ConversationMonitorHeaderProps) {
  const metrics = useMemo(() => {
    const activeConversations = items.length;
    const highPriority = items.filter((t) => (t.triage_priority ?? 0) >= 7).length;
    const leads = items.filter((t) => t.lead_detected || (t.lead_score ?? 0) > 0).length;
    const opportunities = items.filter((t) => t.opportunity_indicator).length;

    return {
      activeConversations,
      highPriority,
      leads,
      opportunities,
      trendingTopics: trendingTopicsCount,
    };
  }, [items, trendingTopicsCount]);

  if (loading) {
    return (
      <div className={`shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 animate-pulse ${className}`}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-slate-200" />
          ))}
        </div>
      </div>
    );
  }

  const cards = [
    { label: 'Active Conversations', value: metrics.activeConversations },
    { label: 'High Priority Threads', value: metrics.highPriority },
    { label: 'Leads Detected', value: metrics.leads },
    { label: 'Opportunity Signals', value: metrics.opportunities },
    { label: 'Trending Topics', value: metrics.trendingTopics },
  ];

  return (
    <div className={`shrink-0 border-b border-slate-200 bg-white px-4 py-3 ${className}`}>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map(({ label, value }) => (
          <div
            key={label}
            className="rounded-lg border border-slate-200 bg-slate-50/50 p-3"
          >
            <div className="text-xs font-medium text-slate-500">{label}</div>
            <div className="text-lg font-semibold text-slate-900 mt-0.5">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
});
