/**
 * Data hook for Engagement Command Center inbox.
 * Fetches threads, handles filters, loading, refresh.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/apiFetch';

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
  /** Type of the most recent message in the thread. 'direct_message' for DMs,
   *  'comment' for post comments, 'reaction' for reactions. Drives the
   *  "People Reacted" filter on the inbox. */
  latest_message_type?: string | null;
  /** 'incoming' if the other party sent the latest message, 'outgoing' if
   *  the user did. Drives the Needs-Response filter — threads where the
   *  user already responded (outgoing latest) drop out of the queue until
   *  the other party replies again. */
  latest_message_direction?: string | null;
  /** True when the latest message was authored by the logged-in user.
   *  Cross-checked with direction to avoid mis-classifying inbound replies
   *  that happen to have author_self=true on a self-comment. */
  latest_message_author_self?: boolean;
  /** True when the user has already triggered a reply/DM action on this
   *  thread through the engagement pipeline (community_ai_actions row in
   *  pending/dispatched/executed/sent_unverified state). Lets the
   *  Needs-Response filter drop the thread the moment Send is clicked,
   *  before the outgoing message is mirrored back into engagement_messages. */
  has_pending_outbound_action?: boolean;
  /** Engagement-author id of the OTHER party on the latest message.
   *  Stable per-person identifier (keyed on LinkedIn profile URL).
   *  Used to collapse legacy-split DM threads in the inbox view. */
  counterparty_author_id?: string | null;
  /** Other engagement_threads rows that share this counterparty and got
   *  collapsed into this canonical entry. The conversation pane can
   *  pull messages from these in addition to the canonical thread to
   *  show the merged conversation history. */
  sibling_thread_ids?: string[];
  /** Platform-side identifier of the thread (post URN for comment threads,
   *  conversation id for DMs). Lets the UI render a "Post on LinkedIn"
   *  banner with a deep-link in People Reaction mode. */
  platform_thread_id?: string | null;
  post_url?: string | null;
  post_text_preview?: string | null;
  post_impression_count?: number | null;
  post_reaction_count?: number | null;
  post_comment_count?: number | null;
  /** Provenance of the post stats. 'manual_seed' = hand-inserted demo data;
   *  'extension_comments' = scraped from LinkedIn via the extension. The
   *  banner shows a "demo" tag for the former so the user can tell at a
   *  glance the numbers are not live. */
  post_stats_source?: string | null;
};

// Inbox refresh cadence. 1 hour was the original placeholder; an
// engagement queue needs much faster turnover. 30 s is the floor where new
// scrape data lands (DOM scraper throttle is 30 s) and the inbox cost is
// just one DB read per refresh.
const REFRESH_INTERVAL_MS = 30 * 1000; // 30 seconds
const INBOX_LOOKBACK_DAYS = 30;
const INBOX_FETCH_LIMIT = 500;

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
): InboxState & {
  refresh: () => Promise<void>;
  patchThread: (threadId: string, updater: (thread: InboxThread) => InboxThread) => void;
} {
  const [items, setItems] = useState<InboxThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedOnce = useRef(false);

  const fetchInbox = useCallback(async (background = false) => {
    if (!organizationId?.trim()) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Only flip the loading flag for the FIRST fetch (or for explicit user
    // refresh). Background polling silently swaps data so the UI doesn't
    // flash a skeleton every 30 seconds, which felt like the page was
    // "restarting" on its own.
    if (!background) setLoading(true);
    setError(null);

    const lookbackStart = new Date(Date.now() - INBOX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      organization_id: organizationId,
      organizationId: organizationId,
      limit: String(INBOX_FETCH_LIMIT),
      start_date: lookbackStart,
    });
    if (filters.platform) params.set('platform', filters.platform);
    if (filters.priority) params.set('priority', filters.priority);

    try {
      const res = await apiFetch(`/api/engagement/inbox?${params.toString()}`);
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
      hasFetchedOnce.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch inbox');
      // Don't blow away the previous list on a background-poll failure;
      // surface the error but keep the last good data on screen.
      if (!background) setItems([]);
    } finally {
      if (!background) setLoading(false);
    }
  }, [organizationId, filters.platform, filters.priority]);

  useEffect(() => {
    fetchInbox(false);
  }, [fetchInbox]);

  useEffect(() => {
    if (!organizationId?.trim()) return;
    const interval = setInterval(() => fetchInbox(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [organizationId, fetchInbox]);

  const patchThread = useCallback((threadId: string, updater: (thread: InboxThread) => InboxThread) => {
    setItems((current) => {
      const next = current.map((thread) => (thread.thread_id === threadId ? updater(thread) : thread));
      next.sort((a, b) => {
        const ta = a.latest_message_time ? new Date(a.latest_message_time).getTime() : 0;
        const tb = b.latest_message_time ? new Date(b.latest_message_time).getTime() : 0;
        return tb - ta;
      });
      return next;
    });
  }, []);

  // Public refresh is a *background* refresh — the user already sees the
  // previous list, so flashing a skeleton on every click-driven refresh
  // is jarring. Loading state is reserved for the very first load.
  const refresh = useCallback(() => fetchInbox(true), [fetchInbox]);
  return { items, loading, error, refresh, patchThread };
}
