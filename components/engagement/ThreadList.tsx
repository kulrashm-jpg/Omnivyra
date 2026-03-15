/**
 * ThreadList — displays engagement inbox threads.
 */

import React, { useMemo } from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { Badge } from '@/components/ui/badge';
import type { InboxThread } from '@/hooks/useEngagementInbox';

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

function getPriorityBadge(score: number): { label: string; variant: 'destructive' | 'default' | 'secondary'; borderColor: string } {
  if (score >= 60) return { label: 'High', variant: 'destructive', borderColor: 'border-l-red-500' };
  if (score >= 30) return { label: 'Medium', variant: 'default', borderColor: 'border-l-amber-500' };
  return { label: 'Low', variant: 'secondary', borderColor: 'border-l-slate-200' };
}

const GROUP_ORDER = ['Questions', 'Recommendations', 'Complaints', 'Comparisons', 'General Conversations'] as const;

function getGroupKey(cat: string | null | undefined): string {
  if (!cat) return 'General Conversations';
  const k = cat.toLowerCase();
  if (k === 'question_request') return 'Questions';
  if (k === 'recommendation_request') return 'Recommendations';
  if (k === 'competitor_complaint' || k === 'problem_discussion') return 'Complaints';
  if (k === 'product_comparison') return 'Comparisons';
  return 'General Conversations';
}

function getClassificationLabel(cat: string | null | undefined): string {
  if (!cat) return 'General';
  const k = cat.toLowerCase();
  if (k === 'question_request') return 'Question';
  if (k === 'recommendation_request') return 'Recommendation';
  if (k === 'competitor_complaint') return 'Complaint';
  if (k === 'problem_discussion') return 'Issue';
  if (k === 'product_comparison') return 'Comparison';
  return 'General';
}

function getClassificationTooltip(cat: string | null | undefined): string {
  if (!cat) return '';
  const k = cat.toLowerCase();
  if (k === 'question_request') return 'Question request';
  if (k === 'recommendation_request') return 'Recommendation request';
  if (k === 'competitor_complaint') return 'Competitor complaint';
  if (k === 'problem_discussion') return 'Issue discussion';
  if (k === 'product_comparison') return 'Product comparison discussion';
  return '';
}

export interface ThreadListProps {
  items: InboxThread[];
  loading?: boolean;
  selectedThreadId?: string | null;
  onSelectThread: (thread: InboxThread) => void;
  emptyMessage?: string;
  authorFilter?: { authorName: string; platform: string } | null;
  onClearAuthorFilter?: () => void;
  className?: string;
}

export const ThreadList = React.memo(function ThreadList({
  items,
  loading = false,
  selectedThreadId,
  onSelectThread,
  emptyMessage = 'No threads in inbox.',
  authorFilter,
  onClearAuthorFilter,
  className = '',
}: ThreadListProps) {
  const groupedAndSorted = useMemo(() => {
    const byGroup = new Map<string, InboxThread[]>();
    for (const t of items) {
      const g = getGroupKey(t.classification_category);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(t);
    }
    for (const arr of byGroup.values()) {
      arr.sort((a, b) => {
        const triageA = a.triage_priority ?? 0;
        const triageB = b.triage_priority ?? 0;
        if (triageB !== triageA) return triageB - triageA;
        const scoreA = a.priority_score ?? 0;
        const scoreB = b.priority_score ?? 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const ta = a.latest_message_time ? new Date(a.latest_message_time).getTime() : 0;
        const tb = b.latest_message_time ? new Date(b.latest_message_time).getTime() : 0;
        return tb - ta;
      });
    }
    const ordered: Array<{ group: string; threads: InboxThread[] }> = [];
    for (const g of GROUP_ORDER) {
      const threads = byGroup.get(g);
      if (threads?.length) ordered.push({ group: g, threads });
    }
    return ordered;
  }, [items]);
  const flatSorted = useMemo(
    () => groupedAndSorted.flatMap((s) => s.threads),
    [groupedAndSorted]
  );
  const ORDERED = groupedAndSorted;

  if (loading) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="p-3 border-b border-slate-200 font-medium text-slate-800">Threads</div>
        <div className="flex-1 overflow-y-auto space-y-2 p-2 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (flatSorted.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="p-3 border-b border-slate-200 font-medium text-slate-800">Threads</div>
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-slate-500">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="p-3 border-b border-slate-200 font-medium text-slate-800 flex items-center justify-between gap-2">
        <span>Threads</span>
        {authorFilter && onClearAuthorFilter && (
          <button
            type="button"
            onClick={onClearAuthorFilter}
            className="text-xs text-blue-600 hover:text-blue-800 shrink-0"
          >
            Clear author filter
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {ORDERED.map(({ group, threads }) => (
          <div key={group}>
            <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-100 border-b border-slate-200">
              {group}
            </div>
            {threads.map((thread) => {
          const isSelected = thread.thread_id === selectedThreadId;
          const priority = getPriorityBadge(thread.priority_score ?? 0);
          const priorityBorder = isSelected ? 'border-l-blue-500' : priority.borderColor;
          const triage = thread.triage_priority ?? 0;
          const triageDotColor =
            triage >= 7 ? 'bg-red-500' : triage >= 4 ? 'bg-amber-500' : null;
          const classificationLabel = getClassificationLabel(thread.classification_category);
          const classificationTooltip = getClassificationTooltip(thread.classification_category);
          const showClassification =
            thread.classification_category &&
            classificationLabel !== 'General';
          const isLead = thread.lead_detected || (thread.lead_score ?? 0) > 0;
          const sentiment = (thread.sentiment ?? '').toLowerCase();
          const sentimentLabel =
            sentiment === 'positive'
              ? 'Positive'
              : sentiment === 'negative'
                ? 'Negative'
                : sentiment
                  ? sentiment.charAt(0).toUpperCase() + sentiment.slice(1)
                  : null;

          return (
            <div
              key={thread.thread_id}
              className={`flex items-start gap-2 w-full text-left p-3 border-b border-slate-100 hover:bg-slate-50 transition-colors border-l-4 ${priorityBorder} ${isSelected ? 'bg-blue-50' : ''}`}
            >
              {triageDotColor && (
                <span
                  className={`shrink-0 w-2 h-2 rounded-full mt-2 ${triageDotColor}`}
                  title={triage >= 7 ? 'High triage priority' : 'Medium triage priority'}
                  aria-hidden
                />
              )}
              <button
                type="button"
                onClick={() => onSelectThread(thread)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="flex items-start gap-2">
                  <PlatformIcon platform={thread.platform} size={16} className="shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-800 truncate">
                      {thread.author_name || thread.author_username || 'Unknown'}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {thread.unread_count > 0 && (
                        <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-blue-500 rounded-full shrink-0">
                          {thread.unread_count}
                        </span>
                      )}
                      {showClassification && (
                        <span
                          className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700 shrink-0"
                          title={classificationTooltip}
                        >
                          {classificationLabel}
                        </span>
                      )}
                      {isLead && (
                        <span
                          className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 shrink-0"
                          title="Lead detected"
                        >
                          Lead
                        </span>
                      )}
                      {sentimentLabel && (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${
                            sentiment === 'positive'
                              ? 'bg-green-100 text-green-800'
                              : sentiment === 'negative'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                          title={`Sentiment: ${sentimentLabel}`}
                        >
                          {sentimentLabel}
                        </span>
                      )}
                      {thread.opportunity_indicator && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800 shrink-0"
                          title="Opportunity signal detected"
                        >
                          ⚡ Opportunity
                        </span>
                      )}
                      <Badge variant={priority.variant} className="text-[10px] shrink-0">
                        {priority.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {thread.platform}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600 truncate mt-0.5">
                      {thread.latest_message || 'No message'}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                      <span>{thread.message_count} msg</span>
                      <span>{formatTime(thread.latest_message_time)}</span>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          );
        })}
          </div>
        ))}
      </div>
    </div>
  );
});
