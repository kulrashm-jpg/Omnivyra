/**
 * StandardMessage — pure UI for a normal engagement message (comment / DM).
 *
 * Phase 35-D-1 extraction from MessageItem. Renders avatar + author row +
 * content + per-message engagement chips + action buttons (mark-self,
 * like, reply). Children (replies) are passed in via `children` prop —
 * the parent (MessageItem router) handles recursion.
 *
 * NO fetch, NO state, NO mutation. All actions are callback props.
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

export interface StandardMessageProps {
  message: EngagementMessage;
  depth?: number;
  threadAuthor?: string | null;

  onMarkSelf?: (messageId: string) => void;
  onLike?: (message: EngagementMessage) => void;
  onReply?: (message: EngagementMessage) => void;

  children?: React.ReactNode;
}

export const StandardMessage = React.memo(function StandardMessage({
  message: msg,
  depth = 0,
  threadAuthor = null,
  onMarkSelf,
  onLike,
  onReply,
  children,
}: StandardMessageProps) {
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
              {(msg.like_count ?? 0) > 0 && <span title="Reactions on this comment">👍 {msg.like_count}</span>}
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
      {children}
    </div>
  );
});
