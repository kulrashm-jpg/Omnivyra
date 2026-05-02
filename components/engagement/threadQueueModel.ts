import type { InboxThread } from '@/hooks/useEngagementInbox';
import {
  sortThreadsForAction as sortQueueThreadsForAction,
} from '@/lib/engagement/queueRules';

export const THREAD_QUEUE_ORDER = ['Needs Response'] as const;

export type ThreadQueueGroup = (typeof THREAD_QUEUE_ORDER)[number];

export { sortThreadsForAction } from '@/lib/engagement/queueRules';

export function getThreadQueueGroup(_thread: InboxThread): ThreadQueueGroup {
  return 'Needs Response';
}

export function groupThreadsByQueue(items: InboxThread[]): Array<{ group: ThreadQueueGroup; threads: InboxThread[] }> {
  if (items.length === 0) return [];
  return [{ group: 'Needs Response', threads: sortQueueThreadsForAction(items) }];
}

export function filterThreadsForQueue(items: InboxThread[], activeFilter: ThreadQueueGroup | 'all'): InboxThread[] {
  if (activeFilter === 'all' || activeFilter === 'Needs Response') return sortQueueThreadsForAction(items);
  return [];
}

export function getRecommendedThread(items: InboxThread[]): InboxThread | null {
  return sortQueueThreadsForAction(items)[0] ?? null;
}

export function getThreadQueueCounts(items: InboxThread[]) {
  return { needsResponse: items.length };
}
