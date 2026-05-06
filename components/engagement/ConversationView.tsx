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
import {
  compareMessagesAscending,
  compareMessagesDescending,
  getEffectiveMessageTimeMs,
} from '@/lib/engagement/messageTime';
import { MessageList } from './inbox/MessageList';
import { ThreadHeader } from './inbox/ThreadHeader';
import { useMessageActions } from '@/hooks/useMessageActions';

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

  // Phase 35-C-2: side effects extracted to useMessageActions hook;
  // pure rendering extracted to <MessageList>/<MessageItem>. The hook
  // returns 5 callbacks (cancelQueued, retryQueued, markSelf, like,
  // replyTo) that MessageList passes to each MessageItem.
  const messageActions = useMessageActions({
    organizationId,
    onLike,
    onReplyTo: (msg) => {
      setReplyingTo(msg);
      setShowSuggestions(true);
    },
    onRetryQueuedDelivery,
    onReplySent,
  });

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
      <ThreadHeader
        thread={thread}
        isPostThread={isPostThread}
        postUrl={postUrl}
        messagesLength={messages.length}
        onRefresh={onRefresh}
        onMarkResolved={onMarkResolved && thread ? handleMarkResolved : undefined}
        onIgnore={onIgnore}
        onViewLeadSignal={() => router.push('/dashboard/intelligence?intelTab=active-leads')}
      />


      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
        <MessageList
          messages={messageTree}
          threadAuthor={threadAuthor}
          showRetryQueued={Boolean(onRetryQueuedDelivery)}
          onCancelQueued={messageActions.cancelQueued}
          onRetry={messageActions.retryQueued}
          onMarkSelf={messageActions.markSelf}
          onLike={messageActions.like}
          onReply={messageActions.replyTo}
        />

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
