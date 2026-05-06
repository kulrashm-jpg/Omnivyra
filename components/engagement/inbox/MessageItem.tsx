/**
 * MessageItem — pure UI for a single engagement message.
 *
 * Phase 35-C-2 extraction from ConversationView's renderMessage.
 * Two render branches preserved verbatim (pending-outbound queued
 * vs normal message) plus recursive children rendering.
 *
 * STRICT: no fetch, no async logic, no internal state. All actions
 * are callbacks injected by the consumer (typically via useMessageActions).
 */

import React from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';
import { resolveEngagementCapability } from '@/lib/engagementCapabilities';
import {
  formatTimestamp,
  authorDisplay,
  authorInitials,
  avatarTone,
} from './messageRenderHelpers';

export interface MessageItemProps {
  message: EngagementMessage & { children?: EngagementMessage[] };
  depth?: number;
  /**
   * Display name to use when message has no author_display_name and is
   * at depth 0. Typically the thread's primary participant.
   */
  threadAuthor?: string | null;
  showRetryQueued?: boolean;

  onCancelQueued?: (actionId: string) => void;
  onRetry?: (actionId: string) => void;
  onMarkSelf?: (messageId: string) => void;
  onLike?: (message: EngagementMessage) => void;
  onReply?: (message: EngagementMessage) => void;
}

export const MessageItem = React.memo(function MessageItem({
  message: msg,
  depth = 0,
  threadAuthor = null,
  showRetryQueued = true,
  onCancelQueued,
  onRetry,
  onMarkSelf,
  onLike,
  onReply,
}: MessageItemProps) {
  // Pending outbound DM — server-side virtual row representing a queued
  // community_ai_actions row that the Chrome extension hasn't delivered yet.
  if (msg.is_pending_outbound) {
    const claimedAndActive =
      msg.pending_action_claimed === true && msg.pending_action_lease_expired !== true;
    const statusLabel = claimedAndActive
      ? 'Handed to LinkedIn - awaiting delivery'
      : 'Queued - not yet delivered';
    const statusDetail = claimedAndActive
      ? 'Omnivyra has handed this to the LinkedIn tab. Waiting for LinkedIn to report the send result.'
      : 'Will be sent when the LinkedIn tab is open and the Omnivyra extension claims the action.';
    return (
      <div key={msg.id} className="my-2 ml-auto max-w-[80%]">
        <div
          className={`rounded-2xl border px-3 py-2 ${
            claimedAndActive ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div
            className={`flex items-center gap-2 text-[11px] uppercase tracking-wide ${
              claimedAndActive ? 'text-blue-800' : 'text-amber-800'
            }`}
          >
            <span>{statusLabel}</span>
          </div>
          <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{msg.content || '(empty)'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
            <span>{statusDetail}</span>
            {showRetryQueued && msg.pending_action_id && onRetry && !claimedAndActive && (
              <button
                type="button"
                onClick={() => onRetry(msg.pending_action_id as string)}
                className="font-medium text-blue-700 hover:text-blue-900 underline-offset-2 hover:underline"
              >
                Retry delivery
              </button>
            )}
            {!claimedAndActive && onCancelQueued && (
              <button
                type="button"
                onClick={() => msg.pending_action_id && onCancelQueued(msg.pending_action_id)}
                className="font-medium text-amber-900 hover:text-amber-700 underline-offset-2 hover:underline"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const displayName = authorDisplay(msg, depth === 0 ? threadAuthor : null);
  const isSelfAuthor = msg.author_self === true || msg.author_id === '__self__';
  const accountName = isSelfAuthor ? msg.author_display_name || displayName : displayName;
  const initials = authorInitials(accountName);
  const avatarClasses = avatarTone(accountName, isSelfAuthor);
  const avatarImgSrc = (msg.author_avatar_url ?? '').trim() || null;

  const msgPlatform = msg.platform ?? '';
  const likeCap = resolveEngagementCapability(msgPlatform, 'like');
  const replyCap = resolveEngagementCapability(msgPlatform, 'reply');
  const isPlaceholder = msg.is_placeholder === true;
  const likeDisabled = likeCap.status !== 'api_verified' || isSelfAuthor;
  const replyDisabled = replyCap.status !== 'api_verified' || isSelfAuthor;
  const likeTitle = isPlaceholder
    ? 'Demo seed — clicking will call LinkedIn but the synthetic URN is rejected; real scraped comments will succeed.'
    : likeCap.status === 'api_verified'
    ? undefined
    : likeCap.reason;
  const replyTitle = isPlaceholder
    ? 'Demo seed: composer + AI suggestion will work; sending requires a real scraped URN.'
    : replyCap.status === 'api_verified'
    ? undefined
    : replyCap.reason;

  return (
    <div key={msg.id} className={depth > 0 ? 'ml-6 mt-2 pl-4 border-l-2 border-slate-200' : ''}>
      <div className="flex gap-2 py-2">
        {avatarImgSrc ? (
          <img
            src={avatarImgSrc}
            alt={displayName}
            className={`w-8 h-8 rounded-full border object-cover shrink-0 ${
              isSelfAuthor ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-200'
            }`}
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const fallback = e.currentTarget.nextSibling as HTMLElement | null;
              if (fallback) fallback.style.display = 'flex';
            }}
          />
        ) : null}
        <div
          className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-semibold shrink-0 ${avatarClasses}`}
          style={{ display: avatarImgSrc ? 'none' : 'flex' }}
          title={displayName}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-800">{displayName}</span>
            {msg.author_handle && (
              <a
                href={`https://www.linkedin.com/in/${msg.author_handle}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                @{msg.author_handle}
              </a>
            )}
            <PlatformIcon platform={msg.platform ?? ''} size={12} />
            <span className="text-xs text-slate-500">
              {formatTimestamp(msg.platform_created_at ?? msg.created_at, msg.display_time_label)}
            </span>
          </div>
          <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">{msg.content || '(empty)'}</p>
          {((msg.like_count ?? 0) > 0 || (msg.reply_count ?? 0) > 0) && (
            <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
              {(msg.like_count ?? 0) > 0 && (
                <span title="Reactions on this comment">👍 {msg.like_count}</span>
              )}
              {(msg.reply_count ?? 0) > 0 && (
                <span title="Replies to this comment">
                  💬 {msg.reply_count} {msg.reply_count === 1 ? 'reply' : 'replies'}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            {!isSelfAuthor && onMarkSelf && (
              <button
                type="button"
                onClick={() => onMarkSelf(msg.id)}
                title="Use this when LinkedIn attributed your own reply to the other party (common when you and the contact share a display name)."
                className="text-xs text-slate-400 hover:text-amber-700 underline-offset-2 hover:underline"
              >
                I sent this
              </button>
            )}
            <button
              type="button"
              onClick={() => onLike?.(msg)}
              disabled={likeDisabled}
              title={likeTitle}
              className="text-xs text-slate-500 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Like {typeof msg.like_count === 'number' && msg.like_count > 0 ? `(${msg.like_count})` : ''}
            </button>
            <button
              type="button"
              onClick={() => onReply?.(msg)}
              disabled={replyDisabled}
              title={replyTitle}
              className="text-xs text-slate-500 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reply
            </button>
          </div>
        </div>
      </div>
      {(msg.children ?? []).map((child) => (
        <MessageItem
          key={child.id}
          message={child as EngagementMessage & { children?: EngagementMessage[] }}
          depth={depth + 1}
          threadAuthor={threadAuthor}
          showRetryQueued={showRetryQueued}
          onCancelQueued={onCancelQueued}
          onRetry={onRetry}
          onMarkSelf={onMarkSelf}
          onLike={onLike}
          onReply={onReply}
        />
      ))}
    </div>
  );
});
