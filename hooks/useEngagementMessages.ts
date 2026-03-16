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
};

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function useEngagementMessages(
  organizationId: string,
  threadId: string | null
): { messages: EngagementMessage[]; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const [messages, setMessages] = useState<EngagementMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!organizationId?.trim() || !threadId?.trim()) {
      setMessages([]);
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
      setMessages(Array.isArray(body.messages) ? body.messages : []);
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

  return { messages, loading, error, refresh: fetchMessages };
}
