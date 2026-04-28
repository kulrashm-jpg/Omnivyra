/**
 * Hook for fetching engagement messages in a thread.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';

export type EngagementMessage = {
  id: string;
  thread_id: string;
  author_id: string | null;
  platform: string;
  platform_message_id?: string | null;
  message_type?: string | null;
  parent_message_id?: string | null;
  content: string | null;
  like_count?: number;
  reply_count?: number;
  sentiment_score?: number | null;
  created_at?: string | null;
  platform_created_at?: string | null;
  optimistic?: boolean;
  /** Display name of the comment author, sourced from raw_payload.author_name
   *  on the server. Falls back to author_id (UUID) if not captured. Used by
   *  ConversationView to show "who wrote this comment" in People Reaction. */
  author_display_name?: string | null;
  author_handle?: string | null;
  author_self?: boolean;
  author_avatar_url?: string | null;
  /** True when this row was hand-seeded for demo. Like/Reply against these
   *  always fail because their platform_message_id is synthetic; UI gates
   *  the action buttons accordingly. */
  is_placeholder?: boolean;
  /** Virtual row representing a queued outbound DM action that hasn't yet
   *  been delivered by the Chrome extension. Rendered with a "Queued · not
   *  yet delivered" marker and a Cancel button. Removed automatically once
   *  the extension delivers and the real outbound message gets ingested. */
  is_pending_outbound?: boolean;
  /** community_ai_actions.id for the queued action, used by the cancel
   *  button to call /api/engagement/cancel-queued. */
  pending_action_id?: string | null;
};

// Conversation pane refresh cadence. Mirrors the inbox: 30 s so the
// reactions/replies on the open thread reflect new scraped data quickly.
const REFRESH_INTERVAL_MS = 30 * 1000; // 30 seconds

export function useEngagementMessages(
  organizationId: string,
  threadId: string | null,
  /** Optional sibling thread ids — when the inbox API has collapsed
   *  multiple legacy DM threads for the same counterparty into one
   *  canonical row, the conversation pane passes the other thread ids
   *  here so messages from the merged conversation render together. */
  siblingThreadIds: string[] = []
): {
  messages: EngagementMessage[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addOptimisticMessage: (message: EngagementMessage) => void;
  clearOptimisticMessages: () => void;
} {
  const [messages, setMessages] = useState<EngagementMessage[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<EngagementMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async (background = false) => {
    if (!organizationId?.trim() || !threadId?.trim()) {
      setMessages([]);
      setOptimisticMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Background refreshes silently swap message data; only the very first
    // load (or thread switch) flips the loading skeleton.
    if (!background) setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      organization_id: organizationId,
      thread_id: threadId,
      limit: '50',
    });
    if (siblingThreadIds && siblingThreadIds.length > 0) {
      params.set('sibling_thread_ids', siblingThreadIds.join(','));
    }

    try {
      const res = await apiFetch(`/api/engagement/messages?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || 'Failed to fetch messages');
      }
      if (body.error) throw new Error(body.error);
      const nextMessages = Array.isArray(body.messages) ? body.messages : [];
      setMessages(nextMessages);
      setOptimisticMessages((current) =>
        current.filter(
          (optimistic) =>
            !nextMessages.some(
              (serverMessage: EngagementMessage) =>
                serverMessage.platform === optimistic.platform &&
                (serverMessage.content ?? '').trim() === (optimistic.content ?? '').trim() &&
                Math.abs(
                  new Date(
                    serverMessage.platform_created_at ??
                      serverMessage.created_at ??
                      0
                  ).getTime() -
                    new Date(
                      optimistic.platform_created_at ??
                        optimistic.created_at ??
                        0
                    ).getTime()
                ) < 5 * 60 * 1000
            )
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
      // Don't blow away the prior message list on a background-poll
      // failure — keep the last good data and surface the error.
      if (!background) setMessages([]);
    } finally {
      if (!background) setLoading(false);
    }
  }, [organizationId, threadId, siblingThreadIds.join(',')]);

  useEffect(() => {
    fetchMessages(false);
  }, [fetchMessages]);

  useEffect(() => {
    if (!organizationId?.trim() || !threadId?.trim()) return;
    const interval = setInterval(() => fetchMessages(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [organizationId, threadId, fetchMessages]);

  const addOptimisticMessage = useCallback((message: EngagementMessage) => {
    setOptimisticMessages((current) => {
      const next = current.filter((entry) => entry.id !== message.id);
      return [message, ...next];
    });
  }, []);

  const clearOptimisticMessages = useCallback(() => {
    setOptimisticMessages([]);
  }, []);

  const mergedMessages = [...optimisticMessages, ...messages].sort((a, b) => {
    const ta = new Date(a.platform_created_at ?? a.created_at ?? 0).getTime();
    const tb = new Date(b.platform_created_at ?? b.created_at ?? 0).getTime();
    return tb - ta;
  });

  // Public refresh is a *background* refresh — see useEngagementInbox for
  // the same rationale. Keeps the message list visible across click-driven
  // refreshes instead of flashing a skeleton.
  const refresh = useCallback(() => fetchMessages(true), [fetchMessages]);
  return {
    messages: mergedMessages,
    loading,
    error,
    refresh,
    addOptimisticMessage,
    clearOptimisticMessages,
  };
}
