/**
 * ConversationView — displays thread messages with nested replies.
 */

import React, { useCallback, useMemo } from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { ReplyComposer } from './ReplyComposer';
import { AISuggestionPanel } from './AISuggestionPanel';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';
import type { InboxThread } from '@/hooks/useEngagementInbox';

function formatTimestamp(iso: string | null | undefined): string {
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

function authorDisplay(authorId: string | null, threadAuthor: string | null): string {
  if (threadAuthor) return threadAuthor;
  if (authorId) return authorId.slice(0, 8) + '…';
  return 'Unknown';
}

export interface ConversationViewProps {
  thread: InboxThread | null;
  messages: EngagementMessage[];
  loading?: boolean;
  organizationId: string;
  onRefresh?: () => void;
  onReplySent?: () => void;
  onLike?: (messageId: string, platform: string) => void;
  onIgnore?: (threadId: string) => void;
  onMarkResolved?: () => void;
  className?: string;
}

export const ConversationView = React.memo(function ConversationView({
  thread,
  messages,
  loading = false,
  organizationId,
  onRefresh,
  onReplySent,
  onLike,
  onIgnore,
  onMarkResolved,
  className = '',
}: ConversationViewProps) {
  const [replyingTo, setReplyingTo] = React.useState<EngagementMessage | null>(null);
  const [replyText, setReplyText] = React.useState('');
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [savingPattern, setSavingPattern] = React.useState(false);
  const [patternError, setPatternError] = React.useState<string | null>(null);

  const threadAuthor = thread?.author_name ?? thread?.author_username ?? null;

  const latestMessage = useMemo(() => {
    if (!messages.length) return null;
    return [...messages].sort((a, b) => {
      const ta = new Date(a.platform_created_at ?? a.created_at ?? 0).getTime();
      const tb = new Date(b.platform_created_at ?? b.created_at ?? 0).getTime();
      return tb - ta;
    })[0];
  }, [messages]);

  const replyTarget = replyingTo ?? latestMessage;

  const messageTree = useMemo(() => {
    const byId = new Map<string, EngagementMessage>();
    const roots: EngagementMessage[] = [];
    for (const m of messages) {
      byId.set(m.id, { ...m });
    }
    for (const m of messages) {
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
    roots.sort(
      (a, b) =>
        new Date(b.platform_created_at ?? b.created_at ?? 0).getTime() -
        new Date(a.platform_created_at ?? a.created_at ?? 0).getTime()
    );
    return roots;
  }, [messages]);

  const handleInsertSuggestion = useCallback((text: string) => {
    setReplyText((prev) => prev + (prev ? ' ' : '') + text);
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

  const renderMessage = (msg: EngagementMessage & { children?: EngagementMessage[] }, depth = 0) => (
    <div key={msg.id} className={depth > 0 ? 'ml-6 mt-2 pl-4 border-l-2 border-slate-200' : ''}>
      <div className="flex gap-2 py-2">
        <div className="w-8 h-8 rounded-full bg-slate-300 flex items-center justify-center text-xs font-medium text-slate-600 shrink-0">
          {(msg.author_id ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-800">
              {authorDisplay(msg.author_id, depth === 0 ? threadAuthor : null)}
            </span>
            <PlatformIcon platform={msg.platform ?? ''} size={12} />
            <span className="text-xs text-slate-500">{formatTimestamp(msg.platform_created_at ?? msg.created_at)}</span>
          </div>
          <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">{msg.content || '(empty)'}</p>
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => handleLike(msg)}
              className="text-xs text-slate-500 hover:text-blue-600"
            >
              Like {typeof msg.like_count === 'number' && msg.like_count > 0 ? `(${msg.like_count})` : ''}
            </button>
            <button
              type="button"
              onClick={() => {
                setReplyingTo(msg);
                setShowSuggestions(true);
              }}
              className="text-xs text-slate-500 hover:text-blue-600"
            >
              Reply
            </button>
          </div>
        </div>
      </div>
      {(msg.children ?? []).map((child) => renderMessage(child, depth + 1))}
    </div>
  );

  if (!thread) {
    return (
      <div className={`flex flex-col h-full items-center justify-center p-8 text-slate-500 ${className}`}>
        Select a thread to view the conversation.
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
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-slate-800">{thread.author_name || 'Thread'}</h3>
          <PlatformIcon platform={thread.platform} size={16} />
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
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Ignore
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
        {messageTree.map((msg) => renderMessage(msg))}
      </div>

      {replyTarget && (
        <div className="p-4 border-t border-slate-200 space-y-4">
          <ReplyComposer
            threadId={thread.thread_id}
            messageId={replyTarget.id}
            platform={replyTarget.platform ?? thread.platform}
            organizationId={organizationId}
            value={replyText}
            onChange={setReplyText}
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
