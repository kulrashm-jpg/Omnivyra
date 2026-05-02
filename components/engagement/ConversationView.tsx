/**
 * ConversationView — displays thread messages with nested replies.
 */

import React, { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { ReplyComposer } from './ReplyComposer';
import { AISuggestionPanel } from './AISuggestionPanel';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';
import type { InboxThread } from '@/hooks/useEngagementInbox';
import { resolveEngagementCapability } from '@/lib/engagementCapabilities';
import {
  compareMessagesAscending,
  compareMessagesDescending,
  getEffectiveMessageTimeMs,
} from '@/lib/engagement/messageTime';

function formatTimestamp(iso: string | null | undefined, displayLabel?: string | null): string {
  if (displayLabel && displayLabel.trim()) return displayLabel.trim();
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

function authorDisplay(
  msg: { author_id: string | null; author_display_name?: string | null; author_self?: boolean },
  threadAuthor: string | null
): string {
  if (msg.author_self) return 'You';
  if (msg.author_id === '__self__') return 'You';
  if (msg.author_display_name) return msg.author_display_name;
  if (threadAuthor) return threadAuthor;
  if (msg.author_id) return msg.author_id.slice(0, 8) + '…';
  return 'Unknown';
}

function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const OTHER_AVATAR_CLASSES = [
  'border-emerald-200 bg-emerald-100 text-emerald-800',
  'border-amber-200 bg-amber-100 text-amber-900',
  'border-rose-200 bg-rose-100 text-rose-800',
  'border-violet-200 bg-violet-100 text-violet-800',
  'border-teal-200 bg-teal-100 text-teal-800',
  'border-orange-200 bg-orange-100 text-orange-800',
  'border-slate-300 bg-slate-100 text-slate-700',
];

function avatarTone(name: string, isSelf: boolean): string {
  if (isSelf) return 'border-blue-200 bg-blue-100 text-blue-800';
  // Deterministic color from name — same name always gets same hue.
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash << 5) - hash + name.charCodeAt(i);
  return OTHER_AVATAR_CLASSES[Math.abs(hash) % OTHER_AVATAR_CLASSES.length];
}

export interface ConversationViewProps {
  thread: InboxThread | null;
  messages: EngagementMessage[];
  loading?: boolean;
  organizationId: string;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  onRefresh?: () => void;
  onReplySent?: () => void;
  onExecuteReply?: (input: {
    threadId: string;
    messageId: string;
    platform: string;
    replyText: string;
  }) => Promise<{ mode?: string; platform?: string; message?: string } | void>;
  onLike?: (messageId: string, platform: string) => void;
  onIgnore?: (threadId: string) => void;
  onMarkResolved?: () => void;
  onRetryQueuedDelivery?: (actionId: string) => Promise<{ message?: string } | void>;
  /** Notify parent when the user picks a specific comment/message to reply
   *  to. Lets the AI assistant generate a suggestion for THAT message
   *  instead of the thread-level latest-inbound default. */
  onReplyTargetChange?: (messageId: string | null) => void;
  className?: string;
}

export const ConversationView = React.memo(function ConversationView({
  thread,
  messages,
  loading = false,
  organizationId,
  emptyStateTitle = 'Select a conversation to start',
  emptyStateDescription = 'Choose a thread from the queue to review context and respond.',
  onRefresh,
  onReplySent,
  onExecuteReply,
  onLike,
  onIgnore,
  onMarkResolved,
  onRetryQueuedDelivery,
  onReplyTargetChange,
  className = '',
}: ConversationViewProps) {
  const router = useRouter();
  const [replyingTo, _setReplyingToInternal] = React.useState<EngagementMessage | null>(null);
  const composerRef = React.useRef<HTMLDivElement | null>(null);
  // Wrapper so every replyTarget change also notifies the parent. Parent
  // forwards the id to the AI assistant for comment-specific suggestions.
  const setReplyingTo = React.useCallback(
    (next: EngagementMessage | null) => {
      _setReplyingToInternal(next);
      onReplyTargetChange?.(next?.id ?? null);
      // Pull the composer into view when a specific comment is targeted —
      // otherwise it lives at the bottom of the page and the user thinks
      // they're writing a top-level comment instead of a threaded reply.
      if (next) {
        requestAnimationFrame(() => {
          composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
    },
    [onReplyTargetChange]
  );
  const [replyText, setReplyText] = React.useState('');
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [savingPattern, setSavingPattern] = React.useState(false);
  const [patternError, setPatternError] = React.useState<string | null>(null);

  // Reset composer state whenever the active thread changes. Without this,
  // `replyingTo` and `replyText` carry over from the previous thread, and
  // the next Send posts a message_id that no longer belongs to the visible
  // thread_id — server rejects with "message_id does not belong to thread_id".
  // Tracked via ref so unrelated parent re-renders don't wipe the draft.
  const lastThreadIdRef = React.useRef<string | null | undefined>(thread?.thread_id);
  React.useEffect(() => {
    if (lastThreadIdRef.current !== thread?.thread_id) {
      lastThreadIdRef.current = thread?.thread_id;
      _setReplyingToInternal(null);
      setReplyText('');
      setShowSuggestions(false);
      onReplyTargetChange?.(null);
    }
  }, [thread?.thread_id, onReplyTargetChange]);
  const [hydratedReplyToken, setHydratedReplyToken] = React.useState<string | null>(null);

  const threadAuthor = thread?.author_name ?? thread?.author_username ?? null;

  // A "post thread" is one whose platform_thread_id is a LinkedIn activity
  // URN — these are surfaced via People Reaction, and the messages under
  // them are comments + reactions, not DMs. Render a post-style banner so
  // the user can see WHICH post they're triaging instead of a generic
  // "Thread" header.
  const isPostThread = useMemo(() => {
    const ptid = thread?.platform_thread_id ?? '';
    return /^urn:li:(activity|share|ugcPost):/i.test(ptid)
      || thread?.latest_message_type === 'comment'
      || thread?.latest_message_type === 'reaction';
  }, [thread]);

  const postUrl = thread?.post_url ?? (
    thread?.platform_thread_id
      ? `https://www.linkedin.com/feed/update/${encodeURIComponent(thread.platform_thread_id)}/`
      : null
  );

  const latestMessage = useMemo(() => {
    if (!messages.length) return null;
    return [...messages].sort(compareMessagesDescending)[0];
  }, [messages]);

  const latestReplyableMessage = useMemo(() => {
    if (!messages.length) return null;
    return [...messages]
      .sort(compareMessagesDescending)
      .find((message) => message.author_self !== true && message.author_id !== '__self__' && message.is_pending_outbound !== true)
      ?? null;
  }, [messages]);

  const replyTarget = replyingTo ?? latestReplyableMessage ?? latestMessage;
  const prefillReplyToken = typeof router.query.prefill_reply === 'string' ? router.query.prefill_reply : '';

  React.useEffect(() => {
    if (!thread?.thread_id || !prefillReplyToken || hydratedReplyToken === prefillReplyToken || typeof window === 'undefined') {
      return;
    }
    const raw = sessionStorage.getItem(prefillReplyToken);
    if (!raw) {
      setHydratedReplyToken(prefillReplyToken);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { threadId?: string; messageId?: string | null; text?: string };
      if (parsed.threadId === thread.thread_id && typeof parsed.text === 'string' && parsed.text.trim()) {
        setReplyText(parsed.text.trim());
        const prefillTarget = parsed.messageId
          ? messages.find((message) => message.id === parsed.messageId) ?? latestMessage
          : latestMessage;
        setReplyingTo(prefillTarget);
        setShowSuggestions(false);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('engagement:focus-reply')), 0);
      }
    } catch {
      // ignore malformed reply drafts
    } finally {
      sessionStorage.removeItem(prefillReplyToken);
      setHydratedReplyToken(prefillReplyToken);
    }
  }, [hydratedReplyToken, latestMessage, messages, prefillReplyToken, thread?.thread_id]);

  const messageTree = useMemo(() => {
    // Filter out pure reaction-type rows — they're a count, not a
    // conversation surface. Only comment / direct_message messages render.
    const visibleMessages = messages.filter(
      (m) => m.message_type !== 'reaction'
    );

    const byId = new Map<string, EngagementMessage>();
    const roots: EngagementMessage[] = [];
    for (const m of visibleMessages) {
      byId.set(m.id, { ...m });
    }
    for (const m of visibleMessages) {
      const msg = byId.get(m.id)!;
      const parent = m.parent_message_id ? byId.get(m.parent_message_id) : null;
      if (parent) {
        (parent as EngagementMessage & { children?: EngagementMessage[] }).children =
          (parent as EngagementMessage & { children?: EngagementMessage[] }).children ?? [];
        (parent as EngagementMessage & { children?: EngagementMessage[] }).children!.push(msg);
      } else {
        roots.push(msg);
      }
    }

    // For post threads (People Reaction), keep only comments where the
    // *other party* spoke last — recursively across the entire sub-thread,
    // not just the direct children. Same conversation rule as DMs:
    //
    //   - Walk every node in the sub-tree (top-level comment + all replies)
    //   - Find the message with the latest timestamp
    //   - If that latest message is author_self=true → user replied last,
    //     hide the comment
    //   - If that latest message is from the other party → keep it visible
    //
    // This handles arbitrary nesting: Hari Om → me → Hari Om → me, etc.
    // Each new other-party reply at any depth re-surfaces the comment until
    // the user responds again.
    const findLatestInSubtree = (root: EngagementMessage & { children?: EngagementMessage[] }): EngagementMessage => {
      let latest: EngagementMessage = root;
      const stack: Array<EngagementMessage & { children?: EngagementMessage[] }> = [root];
      while (stack.length > 0) {
        const node = stack.pop()!;
        const nodeTs = getEffectiveMessageTimeMs(node);
        const latestTs = getEffectiveMessageTimeMs(latest);
        if (nodeTs > latestTs) latest = node;
        const children = node.children ?? [];
        for (const child of children) stack.push(child as EngagementMessage & { children?: EngagementMessage[] });
      }
      return latest;
    };

    const isPostContext =
      thread?.latest_message_type === 'comment' || thread?.latest_message_type === 'reaction';
    const filteredRoots = isPostContext
      ? roots.filter((root) => {
          const latest = findLatestInSubtree(root as EngagementMessage & { children?: EngagementMessage[] });
          // Latest event in this entire sub-thread is from the user → handled.
          if (latest.author_self === true) return false;
          // Other party spoke last → still needs attention.
          return true;
        })
      : roots;

    const getMessageTime = (message: EngagementMessage) => getEffectiveMessageTimeMs(message);

    // DM convention: a thread surfaces in "Needs Response" only when the
    // other party sent the latest message (handled upstream in the
    // dmThreads filter). In the conversation pane we cap the display at
    // the 3 most recent messages of the merged chain, rendered in the
    // same chronological order as LinkedIn: earlier at top, latest at
    // bottom. More than that is archive territory and lives on LinkedIn
    // itself.
    if (!isPostContext) {
      const chronological = [...filteredRoots].sort(compareMessagesAscending);
      return chronological.length > 3 ? chronological.slice(-3) : chronological;
    }

    filteredRoots.sort((a, b) => getMessageTime(b) - getMessageTime(a));
    return filteredRoots;
  }, [messages, thread?.latest_message_type]);

  const handleInsertSuggestion = useCallback((text: string) => {
    setReplyText(text);
  }, []);

  const handleMarkResolved = useCallback(async () => {
    if (!thread) return;
    try {
      const res = await fetch('/api/engagement/thread/bulk-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: organizationId,
          thread_ids: [thread.thread_id],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      onMarkResolved?.();
    } catch (err) {
      console.error('[engagement] mark resolved failed:', err);
    }
  }, [thread, organizationId, onMarkResolved]);

  const inferPatternFromText = useCallback((text: string): { pattern_category: string; pattern_structure: { blocks: Array<{ type: string; label: string; required: boolean }> } } => {
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        pattern_category: 'general',
        pattern_structure: {
          blocks: [
            { type: 'greeting', label: 'Greeting', required: true },
            { type: 'acknowledgement', label: 'Acknowledgement', required: true },
            { type: 'helpful_info', label: 'Helpful information', required: true },
            { type: 'cta', label: 'Optional CTA', required: false },
          ],
        },
      };
    }
    const hasGreeting = /^(hi|hello|hey|thanks|thank you)/i.test(trimmed);
    const hasQuestion = /\?/.test(trimmed);
    const category = hasQuestion ? 'question_request' : 'general';
    return {
      pattern_category: category,
      pattern_structure: {
        blocks: [
          { type: 'greeting', label: 'Greeting', required: hasGreeting },
          { type: 'acknowledgement', label: 'Acknowledgement', required: true },
          { type: 'helpful_info', label: 'Helpful information', required: true },
          { type: 'cta', label: 'Optional CTA', required: false },
        ],
      },
    };
  }, []);

  const handleSavePattern = useCallback(async () => {
    if (!organizationId || !replyText.trim()) {
      setPatternError('Reply text is required to save a pattern');
      return;
    }
    setSavingPattern(true);
    setPatternError(null);
    try {
      const { pattern_category, pattern_structure } = inferPatternFromText(replyText);
      const res = await fetch('/api/engagement/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: organizationId,
          pattern_category,
          pattern_structure,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      setPatternError(null);
      onReplySent?.();
    } catch (err) {
      setPatternError(err instanceof Error ? err.message : 'Failed to save pattern');
    } finally {
      setSavingPattern(false);
    }
  }, [organizationId, replyText, inferPatternFromText, onReplySent]);

  const handleLike = useCallback(
    async (msg: EngagementMessage) => {
      if (!onLike) return;
      onLike(msg.id, msg.platform ?? '');
    },
    [onLike]
  );

  const renderMessage = (msg: EngagementMessage & { children?: EngagementMessage[] }, depth = 0) => {
    // Pending outbound DM — server-side virtual row representing a queued
    // community_ai_actions row that the Chrome extension hasn't delivered
    // yet. Renders as a dimmed self-message with an explicit "queued" badge
    // and a Cancel button. Cancel routes to /api/engagement/cancel-queued
    // which marks the row failed/user_cancelled, freeing the composer to
    // accept a new reply.
    if (msg.is_pending_outbound) {
      const claimedAndActive = msg.pending_action_claimed === true && msg.pending_action_lease_expired !== true;
      const statusLabel = claimedAndActive
        ? 'Handed to LinkedIn - awaiting delivery'
        : 'Queued - not yet delivered';
      const statusDetail = claimedAndActive
        ? 'Omnivyra has handed this to the LinkedIn tab. Waiting for LinkedIn to report the send result.'
        : 'Will be sent when the LinkedIn tab is open and the Omnivyra extension claims the action.';
      return (
        <div key={msg.id} className="my-2 ml-auto max-w-[80%]">
          <div className={`rounded-2xl border px-3 py-2 ${
            claimedAndActive
              ? 'border-blue-200 bg-blue-50'
              : 'border-amber-200 bg-amber-50'
          }`}>
            <div className={`flex items-center gap-2 text-[11px] uppercase tracking-wide ${
              claimedAndActive ? 'text-blue-800' : 'text-amber-800'
            }`}>
              <span>{statusLabel}</span>
            </div>
            <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{msg.content || '(empty)'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
              <span>{statusDetail}</span>
              {msg.pending_action_id && onRetryQueuedDelivery && !claimedAndActive && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const result = await onRetryQueuedDelivery(msg.pending_action_id as string);
                      if (result && 'message' in result && result.message) window.alert(result.message);
                    } catch (e) {
                      window.alert((e as Error)?.message ?? 'Failed to retry queued delivery');
                    }
                  }}
                  className="font-medium text-blue-700 hover:text-blue-900 underline-offset-2 hover:underline"
                >
                  Retry delivery
                </button>
              )}
              {!claimedAndActive && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!msg.pending_action_id) return;
                    if (typeof window !== 'undefined' && !window.confirm('Cancel this queued reply? You can rewrite and send a new one after.')) return;
                    try {
                      const res = await fetch('/api/engagement/cancel-queued', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                          organization_id: organizationId,
                          action_id: msg.pending_action_id,
                        }),
                      });
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        window.alert(body?.error ?? 'Failed to cancel queued reply');
                        return;
                      }
                      onReplySent?.();
                    } catch (e) {
                      window.alert((e as Error)?.message ?? 'Failed to cancel queued reply');
                    }
                  }}
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
    // Avatar initials should reflect the actual account, not the display
    // string. When the comment is the logged-in user's own ("You"), use the
    // account's real name (carried on author_display_name) to compute KR;
    // showing a "Y" initial is wrong because two different LinkedIn accounts
    // named "Kuldeep" would otherwise be indistinguishable.
    const isSelfAuthor = msg.author_self === true || msg.author_id === '__self__';
    const accountName = isSelfAuthor ? (msg.author_display_name || displayName) : displayName;
    const initials = authorInitials(accountName);
    const avatarClasses = avatarTone(accountName, isSelfAuthor);
    // Profile pic — when present, render an actual image. Initials are
    // the fallback for when the scraper hasn't captured a pic or the URL
    // fails to load (LinkedIn CDN can return 403 in rare cases).
    const avatarImgSrc = (msg.author_avatar_url ?? '').trim() || null;
    return (
    <div key={msg.id} className={depth > 0 ? 'ml-6 mt-2 pl-4 border-l-2 border-slate-200' : ''}>
      <div className="flex gap-2 py-2">
        {avatarImgSrc ? (
          <img
            src={avatarImgSrc}
            alt={displayName}
            className={`w-8 h-8 rounded-full border object-cover shrink-0 ${isSelfAuthor ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-200'}`}
            referrerPolicy="no-referrer"
            onError={(e) => {
              // Fall back to initials by hiding the broken img.
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const fallback = (e.currentTarget.nextSibling as HTMLElement | null);
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
            <span className="font-medium text-slate-800">
              {displayName}
            </span>
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
            <span className="text-xs text-slate-500">{formatTimestamp(msg.platform_created_at ?? msg.created_at, msg.display_time_label)}</span>
          </div>
          <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">{msg.content || '(empty)'}</p>
          {/* Per-comment engagement chips — mirrors LinkedIn's tiny
              "👍 N · 💬 N replies" row underneath each comment. Hidden when
              both counts are zero so we don't clutter empty rows. */}
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
            {!isSelfAuthor && (
              <button
                type="button"
                onClick={async () => {
                  if (typeof window !== 'undefined' && !window.confirm('Mark this message as sent by you? It will drop from "Needs Response".')) return;
                  try {
                    const res = await fetch('/api/engagement/message/mark-self', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({
                        organization_id: organizationId,
                        message_id: msg.id,
                      }),
                    });
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      window.alert(body?.error ?? 'Failed to mark message as sent by you');
                      return;
                    }
                    onReplySent?.();
                  } catch (e) {
                    window.alert((e as Error)?.message ?? 'Failed to mark message');
                  }
                }}
                title="Use this when LinkedIn attributed your own reply to the other party (common when you and the contact share a display name)."
                className="text-xs text-slate-400 hover:text-amber-700 underline-offset-2 hover:underline"
              >
                I sent this
              </button>
            )}
            {(() => {
              const msgPlatform = msg.platform ?? '';
              const likeCap = resolveEngagementCapability(msgPlatform, 'like');
              const replyCap = resolveEngagementCapability(msgPlatform, 'reply');
              // Both Like and Reply stay enabled even on placeholder rows
              // so the operator can validate the full UI flow. The actions
              // will hit a 502 from LinkedIn when targeting a synthetic
              // URN, but that's surfaced via toast/tooltip rather than
              // blocking the UX. Real scraped comments work end-to-end.
              const isPlaceholder = msg.is_placeholder === true;
              const likeDisabled = likeCap.status !== 'api_verified' || isSelfAuthor;
              const replyDisabled = replyCap.status !== 'api_verified' || isSelfAuthor;
              const likeTitle = isPlaceholder
                ? 'Demo seed — clicking will call LinkedIn but the synthetic URN is rejected; real scraped comments will succeed.'
                : (likeCap.status === 'api_verified' ? undefined : likeCap.reason);
              const replyTitle = isPlaceholder
                ? 'Demo seed: composer + AI suggestion will work; sending requires a real scraped URN.'
                : (replyCap.status === 'api_verified' ? undefined : replyCap.reason);
              return (
                <>
                  <button
                    type="button"
                    onClick={() => handleLike(msg)}
                    disabled={likeDisabled}
                    title={likeTitle}
                    className="text-xs text-slate-500 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Like {typeof msg.like_count === 'number' && msg.like_count > 0 ? `(${msg.like_count})` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingTo(msg);
                      setShowSuggestions(true);
                    }}
                    disabled={replyDisabled}
                    title={replyTitle}
                    className="text-xs text-slate-500 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Reply
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      </div>
      {(msg.children ?? []).map((child) => renderMessage(child, depth + 1))}
    </div>
    );
  };

  if (!thread) {
    return (
      <div className={`flex flex-col h-full items-center justify-center p-8 text-center text-slate-500 ${className}`}>
        <div className="max-w-sm space-y-2">
          <p className="text-base font-medium text-slate-700">{emptyStateTitle}</p>
          <p className="text-sm leading-6 text-slate-500">{emptyStateDescription}</p>
        </div>
      </div>
    );
  }

  if (loading && messages.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-medium text-slate-800">{thread.author_name || 'Thread'}</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
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
              <button
                type="button"
                onClick={() => router.push('/dashboard/intelligence?intelTab=active-leads')}
                className="font-medium text-indigo-600 hover:text-indigo-800"
              >
                View in Active Leads
              </button>
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
          {onMarkResolved && thread && (
            <button
              type="button"
              onClick={handleMarkResolved}
              className="text-sm text-slate-600 hover:text-slate-800"
            >
              Mark Resolved
            </button>
          )}
          {onIgnore && thread && (
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
                {/* Stats row mirrors what LinkedIn shows under a post:
                    impressions, reactions, comments. Falls back to the
                    response count when scrape data is missing. */}
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
                      : messages.length}
                    {' '}
                    {(thread.post_comment_count ?? messages.length) === 1 ? 'response' : 'responses'}
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

      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
        {messageTree.map((msg) => renderMessage(msg))}
      </div>

      {(() => {
        // Lock the composer when there's already a queued outbound DM for
        // this thread that the extension hasn't delivered. Sending a
        // second one before the first lands would either dedup-error
        // (idempotency-key collision) or pile up additional pending rows
        // — both are confusing. Force the user to either let it deliver
        // or cancel the queued one first.
        const pendingForThisThread = messages.find(
          (m) => m.is_pending_outbound === true && m.thread_id === thread.thread_id,
        );
        if (pendingForThisThread) {
          const claimedAndActive = pendingForThisThread.pending_action_claimed === true
            && pendingForThisThread.pending_action_lease_expired !== true;
          return (
            <div className="p-4 border-t border-slate-200">
              <div className={`rounded-lg border px-4 py-3 text-sm ${
                claimedAndActive
                  ? 'border-blue-200 bg-blue-50 text-blue-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}>
                {claimedAndActive
                  ? 'LinkedIn delivery is in progress for this conversation. Wait for the result before writing another reply.'
                  : 'A reply is queued for this conversation. Use Retry delivery on the queued message above, or cancel it before writing a new reply.'}
              </div>
            </div>
          );
        }
        return null;
      })()}

      {replyTarget && !messages.some(
        (m) => m.is_pending_outbound === true && m.thread_id === thread.thread_id,
      ) && (
        <div ref={composerRef} className="p-4 border-t border-slate-200 space-y-4">
          {/* Reply-target banner — makes it explicit which comment the
              composer is threaded under, otherwise the composer sits at
              the bottom of the page and the user can't tell whether it's
              a nested reply or a new top-level comment. The X cancels
              the reply target so the composer becomes a top-level
              comment composer (some platforms allow this; LinkedIn
              currently still requires explicit targeting). */}
          {(() => {
            const replyAuthorName = (replyTarget as EngagementMessage & { author_display_name?: string | null }).author_display_name
              || replyTarget.author_id
              || 'comment';
            const isExplicitReply = replyingTo !== null;
            return (
              <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                    {isExplicitReply ? 'Replying to' : 'New comment on this post'}
                  </div>
                  {isExplicitReply && (
                    <div className="mt-0.5">
                      <span className="text-sm font-medium text-slate-800">{replyAuthorName}</span>
                      <span className="text-sm text-slate-600">
                        {' — '}
                        <span className="line-clamp-1">{replyTarget.content || '(empty)'}</span>
                      </span>
                    </div>
                  )}
                </div>
                {isExplicitReply && (
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingTo(null);
                      setShowSuggestions(false);
                    }}
                    className="text-xs text-blue-700 hover:text-blue-900"
                    title="Cancel reply target"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })()}
          <ReplyComposer
            threadId={thread.thread_id}
            messageId={replyTarget.id}
            platform={replyTarget.platform ?? thread.platform}
            organizationId={organizationId}
            messageType={replyTarget.message_type}
            value={replyText}
            onChange={setReplyText}
            onExecuteReply={onExecuteReply}
            onReplySent={() => {
              setReplyingTo(null);
              setReplyText('');
              setShowSuggestions(false);
              onReplySent?.();
            }}
            onRequestSuggestions={() => setShowSuggestions(!showSuggestions)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSavePattern}
              disabled={savingPattern || !replyText.trim()}
              className="text-sm text-slate-600 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingPattern ? 'Saving…' : 'Save Pattern'}
            </button>
            {patternError && (
              <span className="text-sm text-red-600">{patternError}</span>
            )}
          </div>
          {showSuggestions && (
            <AISuggestionPanel
              messageId={replyTarget.id}
              organizationId={organizationId}
              threadId={thread?.thread_id}
              onSelectSuggestion={handleInsertSuggestion}
              visible
            />
          )}
        </div>
      )}
    </div>
  );
});
