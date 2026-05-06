/**
 * ThreadHeader — pure UI for the conversation header chrome.
 *
 * Phase 35-D-2 extraction from ConversationView. Two visual blocks:
 *   1. Title row (author name + platform icon + lead-signal badge +
 *      Refresh / Mark Resolved / Drop buttons)
 *   2. Optional post banner (only when isPostThread: shows the source
 *      post with stats and a link to LinkedIn).
 *
 * Pure presentational. NO fetch, NO state, NO mutation. Actions are
 * callback props injected by ConversationView.
 */

import React from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import type { InboxThread } from '@/hooks/useEngagementInbox';

export interface ThreadHeaderProps {
  thread: InboxThread;
  isPostThread: boolean;
  postUrl: string | null;
  messagesLength: number;

  onRefresh?: () => void;
  onMarkResolved?: () => void;
  onIgnore?: (threadId: string) => void;
  onViewLeadSignal?: () => void;
}

export const ThreadHeader = React.memo(function ThreadHeader({
  thread,
  isPostThread,
  postUrl,
  messagesLength,
  onRefresh,
  onMarkResolved,
  onIgnore,
  onViewLeadSignal,
}: ThreadHeaderProps) {
  return (
    <>
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-slate-800">{thread.author_name || 'Thread'}</h3>
            <PlatformIcon platform={thread.platform} size={16} />
          </div>
          {thread.lead_detected ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-900">
                Lead signal detected
              </span>
              {onViewLeadSignal && (
                <button
                  type="button"
                  onClick={onViewLeadSignal}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  View in Active Leads
                </button>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Refresh
            </button>
          )}
          {onMarkResolved && (
            <button
              type="button"
              onClick={onMarkResolved}
              className="text-sm text-slate-600 hover:text-slate-800"
            >
              Mark Resolved
            </button>
          )}
          {onIgnore && (
            <button
              type="button"
              onClick={() => onIgnore(thread.thread_id)}
              title="Remove this conversation from Omnivyra without sending a reply."
              className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            >
              Drop
            </button>
          )}
        </div>
      </div>

      {/* Post banner — only shown for People Reaction threads (post URN as
          platform_thread_id). Mirrors LinkedIn's post-on-top, comments-below
          layout so triagers can see the actual post above the comment list. */}
      {isPostThread && (
        <div className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-4 py-3">
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50">
              <span className="text-base">📝</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                <span>Your post</span>
                <PlatformIcon platform={thread.platform} size={12} />
                {thread.post_stats_source === 'manual_seed' && (
                  <span
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 normal-case tracking-normal"
                    title="These numbers are seeded demo values, not live from LinkedIn. Open the post on LinkedIn (link below) to trigger the scraper and refresh with real numbers."
                  >
                    DEMO
                  </span>
                )}
                <span className="ml-2 flex items-center gap-3 text-[11px] text-slate-500 normal-case tracking-normal">
                  {typeof thread.post_impression_count === 'number' && (
                    <span title="Impressions">📊 {thread.post_impression_count.toLocaleString()} impressions</span>
                  )}
                  {typeof thread.post_reaction_count === 'number' && (
                    <span title="Reactions">👍 {thread.post_reaction_count}</span>
                  )}
                  <span title="Responses captured in inbox">
                    💬 {typeof thread.post_comment_count === 'number'
                      ? thread.post_comment_count
                      : messagesLength}
                    {' '}
                    {(thread.post_comment_count ?? messagesLength) === 1 ? 'response' : 'responses'}
                  </span>
                </span>
              </div>
              {thread.post_text_preview ? (
                <p className="mt-1 line-clamp-3 text-sm text-slate-700 whitespace-pre-wrap">
                  {thread.post_text_preview}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500 italic">
                  Post preview not yet ingested. Visit the post on LinkedIn to refresh.
                </p>
              )}
              {postUrl && (
                <a
                  href={postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                >
                  Open on LinkedIn ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
});
