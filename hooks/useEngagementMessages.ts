/**
 * Hook for fetching engagement messages in a thread.
 *
 * OPT-005 Phase 2B: ONLY the server-message fetch is an SWR entry. The
 * optimistic queue, its 5-minute content-match reconciler and the merge
 * algorithm are UNCHANGED local state — they already do what a cache can't
 * (fuzzy-match a locally-authored message against its later server twin).
 * `loading` maps to SWR isLoading (first load / thread switch only);
 * background polling and refresh() silently swap data as before.
 */

import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';
import { ApiFetchError } from '@/lib/swr/swrClient';
import { compareMessagesAscending } from '@/lib/engagement/messageTime';

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
  display_time_label?: string | null;
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
  /** True once the extension has leased/claimed the command. Claimed rows
   *  cannot be cancelled safely until the lease expires or the extension
   *  reports a terminal delivery result. */
  pending_action_claimed?: boolean;
  pending_action_acknowledged?: boolean;
  pending_action_lease_expires_at?: string | null;
  pending_action_lease_expired?: boolean;
};

// Conversation pane refresh cadence. Mirrors the inbox: 30 s so the
// reactions/replies on the open thread reflect new scraped data quickly.
const REFRESH_INTERVAL_MS = 30 * 1000; // 30 seconds
const VISIBLE_THREAD_MESSAGE_LIMIT = 3;

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
  const [optimisticMessages, setOptimisticMessages] = useState<EngagementMessage[]>([]);

  const siblingParam = siblingThreadIds && siblingThreadIds.length > 0 ? siblingThreadIds.join(',') : '';
  const key =
    organizationId?.trim() && threadId?.trim()
      ? (() => {
          const params = new URLSearchParams({
            organization_id: organizationId,
            thread_id: threadId,
            limit: '50',
          });
          if (siblingParam) params.set('sibling_thread_ids', siblingParam);
          return `/api/engagement/messages?${params.toString()}`;
        })()
      : null;

  const { data, error: swrError, isLoading, mutate } = useSWR<EngagementMessage[]>(
    key,
    async (url: string) => {
      const res = await apiFetch(url);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiFetchError(url, res.status, {
          error: body.error || body.message || 'Failed to fetch messages',
        });
      }
      if (body.error) throw new Error(body.error);
      return Array.isArray(body.messages) ? body.messages : [];
    },
    { refreshInterval: REFRESH_INTERVAL_MS }
  );
  const serverMessages = data ?? [];

  // No thread selected → clear the optimistic queue (parity with the old
  // early-return branch).
  useEffect(() => {
    if (!key) setOptimisticMessages([]);
  }, [key]);

  // Optimistic reconciliation — UNCHANGED predicate, now driven by server
  // data arrival instead of running inline in the fetch.
  useEffect(() => {
    if (!data) return;
    const nextMessages = data;
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
  }, [data]);

  const addOptimisticMessage = useCallback((message: EngagementMessage) => {
    setOptimisticMessages((current) => {
      const next = current.filter((entry) => entry.id !== message.id);
      return [message, ...next];
    });
  }, []);

  const clearOptimisticMessages = useCallback(() => {
    setOptimisticMessages([]);
  }, []);

  // Merge algorithm UNCHANGED.
  const mergedMessages = [...optimisticMessages, ...serverMessages]
    .sort(compareMessagesAscending)
    .slice(-VISIBLE_THREAD_MESSAGE_LIMIT);

  // Public refresh is a *background* refresh — see useEngagementInbox for
  // the same rationale. SWR revalidation never flips isLoading, so the
  // message list stays visible across click-driven refreshes.
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    messages: mergedMessages,
    loading: isLoading,
    error: swrError
      ? swrError instanceof Error
        ? swrError.message
        : 'Failed to fetch messages'
      : null,
    refresh,
    addOptimisticMessage,
    clearOptimisticMessages,
  };
}
