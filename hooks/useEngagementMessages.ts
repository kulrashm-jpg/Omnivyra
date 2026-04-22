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
};

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function useEngagementMessages(
  organizationId: string,
  threadId: string | null
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

  const fetchMessages = useCallback(async () => {
    if (!organizationId?.trim() || !threadId?.trim()) {
      setMessages([]);
      setOptimisticMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      organization_id: organizationId,
      thread_id: threadId,
      limit: '50',
    });

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
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, threadId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (!organizationId?.trim() || !threadId?.trim()) return;
    const interval = setInterval(fetchMessages, REFRESH_INTERVAL_MS);
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

  return {
    messages: mergedMessages,
    loading,
    error,
    refresh: fetchMessages,
    addOptimisticMessage,
    clearOptimisticMessages,
  };
}
