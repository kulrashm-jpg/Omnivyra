/**
 * Data hook for Engagement Command Center inbox.
 * Fetches threads, handles filters, loading, refresh.
 */

import { useState, useEffect, useCallback } from 'react';

export type InboxThread = {
  thread_id: string;
  platform: string;
  author_name: string | null;
  author_username: string | null;
  latest_message: string | null;
  latest_message_time: string | null;
  priority_score: number;
  unread_count: number;
  message_count: number;
  dominant_intent?: string | null;
  lead_detected?: boolean;
  lead_score?: number;
  negative_feedback?: boolean;
  customer_question?: boolean;
  opportunity_indicator?: boolean;
  latest_message_id?: string | null;
  classification_category?: string | null;
  triage_priority?: number | null;
  sentiment?: string | null;
};

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export type InboxFilters = {
  platform?: string;
  priority?: 'high' | 'medium' | 'low';
};

type InboxState = {
  items: InboxThread[];
  loading: boolean;
  error: string | null;
};

export function useEngagementInbox(
  organizationId: string,
  filters: InboxFilters = {}
): InboxState & { refresh: () => Promise<void> } {
  const [items, setItems] = useState<InboxThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInbox = useCallback(async () => {
    if (!organizationId?.trim()) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      organization_id: organizationId,
      organizationId: organizationId,
      limit: '50',
    });
    if (filters.platform) params.set('platform', filters.platform);
    if (filters.priority) params.set('priority', filters.priority);

    try {
      const res = await fetch(`/api/engagement/inbox?${params.toString()}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || 'Engagement API failure');
      }
      if (body.error) throw new Error(body.error);

      let list = Array.isArray(body.items) ? body.items : [];

      list.sort((a: InboxThread, b: InboxThread) => {
        const ta = a.latest_message_time ? new Date(a.latest_message_time).getTime() : 0;
        const tb = b.latest_message_time ? new Date(b.latest_message_time).getTime() : 0;
        return tb - ta;
      });

      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch inbox');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, filters.platform, filters.priority]);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  useEffect(() => {
    if (!organizationId?.trim()) return;
    const interval = setInterval(fetchInbox, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [organizationId, fetchInbox]);

  return { items, loading, error, refresh: fetchInbox };
}
