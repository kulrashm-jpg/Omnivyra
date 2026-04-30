import type { InboxThread } from '@/hooks/useEngagementInbox';

/**
 * Queue model for the engagement inbox.
 *
 * Single bucket: "Needs Response". A thread is in this bucket iff it has
 * already passed the upstream gate in InboxDashboard (`otherPartyRepliedLast`
 * — direction is not 'outgoing', latest_message_author_self is not true,
 * and there is no in-flight outbound community_ai_actions row).
 *
 * Earlier versions of this file split the bucket into Needs Response /
 * High Priority / Waiting / Lead-flagged Threads / Done with conditions
 * (`unread_count > 0 OR customer_question OR opportunity_indicator`). That
 * silently dropped legitimate "the other party replied last" threads
 * out of Needs Response when the unread badge was stale or the AI
 * classifier hadn't tagged the message — directly contradicting the
 * gate that was already applied upstream. The product rule is simple:
 * if the gate let it through, it needs a response.
 *
 * Urgency (triage_priority, priority_score, unread_count) is preserved
 * as a SORT signal via compareThreadsForAction, not as a visibility gate.
 */

export const THREAD_QUEUE_ORDER = ['Needs Response'] as const;

export type ThreadQueueGroup = (typeof THREAD_QUEUE_ORDER)[number];

function compareThreadsForAction(a: InboxThread, b: InboxThread): number {
  const unreadA = (a.unread_count ?? 0) > 0 ? 1 : 0;
  const unreadB = (b.unread_count ?? 0) > 0 ? 1 : 0;
  if (unreadB !== unreadA) return unreadB - unreadA;

  const urgencyA = a.triage_priority ?? a.priority_score ?? 0;
  const urgencyB = b.triage_priority ?? b.priority_score ?? 0;
  if (urgencyB !== urgencyA) return urgencyB - urgencyA;

  const recencyA = a.latest_message_time ? new Date(a.latest_message_time).getTime() : 0;
  const recencyB = b.latest_message_time ? new Date(b.latest_message_time).getTime() : 0;
  return recencyB - recencyA;
}

export function sortThreadsForAction(items: InboxThread[]): InboxThread[] {
  return [...items].sort(compareThreadsForAction);
}

export function getThreadQueueGroup(_thread: InboxThread): ThreadQueueGroup {
  return 'Needs Response';
}

export function groupThreadsByQueue(items: InboxThread[]): Array<{ group: ThreadQueueGroup; threads: InboxThread[] }> {
  if (items.length === 0) return [];
  const sorted = [...items].sort(compareThreadsForAction);
  return [{ group: 'Needs Response', threads: sorted }];
}

export function filterThreadsForQueue(items: InboxThread[], activeFilter: ThreadQueueGroup | 'all'): InboxThread[] {
  if (activeFilter === 'all' || activeFilter === 'Needs Response') return sortThreadsForAction(items);
  return [];
}

export function getRecommendedThread(items: InboxThread[]): InboxThread | null {
  if (items.length === 0) return null;
  return [...items].sort(compareThreadsForAction)[0] ?? null;
}

export function getThreadQueueCounts(items: InboxThread[]) {
  return { needsResponse: items.length };
}
