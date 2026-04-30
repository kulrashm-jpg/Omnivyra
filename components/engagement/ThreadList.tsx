/**
 * ThreadList - displays engagement inbox threads.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { Badge } from '@/components/ui/badge';
import type { InboxThread } from '@/hooks/useEngagementInbox';
import type { ThreadQueueGroup } from './threadQueueModel';
import { groupThreadsByQueue, THREAD_QUEUE_ORDER } from './threadQueueModel';

function formatTime(iso: string | null): string {
  if (!iso) return '-';
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

function getPriorityBadge(score: number): {
  label: string;
  variant: 'destructive' | 'default' | 'secondary';
  borderColor: string;
} {
  if (score >= 60) return { label: 'High', variant: 'destructive', borderColor: 'border-l-red-500' };
  if (score >= 30) return { label: 'Medium', variant: 'default', borderColor: 'border-l-amber-500' };
  return { label: 'Low', variant: 'secondary', borderColor: 'border-l-slate-200' };
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
  recommendedThreadId?: string | null;
  recommendationIsFading?: boolean;
  activeFilter?: ThreadQueueGroup | 'all' | 'People Reacted';
  onSelectThread: (thread: InboxThread) => void;
  emptyMessage?: string;
  emptyState?: React.ReactNode;
  authorFilter?: { authorName: string; platform: string } | null;
  onClearAuthorFilter?: () => void;
  className?: string;
}

/**
 * Compact post card used in People Reaction mode. Shows the post preview +
 * engagement counts (impressions, reactions, comments) instead of the DM-
 * triage-style author header. Clicking still calls onSelectThread, so the
 * middle pane uses the existing post banner + comment list rendering.
 */
function PostCard({
  thread,
  selected,
  onClick,
}: {
  thread: InboxThread;
  selected: boolean;
  onClick: () => void;
}) {
  const responses = thread.post_comment_count ?? 0;
  const reactions = thread.post_reaction_count ?? 0;
  const impressions = thread.post_impression_count ?? null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-2 border-b border-slate-100 px-3 py-3 text-left transition-colors hover:bg-slate-50 ${
        selected ? 'bg-emerald-50 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.18)]' : ''
      }`}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
        <PlatformIcon platform={thread.platform} size={12} />
        <span>Your post</span>
        {(thread.unread_count ?? 0) > 0 && (
          <span className="ml-auto inline-flex h-4 items-center rounded-full bg-emerald-600 px-2 text-[10px] font-semibold text-white">
            {thread.unread_count} new
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-sm font-medium text-slate-800">
        {thread.post_text_preview || '(no preview captured yet)'}
      </p>
      <div className="flex items-center gap-3 text-[11px] text-slate-500">
        {impressions !== null && <span title="Impressions">📊 {impressions.toLocaleString()}</span>}
        <span title="Reactions">👍 {reactions}</span>
        <span title="Comments">💬 {responses}</span>
        <span className="ml-auto">{formatTime(thread.latest_message_time)}</span>
      </div>
    </button>
  );
}

export const ThreadList = React.memo(function ThreadList({
  items,
  loading = false,
  selectedThreadId,
  recommendedThreadId,
  recommendationIsFading = false,
  activeFilter = 'all',
  onSelectThread,
  emptyMessage = 'No threads in inbox.',
  emptyState,
  authorFilter,
  onClearAuthorFilter,
  className = '',
}: ThreadListProps) {
  const groupedAndSorted = useMemo(() => groupThreadsByQueue(items), [items]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'Needs Response': true,
  });
  const [exitingRecommendedThreadId, setExitingRecommendedThreadId] = useState<string | null>(null);
  const previousRecommendedThreadIdRef = useRef<string | null>(null);

  const flatSorted = useMemo(
    () => groupedAndSorted.flatMap((s) => s.threads),
    [groupedAndSorted]
  );
  const visibleGroups = useMemo(() => {
    if (activeFilter === 'all') return groupedAndSorted;
    return groupedAndSorted.filter((section) => section.group === activeFilter);
  }, [activeFilter, groupedAndSorted]);

  useEffect(() => {
    const nextState: Record<string, boolean> = {};
    for (const group of THREAD_QUEUE_ORDER) {
      nextState[group] = activeFilter === 'all' ? group === 'Needs Response' : group === activeFilter;
    }
    setExpandedGroups(nextState);
  }, [activeFilter]);

  useEffect(() => {
    if (recommendedThreadId) {
      previousRecommendedThreadIdRef.current = recommendedThreadId;
      setExitingRecommendedThreadId(null);
      return;
    }

    const previousRecommendedThreadId = previousRecommendedThreadIdRef.current;
    const previousRecommendedStillVisible = groupedAndSorted
      .flatMap((section) => section.threads)
      .some((thread) => thread.thread_id === previousRecommendedThreadId);

    if (
      !previousRecommendedThreadId ||
      previousRecommendedThreadId === selectedThreadId ||
      !previousRecommendedStillVisible
    ) {
      setExitingRecommendedThreadId(null);
      previousRecommendedThreadIdRef.current = null;
      return;
    }

    setExitingRecommendedThreadId(previousRecommendedThreadId);
    const timer = window.setTimeout(() => {
      setExitingRecommendedThreadId(null);
      previousRecommendedThreadIdRef.current = null;
    }, 200);

    return () => window.clearTimeout(timer);
  }, [groupedAndSorted, recommendedThreadId, selectedThreadId]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((current) => ({ ...current, [group]: !current[group] }));
  };

  // People Reaction render path — flat list of post cards. Bypasses the
  // queue-priority grouping which is irrelevant for "activity on my posts".
  const isPeopleReactionMode = activeFilter === 'People Reacted';
  const peopleReactionItems = useMemo(() => {
    if (!isPeopleReactionMode) return [];
    return items.filter((t) => t.latest_message_type === 'comment');
  }, [items, isPeopleReactionMode]);

  if (loading) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-3 font-medium text-slate-800 backdrop-blur-sm">
          {isPeopleReactionMode ? 'Posts with comments' : 'Triage Queue'}
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 p-2 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (isPeopleReactionMode) {
    if (peopleReactionItems.length === 0) {
      return (
        <div className={`flex flex-col h-full ${className}`}>
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-3 font-medium text-slate-800 backdrop-blur-sm">
            Posts with comments
          </div>
          <div className="flex-1 flex items-center justify-center p-4 text-sm text-slate-500">
            {emptyState ?? 'No posts with comments yet. Visit your LinkedIn feed and the extension will sync them automatically.'}
          </div>
        </div>
      );
    }
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-3 font-medium text-slate-800 backdrop-blur-sm">
          Posts with comments
          <span className="ml-2 text-xs font-normal text-slate-500">
            {peopleReactionItems.length} {peopleReactionItems.length === 1 ? 'post' : 'posts'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {peopleReactionItems.map((thread) => (
            <PostCard
              key={thread.thread_id}
              thread={thread}
              selected={thread.thread_id === selectedThreadId}
              onClick={() => onSelectThread(thread)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (flatSorted.length === 0 || visibleGroups.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-3 font-medium text-slate-800 backdrop-blur-sm">
          Triage Queue
        </div>
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-slate-500">
          {emptyState ?? emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 p-3 font-medium text-slate-800 backdrop-blur-sm">
        <span>Triage Queue</span>
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
        {visibleGroups.map(({ group, threads }) => (
          <div key={group}>
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className="flex w-full items-center justify-between border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              <span>{group}</span>
              <span>{expandedGroups[group] ? '−' : '+'}</span>
            </button>
            {expandedGroups[group] ? threads.map((thread) => {
              const isSelected = thread.thread_id === selectedThreadId;
              // Recommended highlight is suppressed when the user already
              // has the recommended thread open — the right pane already
              // shows it, so an "R" badge on the same row reads as a
              // duplicate of what they're looking at.
              const isRecommended =
                thread.thread_id === recommendedThreadId
                && thread.thread_id !== selectedThreadId;
              const isExitingRecommendation =
                !isRecommended && thread.thread_id === exitingRecommendedThreadId;
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
                  className={`flex items-start gap-2 w-full text-left p-3 border-b border-slate-100 hover:bg-slate-50 transition-colors transition-opacity duration-200 border-l-4 ${priorityBorder} ${isSelected ? 'bg-blue-50 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08)]' : ''} ${isRecommended ? recommendationIsFading ? 'bg-indigo-50/10' : 'bg-indigo-50/20' : ''} ${isExitingRecommendation ? 'bg-indigo-50/10 opacity-70' : ''}`}
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
                        {/* Single header row: author + every status chip
                            inline, small font. Truncates the author when
                            there's not enough room for the chips so the
                            row never wraps to a second line. */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium text-slate-800 truncate text-sm">
                            {thread.author_name || thread.author_username || 'Unknown'}
                          </span>
                          {(thread.unread_count ?? 0) > 0 && (
                            <span className="shrink-0 inline-flex h-2 w-2 rounded-full bg-blue-500" title="Needs reply" />
                          )}
                          {isLead && (
                            <span className="shrink-0 inline-flex h-2 w-2 rounded-full bg-emerald-500" title="Lead-flagged" />
                          )}
                          {thread.unread_count > 0 && (
                            <span className="shrink-0 inline-flex items-center justify-center min-w-[14px] h-[14px] text-[9px] font-bold text-white bg-blue-500 rounded-full px-1">
                              {thread.unread_count}
                            </span>
                          )}
                          {(isRecommended || isExitingRecommendation) && (() => {
                            // "R" badge — color tracks urgency so the operator
                            // can see at a glance how hot the recommended
                            // next thread is. Red = high priority, amber =
                            // medium, slate = low. Same fading transition
                            // as before when recommendation is rotating.
                            const score = thread.priority_score ?? 0;
                            const triagePri = thread.triage_priority ?? 0;
                            const urgent = triagePri >= 7 || score >= 60;
                            const warm = !urgent && (triagePri >= 4 || score >= 30);
                            const urgencyClasses = urgent
                              ? 'bg-red-500 text-white'
                              : warm
                                ? 'bg-amber-500 text-white'
                                : 'bg-indigo-500 text-white';
                            const fadeClass = isExitingRecommendation
                              ? 'opacity-0'
                              : recommendationIsFading
                                ? 'opacity-70'
                                : '';
                            return (
                              <span
                                className={`shrink-0 inline-flex items-center justify-center w-[14px] h-[14px] rounded-full text-[9px] font-bold transition-all duration-200 ${urgencyClasses} ${fadeClass}`}
                                title={`Recommended next thread (${urgent ? 'high' : warm ? 'medium' : 'low'} urgency)`}
                              >
                                R
                              </span>
                            );
                          })()}
                          {showClassification && (
                            <span
                              className="shrink-0 inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0 text-[9px] font-medium text-slate-700"
                              title={classificationTooltip}
                            >
                              {classificationLabel}
                            </span>
                          )}
                          {isLead && (
                            <span
                              className="shrink-0 inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0 text-[9px] font-medium text-emerald-800"
                              title="Lead detected"
                            >
                              Lead
                            </span>
                          )}
                          {sentimentLabel && (
                            <span
                              className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-medium ${
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
                              className="shrink-0 inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0 text-[9px] font-medium text-blue-800"
                              title="Opportunity signal detected"
                            >
                              Opp
                            </span>
                          )}
                          <Badge variant={priority.variant} className="shrink-0 text-[9px] px-1.5 py-0">
                            {priority.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600 truncate mt-0.5">
                          {thread.latest_message || 'No message'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                          <span>{thread.message_count} msg</span>
                          <span>{formatTime(thread.latest_message_time)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              );
            }) : null}
          </div>
        ))}
      </div>
    </div>
  );
});
