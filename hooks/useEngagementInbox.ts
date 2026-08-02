/**
 * Data hook for Engagement Command Center inbox.
 * Fetches threads, handles filters, loading, refresh.
 *
 * OPT-005 Phase 2B: SWR facade. KEY STABILITY: the lookback start_date is
 * Date.now()-derived and therefore computed INSIDE the fetcher — it must
 * never enter the SWR key, or every render would mint a new cache entry.
 * LOADING SEMANTICS: `loading` maps to SWR isLoading (first load / key
 * change only) — background revalidation and refresh() silently swap data,
 * preserving the engineered no-skeleton behavior documented below.
 */

import { useCallback } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';
import { ApiFetchError } from '@/lib/swr/swrClient';
import { ACTIONABLE_INBOX_LOOKBACK_DAYS } from '@/lib/engagement/queueRules';

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
  /** True when a completed outbound reply/DM action covers the latest
   *  captured message. Lets Needs Response hide threads the user already
   *  handled, while allowing a newer counterparty reply to reopen them. */
  has_completed_outbound_action?: boolean;
  /** Legacy API alias for has_completed_outbound_action. */
  has_pending_outbound_action?: boolean;
  /** Server-side diagnostics stamped with the same shared queue predicates
   *  the client uses. The UI still filters client-side after platform/user
   *  filters, but these make audits explicit. */
  needs_response_eligible?: boolean;
  people_reaction_eligible?: boolean;
  /** Engagement-author id of the OTHER party on the latest message.
   *  Stable per-person identifier (keyed on LinkedIn profile URL).
   *  Used to collapse legacy-split DM threads in the inbox view. */
  counterparty_author_id?: string | null;
  /** Stable fallback key for the DM counterparty. Derived from the whole
   *  conversation (author/profile/username/name/thread) so self-latest
   *  messages still collapse with older inbound sibling rows. */
  counterparty_identity_key?: string | null;
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
  /** Collaboration (Batch 2): the org user this thread is assigned to, when set.
   *  Drives the Assigned-to-me / Unassigned queue filters and the assignee chip. */
  assigned_to?: string | null;
  assigned_at?: string | null;
  assignee_name?: string | null;
};

// Inbox refresh cadence. 1 hour was the original placeholder; an
// engagement queue needs much faster turnover. 30 s is the floor where new
// scrape data lands (DOM scraper throttle is 30 s) and the inbox cost is
// just one DB read per refresh.
const REFRESH_INTERVAL_MS = 30 * 1000; // 30 seconds
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

function sortByLatest(list: InboxThread[]): InboxThread[] {
  return [...list].sort((a, b) => {
    const ta = a.latest_message_time ? new Date(a.latest_message_time).getTime() : 0;
    const tb = b.latest_message_time ? new Date(b.latest_message_time).getTime() : 0;
    return tb - ta;
  });
}

/** STABLE key: org + limit + filters only. start_date is added in the fetcher. */
function inboxKey(organizationId: string, filters: InboxFilters): string {
  const params = new URLSearchParams({
    organization_id: organizationId,
    organizationId: organizationId,
    limit: String(INBOX_FETCH_LIMIT),
  });
  if (filters.platform) params.set('platform', filters.platform);
  if (filters.priority) params.set('priority', filters.priority);
  return `/api/engagement/inbox?${params.toString()}`;
}

async function fetchInboxList(key: string): Promise<InboxThread[]> {
  // Date.now()-derived lookback lives HERE, never in the key.
  const lookbackStart = new Date(
    Date.now() - ACTIONABLE_INBOX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const url = `${key}&start_date=${encodeURIComponent(lookbackStart)}`;
  const res = await apiFetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiFetchError(url, res.status, {
      error: body.error || body.message || 'Engagement API failure',
    });
  }
  if (body.error) throw new Error(body.error);
  return sortByLatest(Array.isArray(body.items) ? body.items : []);
}

export function useEngagementInbox(
  organizationId: string,
  filters: InboxFilters = {}
): InboxState & {
  refresh: () => Promise<void>;
  patchThread: (threadId: string, updater: (thread: InboxThread) => InboxThread) => void;
} {
  const key = organizationId?.trim() ? inboxKey(organizationId, filters) : null;

  // Only the FIRST fetch (or a key change) flips the loading flag — SWR
  // isLoading. Background polling and refresh() silently swap data so the
  // UI doesn't flash a skeleton every 30 seconds, which felt like the page
  // was "restarting" on its own. (NEVER map loading to isValidating here.)
  const { data, error, isLoading, mutate } = useSWR<InboxThread[]>(key, fetchInboxList, {
    refreshInterval: REFRESH_INTERVAL_MS,
  });

  // Public refresh is a *background* refresh — the user already sees the
  // previous list; SWR revalidation never flips isLoading.
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const patchThread = useCallback(
    (threadId: string, updater: (thread: InboxThread) => InboxThread) => {
      void mutate(
        (current) => {
          if (!current) return current;
          return sortByLatest(
            current.map((thread) => (thread.thread_id === threadId ? updater(thread) : thread))
          );
        },
        { revalidate: false }
      );
    },
    [mutate]
  );

  return {
    // Background-poll failures keep the last good list on screen (SWR
    // retains data alongside error); a first-load failure has no data and
    // renders [] — same as before.
    items: data ?? [],
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : 'Failed to fetch inbox') : null,
    refresh,
    patchThread,
  };
}
