import type { InboxThread } from '@/hooks/useEngagementInbox';

export const THREAD_QUEUE_ORDER = [
  'Needs Response',
  'High Priority',
  'Waiting',
  'Lead-flagged Threads',
  'Done',
] as const;

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

export function getThreadQueueGroup(thread: InboxThread): ThreadQueueGroup {
  const isHighPriority = (thread.triage_priority ?? 0) >= 7 || (thread.priority_score ?? 0) >= 60;
  const needsResponse =
    (thread.unread_count ?? 0) > 0 || thread.customer_question === true || thread.opportunity_indicator === true;
  const isWaiting =
    !needsResponse &&
    ((thread.triage_priority ?? 0) >= 4 ||
      (thread.priority_score ?? 0) >= 30 ||
      (thread.sentiment ?? '').toLowerCase() === 'negative');
  const isLeadFlagged = thread.lead_detected === true || (thread.lead_score ?? 0) > 0;

  if (needsResponse) return 'Needs Response';
  if (isHighPriority) return 'High Priority';
  if (isWaiting) return 'Waiting';
  if (isLeadFlagged) return 'Lead-flagged Threads';
  return 'Done';
}

export function groupThreadsByQueue(items: InboxThread[]): Array<{ group: ThreadQueueGroup; threads: InboxThread[] }> {
  const byGroup = new Map<ThreadQueueGroup, InboxThread[]>();
  for (const group of THREAD_QUEUE_ORDER) {
    byGroup.set(group, []);
  }

  for (const thread of items) {
    byGroup.get(getThreadQueueGroup(thread))?.push(thread);
  }

  for (const threads of byGroup.values()) {
    threads.sort(compareThreadsForAction);
  }

  return THREAD_QUEUE_ORDER
    .map((group) => ({ group, threads: byGroup.get(group) ?? [] }))
    .filter((section) => section.threads.length > 0);
}

export function filterThreadsForQueue(items: InboxThread[], activeFilter: ThreadQueueGroup | 'all'): InboxThread[] {
  if (activeFilter === 'all') return items;
  return items.filter((thread) => getThreadQueueGroup(thread) === activeFilter);
}

export function getRecommendedThread(items: InboxThread[]): InboxThread | null {
  const groups = groupThreadsByQueue(items);
  const needsResponse = groups.find((section) => section.group === 'Needs Response')?.threads[0] ?? null;
  if (needsResponse) return needsResponse;
  return groups.find((section) => section.group === 'High Priority')?.threads[0] ?? null;
}

export function getThreadQueueCounts(items: InboxThread[]) {
  const counts = {
    needsResponse: 0,
    highPriority: 0,
    waiting: 0,
    leadFlagged: 0,
    done: 0,
  };

  for (const thread of items) {
    const group = getThreadQueueGroup(thread);
    if (group === 'Needs Response') counts.needsResponse += 1;
    if (group === 'High Priority') counts.highPriority += 1;
    if (group === 'Waiting') counts.waiting += 1;
    if (group === 'Lead-flagged Threads') counts.leadFlagged += 1;
    if (group === 'Done') counts.done += 1;
  }

  return counts;
}
