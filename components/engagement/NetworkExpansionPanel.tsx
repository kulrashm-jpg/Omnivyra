/**
 * NetworkExpansionPanel — identifies people and discussions worth engaging with.
 * Client-side computation from thread data; no API calls.
 */

import React, { useMemo } from 'react';
import type { InboxThread } from '@/hooks/useEngagementInbox';

const HIGH_ENGAGEMENT_THRESHOLD = 50;
const MAX_ITEMS = 5;

export interface NetworkExpansionPanelProps {
  items: InboxThread[];
  onViewConversation?: (threadId: string) => void;
  className?: string;
}

export const NetworkExpansionPanel = React.memo(function NetworkExpansionPanel({
  items,
  onViewConversation,
  className = '',
}: NetworkExpansionPanelProps) {
  const { influencers, activeDiscussions, potentialLeads, highEngagement } = useMemo(() => {
    const sortedByMessageCount = [...items].sort(
      (a, b) => (b.message_count ?? 0) - (a.message_count ?? 0)
    );
    const influencers = sortedByMessageCount.slice(0, MAX_ITEMS);

    const sortedByRecency = [...items].sort((a, b) => {
      const ta = a.latest_message_time ? new Date(a.latest_message_time).getTime() : 0;
      const tb = b.latest_message_time ? new Date(b.latest_message_time).getTime() : 0;
      return tb - ta;
    });
    const activeDiscussions = sortedByRecency.slice(0, MAX_ITEMS);

    const leads = items.filter((t) => t.lead_detected || (t.lead_score ?? 0) > 0);
    const potentialLeads = leads.slice(0, MAX_ITEMS);

    const highEng = items.filter((t) => (t.priority_score ?? 0) >= HIGH_ENGAGEMENT_THRESHOLD);
    const highEngagement = highEng
      .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
      .slice(0, MAX_ITEMS);

    return { influencers, activeDiscussions, potentialLeads, highEngagement };
  }, [items]);

  const ThreadCard = ({ thread }: { thread: InboxThread }) => (
    <div className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
      <div className="font-medium text-slate-700 truncate">
        {thread.author_name || thread.author_username || 'Unknown'}
      </div>
      <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">
        {thread.latest_message || 'No preview'}
      </p>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={() => onViewConversation?.(thread.thread_id)}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          View Conversation
        </button>
      </div>
    </div>
  );

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Influencers in Discussion
        </h4>
        <div className="space-y-2">
          {influencers.length === 0 ? (
            <div className="text-sm text-slate-500">No participants with high message count.</div>
          ) : (
            influencers.map((t) => (
              <ThreadCard key={t.thread_id} thread={t} />
            ))
          )}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Active Discussions
        </h4>
        <div className="space-y-2">
          {activeDiscussions.length === 0 ? (
            <div className="text-sm text-slate-500">No recent discussions.</div>
          ) : (
            activeDiscussions.map((t) => (
              <ThreadCard key={t.thread_id} thread={t} />
            ))
          )}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Potential Leads
        </h4>
        <div className="space-y-2">
          {potentialLeads.length === 0 ? (
            <div className="text-sm text-slate-500">No potential leads detected.</div>
          ) : (
            potentialLeads.map((t) => (
              <ThreadCard key={t.thread_id} thread={t} />
            ))
          )}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          High Engagement Threads
        </h4>
        <div className="space-y-2">
          {highEngagement.length === 0 ? (
            <div className="text-sm text-slate-500">No high-engagement threads.</div>
          ) : (
            highEngagement.map((t) => (
              <ThreadCard key={t.thread_id} thread={t} />
            ))
          )}
        </div>
      </div>
    </div>
  );
});
